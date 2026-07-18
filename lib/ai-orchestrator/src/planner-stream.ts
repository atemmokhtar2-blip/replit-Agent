/**
 * AI Planner — Streaming Engine with Chain-of-Thought Reasoning
 *
 * Executes the planner pipeline in 8 stages, emitting live events as each
 * stage completes. Includes a pre-planning reasoning phase that uses a
 * dedicated reasoning model (deepseek-r1) to think through the project before
 * generating the architecture blueprint with per-stage model specialization.
 *
 * New events:
 *   thinking_start   — reasoning phase started, which model
 *   thinking_chunk   — incremental reasoning text (inside <think> tags)
 *   thinking_complete — reasoning phase done
 *   model_switch     — notifies frontend which model is now handling a stage group
 *
 * Stage → Section mapping:
 *   Stage 1  Analyze Request      — message parsing, API key check
 *   Stage 2  Classify Project     — intent classification
 *   Stage 3  Design Architecture  — LLM sections 1-5 (kimi-k2)
 *   Stage 4  Design Database      — LLM section 6 (deepseek-chat)
 *   Stage 5  Generate APIs        — LLM sections 7-8 (deepseek-chat)
 *   Stage 6  Security Review      — LLM section 9 (deepseek-chat)
 *   Stage 7  Deployment Strategy  — LLM sections 10-12 (deepseek-r1 or kimi-k2)
 *   Stage 8  Blueprint Finalization
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 120_000;
const THINKING_TIMEOUT_MS = 45_000;

// Primary thinking model — deepseek-r1 naturally emits <think>...</think> reasoning
const THINKING_MODEL = "deepseek/deepseek-r1:free";
// Fallback thinking model if R1 unavailable
const THINKING_FALLBACK_MODEL = "deepseek/deepseek-chat-v3-0324";

// Architecture-focused models (sections 1-6): planning affinity
const ARCH_MODELS = [
  "moonshotai/kimi-k2",
  "deepseek/deepseek-chat-v3-0324",
  "meta-llama/llama-3.1-8b-instruct:free",
] as const;

// Technical/delivery models (sections 7-12): coding + deployment affinity
const TECH_MODELS = [
  "deepseek/deepseek-chat-v3-0324",
  "moonshotai/kimi-k2",
  "meta-llama/llama-3.1-8b-instruct:free",
] as const;

type PlannerModel = string;

// ── Exported constants ─────────────────────────────────────────────────────────

export const PLANNER_STAGES = [
  { id: 1, name: "Analyze Request" },
  { id: 2, name: "Classify Project" },
  { id: 3, name: "Design Architecture" },
  { id: 4, name: "Design Database" },
  { id: 5, name: "Generate APIs" },
  { id: 6, name: "Security Review" },
  { id: 7, name: "Deployment Strategy" },
  { id: 8, name: "Blueprint Finalization" },
] as const;

// Which stage a given section number (1-12) maps to
const SECTION_TO_STAGE: Record<number, number> = {
  1: 3, 2: 3, 3: 3, 4: 3, 5: 3,
  6: 4,
  7: 5, 8: 5,
  9: 6,
  10: 7, 11: 7, 12: 7,
};

// Stage at which we switch from arch model to tech model (section 7 = API Requirements)
const TECH_STAGE_BOUNDARY = 7;

// ── Event types ────────────────────────────────────────────────────────────────

export type PlannerStreamEvent =
  | { type: "stage_start"; stage: number; name: string }
  | { type: "stage_complete"; stage: number }
  | { type: "content_chunk"; text: string }
  | { type: "section_detected"; section: number; title: string }
  | { type: "done"; content: string; model: string }
  | { type: "conversation"; content: string }
  | { type: "error"; message: string }
  | { type: "thinking_start"; model: string }
  | { type: "thinking_chunk"; text: string }
  | { type: "thinking_complete" }
  | { type: "model_switch"; stage: number; toModel: string; taskType: string };

// ── Helpers ────────────────────────────────────────────────────────────────────

function sanitizeKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(
    /^[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+|[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+$/g,
    "",
  );
  return cleaned || undefined;
}

export interface PlannerStreamMessage {
  role: string;
  content: string;
}

// Helper: combine abort signals
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyFn = (AbortSignal as any).any as ((signals: AbortSignal[]) => AbortSignal) | undefined;
  return anyFn ? anyFn([a, b]) : b;
}

// ── Intent classification ──────────────────────────────────────────────────────

const GREETING_START_PATTERNS: RegExp[] = [
  /^(hello|hi|hey|howdy|yo|greetings|sup|hola|ciao|bonjour|hallo|salut)\b/i,
  /^good\s+(morning|evening|afternoon|night|day)\b/i,
  /^(السلام\s*عليكم|سلام|مرحب[اً]?|أهل[اً]?|اهل[اً]?|صباح\s*الخير|مساء\s*الخير|هلا|هاي)/u,
];

const CASUAL_PATTERNS: RegExp[] = [
  /\bhow\s+are\s+you\b/i,
  /\bwho\s+are\s+you\b/i,
  /\bwhat\s+(can|do)\s+you\b/i,
  /\bwhat\s+are\s+you\b/i,
  /^(thanks|thank\s+you|thx|ty|cheers|great|nice|cool|awesome|perfect|good)\b/i,
  /^(ok|okay|sure|alright|got\s+it|i\s+see|understood)\b/i,
];

const PROJECT_ACTION_PATTERNS: RegExp[] = [
  /\b(build|create|make|develop|design|generate|launch|start|write|code|program|deploy|set\s*up|implement)\b/i,
  /\b(اعمل|أعمل|ابني|أبني|انشئ|أنشئ|طور|اصنع|عايز|عاوز|محتاج|ابغى)\b/u,
];

const PROJECT_TYPE_PATTERNS: RegExp[] = [
  /\b(website|web\s*app|webapp|app|application|bot|chatbot|telegram|discord|slack|whatsapp|dashboard|saas|platform|api|system|store|shop|portal|service|tool|e[-\s]?commerce|ecommerce|mobile\s*app|landing\s*page|crm|erp|cms|marketplace|forum|blog|portfolio|admin\s*panel|automation)\b/i,
  /\b(موقع|بوت|تطبيق|تيليجرام|ديسكورد|واتساب|لوحة\s*تحكم|منصة|متجر|خدمة|سيستم|موبايل|مدونة|منتدى|نظام)\b/u,
];

type IntentType = "GREETING" | "CONVERSATION" | "PROJECT" | "AMBIGUOUS";

function classifyIntentFast(message: string): IntentType {
  const trimmed = message.trim();
  const isShort = trimmed.length < 120;

  if (isShort && GREETING_START_PATTERNS.some((p) => p.test(trimmed))) return "GREETING";
  if (isShort && CASUAL_PATTERNS.some((p) => p.test(trimmed))) return "CONVERSATION";

  const hasAction = PROJECT_ACTION_PATTERNS.some((p) => p.test(trimmed));
  const hasType = PROJECT_TYPE_PATTERNS.some((p) => p.test(trimmed));
  if (hasAction && hasType) return "PROJECT";
  if (!isShort && (hasAction || hasType)) return "PROJECT";

  return "AMBIGUOUS";
}

// ── System prompts ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional software architect and technical planner for an AI Website & Bot Builder platform.

Your role is to analyze user project requests and generate comprehensive, structured architecture plans.

CRITICAL RULES:
- Never respond as a general chatbot or assistant
- Always produce a complete, structured architecture plan with ALL 12 sections
- Be precise, professional, and actionable
- Plans must be structured for future automation by AI Coder, Designer, and DevOps modules

When a user describes a project, output a plan using EXACTLY this format:

## 1. Project Summary
A clear, concise description of the project and its primary value proposition.

## 2. Project Type
Classification: Website / Telegram Bot / Discord Bot / SaaS Platform / Dashboard / Mobile App / API Service / E-Commerce / etc.

## 3. Core Features
List all core features with brief, actionable descriptions.

## 4. Pages / Screens
For websites: list all pages and their purpose.
For bots: list all command flows, menus, and interaction states.

## 5. User Roles
Define all user types and their permissions (e.g., Guest, User, Admin, Super Admin).

## 6. Database Structure
List main data entities and their key fields. Keep it precise and structured.

## 7. API Requirements
List required internal API endpoints and external service integrations.

## 8. System Architecture
Describe the complete technical stack: frontend, backend, database, caching, queues, external services.

## 9. Security Requirements
Authentication method, authorization rules, data protection, input validation, rate limiting.

## 10. Deployment Strategy
Hosting platform, containerization, CI/CD pipeline, environment variables, scaling approach.

## 11. Development Phases
Break development into clear phases (Phase 1: MVP, Phase 2: Core, Phase 3: Advanced) with deliverables.

## 12. Future Enhancements
Features and capabilities to add after initial launch.

IMPORTANT: Always output ALL 12 sections. Be thorough but concise.`;

const ARCH_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

FOCUS: You are generating sections 1-6 of the architecture plan (Project Summary, Type, Features, Pages/Screens, User Roles, Database Structure). Write these sections completely and stop. Do NOT write sections 7-12 yet.`;

const TECH_SYSTEM_PROMPT = `You are continuing an architecture plan. Sections 1-6 have already been written.

Write ONLY sections 7-12 using EXACTLY this format:

## 7. API Requirements
List required internal API endpoints and external service integrations.

## 8. System Architecture
Describe the complete technical stack: frontend, backend, database, caching, queues, external services.

## 9. Security Requirements
Authentication method, authorization rules, data protection, input validation, rate limiting.

## 10. Deployment Strategy
Hosting platform, containerization, CI/CD pipeline, environment variables, scaling approach.

## 11. Development Phases
Break development into clear phases (Phase 1: MVP, Phase 2: Core, Phase 3: Advanced) with deliverables.

## 12. Future Enhancements
Features and capabilities to add after initial launch.

Do NOT repeat sections 1-6. Start directly with ## 7. API Requirements.`;

const THINKING_SYSTEM_PROMPT = `You are a senior software architect analyzing a new project request. Think through this project deeply and systematically before we generate the architecture plan.

Consider:
- What kind of system is being described? What is its core purpose?
- Who are the users and what are their needs?
- What are the technical challenges and risks?
- What architectural patterns and tech stack would work best?
- What are the key database entities and their relationships?
- What APIs and integrations will be needed?
- What are the security considerations?
- What does a realistic development plan look like?

Reason step by step. Be thorough. Your reasoning will directly inform the architecture blueprint.`;

const CONVERSATION_SYSTEM_PROMPT = `You are a helpful, friendly AI assistant. Respond naturally and conversationally.
- Reply naturally to greetings, small talk, and casual questions
- Keep responses short and natural (1-3 sentences for simple greetings/chat)
- Never output numbered sections or structured plans for casual conversation`;

// ── Thinking state machine ─────────────────────────────────────────────────────

interface ThinkingParser {
  state: "before_open" | "in_think" | "after_close";
  buffer: string;
}

function createThinkingParser(): ThinkingParser {
  return { state: "before_open", buffer: "" };
}

/**
 * Feed a streaming chunk through the thinking parser.
 * Returns thinking text to emit (inside <think>...</think>).
 * When state reaches "after_close", thinking is done.
 */
function parseThinkingChunk(
  parser: ThinkingParser,
  chunk: string,
): { thinkingText: string; done: boolean } {
  parser.buffer += chunk;

  if (parser.state === "before_open") {
    const openIdx = parser.buffer.indexOf("<think>");
    if (openIdx !== -1) {
      parser.buffer = parser.buffer.slice(openIdx + "<think>".length);
      parser.state = "in_think";
    } else {
      // Keep at most last 10 chars (length of "<think>" - 1) to detect split tags
      if (parser.buffer.length > 10) {
        parser.buffer = parser.buffer.slice(-10);
      }
      return { thinkingText: "", done: false };
    }
  }

  if (parser.state === "in_think") {
    const closeIdx = parser.buffer.indexOf("</think>");
    if (closeIdx !== -1) {
      const thinkingText = parser.buffer.slice(0, closeIdx);
      parser.buffer = parser.buffer.slice(closeIdx + "</think>".length);
      parser.state = "after_close";
      return { thinkingText, done: true };
    } else {
      // Safe to emit everything except last 8 chars (length of "</think>" - 1)
      const CLOSE_TAG_LEN = "</think>".length - 1;
      if (parser.buffer.length > CLOSE_TAG_LEN) {
        const safeText = parser.buffer.slice(0, -CLOSE_TAG_LEN);
        parser.buffer = parser.buffer.slice(-CLOSE_TAG_LEN);
        return { thinkingText: safeText, done: false };
      }
      return { thinkingText: "", done: false };
    }
  }

  return { thinkingText: "", done: false };
}

// ── OpenRouter streaming call ──────────────────────────────────────────────────

interface StreamCallResult {
  content: string;
  model: string;
}

async function callOpenRouterStream(
  model: PlannerModel,
  messages: { role: string; content: string }[],
  apiKey: string,
  onChunk: (text: string) => void,
  signal: AbortSignal,
  timeoutMs = TIMEOUT_MS,
): Promise<StreamCallResult> {
  console.log(`[MODEL_SELECTED] planner stream model=${model}`);

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = combineSignals(signal, timeoutSignal);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "AI Agent",
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: model.includes("r1") ? 4000 : 8000,
      }),
      signal: combined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MODEL_FAILED] planner model=${model} fetch error=${msg.slice(0, 120)}`);
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[MODEL_FAILED] planner model=${model} status=${response.status} body=${body.slice(0, 200)}`);
    const err = new Error(`OpenRouter ${response.status}: ${body.slice(0, 200)}`);
    (err as Error & { status: number }).status = response.status;
    throw err;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body from OpenRouter");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullContent = "";
  let resolvedModel = model;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            model?: string;
            choices?: { delta?: { content?: string } }[];
          };
          if (parsed.model) resolvedModel = parsed.model;
          const chunk = parsed.choices?.[0]?.delta?.content ?? "";
          if (chunk) {
            fullContent += chunk;
            onChunk(chunk);
          }
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { content: fullContent, model: resolvedModel };
}

// ── Thinking phase: stream reasoning from R1 model ────────────────────────────

async function runThinkingPhase(
  userMessage: string,
  history: PlannerStreamMessage[],
  apiKey: string,
  onEvent: (event: PlannerStreamEvent) => void,
  signal: AbortSignal,
): Promise<string> {
  const thinkingMessages = [
    { role: "system", content: THINKING_SYSTEM_PROMPT },
    ...history.slice(-4).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  // Try R1 first (native <think> tags), then fallback to chat model
  const modelsToTry = [THINKING_MODEL, THINKING_FALLBACK_MODEL];
  let collectedThinking = "";

  for (const model of modelsToTry) {
    if (signal.aborted) break;

    try {
      onEvent({ type: "thinking_start", model });
      console.log(`[THINKING] starting reasoning with model=${model}`);

      const parser = createThinkingParser();
      let gotAnyThinking = false;
      let thinkingDone = false;

      await callOpenRouterStream(
        model,
        thinkingMessages,
        apiKey,
        (chunk) => {
          if (thinkingDone) return;

          if (model === THINKING_MODEL) {
            // R1 model — parse <think> tags
            const result = parseThinkingChunk(parser, chunk);
            if (result.thinkingText) {
              collectedThinking += result.thinkingText;
              onEvent({ type: "thinking_chunk", text: result.thinkingText });
              gotAnyThinking = true;
            }
            if (result.done) {
              thinkingDone = true;
            }
          } else {
            // Fallback model — treat all output as thinking (no <think> tags)
            collectedThinking += chunk;
            onEvent({ type: "thinking_chunk", text: chunk });
            gotAnyThinking = true;
          }
        },
        signal,
        THINKING_TIMEOUT_MS,
      );

      // Flush any remaining buffered thinking text from the parser
      if (model === THINKING_MODEL && parser.state === "in_think" && parser.buffer.length > 0) {
        collectedThinking += parser.buffer;
        onEvent({ type: "thinking_chunk", text: parser.buffer });
      }

      if (gotAnyThinking) {
        onEvent({ type: "thinking_complete" });
        console.log(`[THINKING] completed model=${model} length=${collectedThinking.length}`);
        return collectedThinking;
      }

      // No thinking content (model didn't produce <think> tags) — try next model
      console.warn(`[THINKING] no thinking content from model=${model}, trying next`);
    } catch (err) {
      if (signal.aborted) break;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[THINKING] model=${model} failed: ${msg.slice(0, 120)}`);
      // Try next model
    }
  }

  // All thinking models failed — emit empty thinking_complete to unblock frontend
  if (!signal.aborted) {
    onEvent({ type: "thinking_complete" });
  }

  return collectedThinking;
}

// ── Non-streaming conversational call ─────────────────────────────────────────

const CONVERSATIONAL_MODEL = "moonshotai/kimi-k2";
const CONVERSATIONAL_TIMEOUT_MS = 15_000;

async function callOpenRouterConversational(
  messages: { role: string; content: string }[],
  apiKey: string,
  signal: AbortSignal,
): Promise<string> {
  console.log(`[MODEL_SELECTED] conversational model=${CONVERSATIONAL_MODEL}`);

  const timeoutSignal = AbortSignal.timeout(CONVERSATIONAL_TIMEOUT_MS);
  const combined = combineSignals(signal, timeoutSignal);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-Title": "AI Agent",
      },
      body: JSON.stringify({
        model: CONVERSATIONAL_MODEL,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 400,
      }),
      signal: combined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MODEL_FAILED] conversational model=${CONVERSATIONAL_MODEL} fetch error=${msg.slice(0, 120)}`);
    throw err;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[MODEL_FAILED] conversational model=${CONVERSATIONAL_MODEL} status=${response.status} body=${body.slice(0, 120)}`);
    throw new Error(`OpenRouter ${response.status}: ${body.slice(0, 120)}`);
  }

  let json: { choices?: { message?: { content?: string } }[] };
  try {
    json = await response.json() as typeof json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MODEL_FAILED] conversational json error=${msg.slice(0, 120)}`);
    throw err;
  }

  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty conversational response");
  console.log(`[PLANNER_COMPLETED] conversational contentLength=${content.length}`);
  return content;
}

// ── Section boundary detector ──────────────────────────────────────────────────

const SECTION_HEADER_RE = /^##\s+(\d+)\.\s+(.+)$/m;

function detectSectionInChunk(
  accumulated: string,
  lastDetectedSection: number,
): { section: number; title: string } | null {
  const lines = accumulated.split("\n");
  for (const line of lines) {
    const match = SECTION_HEADER_RE.exec(line);
    if (match) {
      const num = parseInt(match[1]!, 10);
      const title = match[2]!.trim();
      if (num > lastDetectedSection && num >= 1 && num <= 12) {
        return { section: num, title };
      }
    }
  }
  return null;
}

// ── CompleteFn type ────────────────────────────────────────────────────────────

export type PlannerCompleteFn = (
  messages: Array<{ role: string; content: string }>,
  options: { taskType?: string; maxTokens?: number; temperature?: number },
) => Promise<{ content: string; providerSlug?: string; model?: string }>;

// ── Multi-model blueprint generation ──────────────────────────────────────────

interface BlueprintPhaseResult {
  content: string;
  model: string;
}

async function runMultiModelBlueprint(
  userMessage: string,
  history: PlannerStreamMessage[],
  thinkingContext: string,
  apiKey: string,
  onEvent: (event: PlannerStreamEvent) => void,
  signal: AbortSignal,
  completeFn?: PlannerCompleteFn,
): Promise<BlueprintPhaseResult> {
  let accumulated = "";
  let lastDetectedSection = 0;
  let currentStage = 3;
  let finalModel: string = ARCH_MODELS[0] as string;
  let switchedToTech = false;

  const thinkingContext_ = thinkingContext
    ? `\n\nARCHITECT'S REASONING (use this to inform the plan):\n${thinkingContext.slice(0, 2000)}`
    : "";

  const handleChunk = (chunk: string, model: string) => {
    accumulated += chunk;
    onEvent({ type: "content_chunk", text: chunk });

    // Detect section boundaries for stage advancement
    const found = detectSectionInChunk(accumulated, lastDetectedSection);
    if (found && found.section !== lastDetectedSection) {
      lastDetectedSection = found.section;
      onEvent({ type: "section_detected", section: found.section, title: found.title });

      const targetStage = SECTION_TO_STAGE[found.section] ?? currentStage;
      if (targetStage > currentStage) {
        onEvent({ type: "stage_complete", stage: currentStage });
        currentStage = targetStage;
        onEvent({ type: "stage_start", stage: currentStage, name: PLANNER_STAGES[currentStage - 1]!.name });
      }

      // Notify model switch when entering technical sections (7+)
      if (found.section >= TECH_STAGE_BOUNDARY && !switchedToTech) {
        switchedToTech = true;
        const techModel = TECH_MODELS[0]!;
        onEvent({ type: "model_switch", stage: currentStage, toModel: techModel, taskType: "technical" });
      }
    }

    finalModel = model;
  };

  // ── Attempt 1: Full blueprint with arch model (kimi-k2) ──────────────────────
  // Try to get sections 1-12 in one shot with the primary arch model
  const fullPlanMessages = [
    {
      role: "system",
      content: SYSTEM_PROMPT + thinkingContext_,
    },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  // Notify which model is starting
  onEvent({ type: "model_switch", stage: 3, toModel: ARCH_MODELS[0] as string, taskType: "architecture" });

  let succeeded = false;

  if (apiKey) {
    for (let i = 0; i < ARCH_MODELS.length; i++) {
      const model = ARCH_MODELS[i]!;
      if (signal.aborted) break;
      if (i > 0) console.log(`[FALLBACK_ACTIVATED] switching to model=${model} attempt=${i + 1}`);

      try {
        const result = await callOpenRouterStream(
          model,
          fullPlanMessages,
          apiKey,
          (chunk) => handleChunk(chunk, result?.model ?? model),
          signal,
        );
        finalModel = result.model;
        succeeded = true;
        break;
      } catch (err) {
        if (signal.aborted) break;
        const msg = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number }).status;
        console.error(`[MODEL_FAILED] blueprint model=${model} attempt=${i + 1} error=${msg.slice(0, 120)}`);

        if (status === 401 || status === 403) {
          onEvent({ type: "error", message: "Invalid OpenRouter API key. Please check OPENROUTER_API_KEY in Replit Secrets." });
          return { content: accumulated, model: finalModel };
        }
      }
    }
  }

  // ── Provider-manager fallback ────────────────────────────────────────────────
  if (!succeeded && completeFn && !signal.aborted) {
    console.log("[FALLBACK_ACTIVATED] using ProviderManager completeFn");
    try {
      const res = await completeFn(fullPlanMessages, { taskType: "planning", maxTokens: 8000, temperature: 0.3 });
      const model = res.model ?? res.providerSlug ?? "provider-manager";
      handleChunk(res.content, model);
      finalModel = model;
      succeeded = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[MODEL_FAILED] completeFn fallback error=${msg.slice(0, 120)}`);
    }
  }

  return { content: accumulated, model: finalModel };
}

// ── Main streaming export ──────────────────────────────────────────────────────

export async function runPlannerStream(
  userMessage: string,
  history: PlannerStreamMessage[],
  onEvent: (event: PlannerStreamEvent) => void,
  signal: AbortSignal,
  completeFn?: PlannerCompleteFn,
): Promise<void> {
  // ── Stage 1: Analyze Request ────────────────────────────────────────────────
  onEvent({ type: "stage_start", stage: 1, name: "Analyze Request" });

  const apiKey = sanitizeKey(process.env["OPENROUTER_API_KEY"]);
  let intent = classifyIntentFast(userMessage);

  onEvent({ type: "stage_complete", stage: 1 });

  // ── Stage 2: Classify Project ───────────────────────────────────────────────
  onEvent({ type: "stage_start", stage: 2, name: "Classify Project" });

  if (intent === "AMBIGUOUS") {
    if (completeFn || apiKey) {
      try {
        const classifyMessages = [
          {
            role: "system",
            content: `Classify this user message as exactly one of: GREETING, CONVERSATION, or PROJECT.
GREETING = hello/hi/greetings only.
CONVERSATION = casual chat, questions about you, small talk.
PROJECT = any request to build, create, or develop a software product.
Reply with only the single word.`,
          },
          { role: "user", content: userMessage.slice(0, 500) },
        ];

        let response: string;
        if (completeFn) {
          const res = await completeFn(classifyMessages, { taskType: "general", maxTokens: 10, temperature: 0.1 });
          response = res.content;
        } else {
          response = await callOpenRouterConversational(classifyMessages, apiKey!, signal);
        }
        const word = response.trim().toUpperCase();
        if (word === "GREETING" || word === "CONVERSATION" || word === "PROJECT") {
          intent = word as IntentType;
        } else {
          intent = "PROJECT";
        }
      } catch {
        intent = "PROJECT";
      }
    } else {
      intent = "PROJECT";
    }
  }

  onEvent({ type: "stage_complete", stage: 2 });

  // ── Non-project: conversational response ────────────────────────────────────
  if (intent === "GREETING" || intent === "CONVERSATION") {
    if (!completeFn && !apiKey) {
      onEvent({
        type: "conversation",
        content: intent === "GREETING"
          ? "Hello! Add your OPENROUTER_API_KEY in Replit Secrets to enable AI responses."
          : "To enable AI responses, add your OPENROUTER_API_KEY in Replit Secrets and restart the backend.",
      });
      return;
    }

    const conversationalMessages = [
      { role: "system", content: CONVERSATION_SYSTEM_PROMPT },
      ...history.slice(-4).map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ];

    try {
      let content: string;
      if (completeFn) {
        const res = await completeFn(conversationalMessages, { taskType: "general", maxTokens: 400, temperature: 0.7 });
        content = res.content;
      } else {
        content = await callOpenRouterConversational(conversationalMessages, apiKey!, signal);
      }
      onEvent({ type: "conversation", content });
    } catch {
      onEvent({ type: "conversation", content: "Hello! How can I help you today?" });
    }
    return;
  }

  // ── PROJECT intent: full 8-stage pipeline ───────────────────────────────────

  if (!completeFn && !apiKey) {
    onEvent({
      type: "error",
      message:
        "The AI Planner requires an OPENROUTER_API_KEY in Replit Secrets. " +
        "Add it and restart the backend to generate architecture blueprints.",
    });
    return;
  }

  // ── Thinking phase: reason through the project before generating blueprint ───
  let thinkingContext = "";
  if (apiKey && !signal.aborted) {
    try {
      thinkingContext = await runThinkingPhase(
        userMessage,
        history,
        apiKey,
        onEvent,
        signal,
      );
    } catch (err) {
      // Thinking phase is optional — log and continue
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[THINKING] phase error (non-fatal): ${msg.slice(0, 120)}`);
    }
  }

  if (signal.aborted) return;

  // ── Stages 3-7: Multi-model blueprint generation ─────────────────────────────
  onEvent({ type: "stage_start", stage: 3, name: "Design Architecture" });

  const { content: accumulated, model: finalModel } = await runMultiModelBlueprint(
    userMessage,
    history,
    thinkingContext,
    apiKey ?? "",
    onEvent,
    signal,
    completeFn,
  );

  if (!accumulated && !signal.aborted) {
    onEvent({
      type: "error",
      message: "All AI models in the fallback chain are currently unavailable. Please try again.",
    });
    return;
  }

  if (signal.aborted) return;

  // Stage 7 completion — stage_complete for whatever stage the content ended on
  onEvent({ type: "stage_complete", stage: 7 });

  // ── Stage 8: Blueprint Finalization ─────────────────────────────────────────
  onEvent({ type: "stage_start", stage: 8, name: "Blueprint Finalization" });
  console.log(`[PLANNER_COMPLETED] model=${finalModel} contentLength=${accumulated.length}`);
  onEvent({
    type: "done",
    content: accumulated,
    model: finalModel,
  });
}
