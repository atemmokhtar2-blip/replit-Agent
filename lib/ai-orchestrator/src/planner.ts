/**
 * AI Planner Engine
 *
 * Routes exclusively through OpenRouter with a three-model fallback chain:
 *   1. moonshotai/kimi-k2        (primary)
 *   2. qwen/qwen3-coder          (fallback 1)
 *   3. deepseek/deepseek-v3      (fallback 2)
 *
 * Environment variable required:
 *   OPENROUTER_API_KEY — API key from openrouter.ai
 *
 * Never uses HuggingFace, Gradio, or any other provider.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const PLANNER_MODELS = [
  "moonshotai/kimi-k2",
  "qwen/qwen3-coder",
  "deepseek/deepseek-v3",
] as const;

type PlannerModel = (typeof PLANNER_MODELS)[number];

const SYSTEM_PROMPT = `You are a professional software architect and technical planner for an AI Website & Bot Builder platform.

Your role is to analyze user project requests and generate comprehensive, structured architecture plans.

CRITICAL RULES:
- Never respond as a general chatbot or assistant
- Always produce a complete, structured architecture plan with ALL 12 sections
- Be precise, professional, and actionable
- Assume the role of a senior software architect at a top engineering firm
- Plans must be structured for future automation by AI Coder, Designer, and DevOps modules

When a user describes a project (website, bot, SaaS, dashboard, mobile app, API, etc.), output a plan using EXACTLY this format:

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

IMPORTANT: Always output ALL 12 sections. Be thorough but concise. This plan will be directly consumed by future AI modules for automated project generation.`;

export interface PlannerMessage {
  role: string;
  content: string;
}

export interface PlannerResult {
  content: string;
  model?: string;
  provider?: string;
  error?: string;
}

const TIMEOUT_MS = 90_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeEnvString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(
    /^[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+|[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+$/g,
    "",
  );
  return cleaned || undefined;
}

// ── Error classification ──────────────────────────────────────────────────────

interface ClassifiedError {
  type:
    | "timeout"
    | "rate_limit"
    | "invalid_api_key"
    | "network"
    | "empty_response"
    | "model_unavailable"
    | "unknown";
  message: string;
  userMessage: string;
  retryable: boolean;
}

function classifyError(err: unknown, status?: number): ClassifiedError {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";

  if (name === "AbortError" || msg.toLowerCase().includes("timeout")) {
    return {
      type: "timeout",
      message: msg,
      userMessage:
        "The request timed out. The model may be under heavy load — please try again.",
      retryable: true,
    };
  }

  if (
    status === 429 ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("Too Many Requests")
  ) {
    return {
      type: "rate_limit",
      message: msg,
      userMessage: "Rate limit reached. Trying the next model…",
      retryable: true,
    };
  }

  if (
    status === 401 ||
    status === 403 ||
    msg.includes("invalid api key") ||
    msg.includes("Unauthorized") ||
    msg.includes("API key")
  ) {
    return {
      type: "invalid_api_key",
      message: msg,
      userMessage:
        "Invalid or missing API key. Please set OPENROUTER_API_KEY in Replit Secrets.",
      retryable: false,
    };
  }

  if (
    msg.includes("empty response") ||
    msg.includes("no content") ||
    msg.includes("empty content")
  ) {
    return {
      type: "empty_response",
      message: msg,
      userMessage: "The model returned an empty response. Trying the next model…",
      retryable: true,
    };
  }

  if (
    status === 503 ||
    status === 502 ||
    msg.includes("model not found") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded")
  ) {
    return {
      type: "model_unavailable",
      message: msg,
      userMessage: "Model is currently unavailable. Trying the next model…",
      retryable: true,
    };
  }

  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return {
      type: "network",
      message: msg,
      userMessage: "Network error connecting to OpenRouter. Please check your connection.",
      retryable: false,
    };
  }

  return {
    type: "unknown",
    message: msg,
    userMessage: `Unexpected error: ${msg.slice(0, 200)}`,
    retryable: true,
  };
}

// ── Single model call ─────────────────────────────────────────────────────────

async function callOpenRouter(
  model: PlannerModel,
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<{ content: string; model: string }> {
  console.log(`[Planner] Request Start — model=${model}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://ai-agent-platform.replit.app",
        "X-Title": "AI Agent Platform — Planner",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4000,
        temperature: 0.3,
        stream: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "(unreadable)");
    throw Object.assign(
      new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 300)}`),
      { status: response.status },
    );
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (typeof data["error"] === "string") {
    throw new Error(data["error"]);
  }
  if (
    data["error"] &&
    typeof data["error"] === "object" &&
    "message" in (data["error"] as object)
  ) {
    throw new Error((data["error"] as { message: string }).message);
  }

  const choices = data["choices"] as
    | { message: { content: string | null }; finish_reason: string }[]
    | undefined;

  const content = choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error(
      `empty response from model. Raw: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  const resolvedModel =
    typeof data["model"] === "string" ? data["model"] : model;

  console.log(`[Planner] Request Success — model=${resolvedModel}`);
  return { content, model: resolvedModel };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runPlanner(
  userMessage: string,
  history: PlannerMessage[] = [],
): Promise<PlannerResult> {
  console.log("[Planner] Provider = OpenRouter");

  const apiKey = sanitizeEnvString(process.env["OPENROUTER_API_KEY"]);

  if (!apiKey) {
    console.warn("[Planner] OPENROUTER_API_KEY is not set");
    return {
      content: buildConfigurationGuide(userMessage),
      model: "none",
      provider: "openrouter",
      error: "missing_api_key",
    };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const modelErrors: { model: PlannerModel; error: ClassifiedError }[] = [];

  for (const model of PLANNER_MODELS) {
    console.log(`[Planner] Model = ${model}`);

    try {
      const result = await callOpenRouter(model, messages, apiKey);
      return {
        content: result.content,
        model: result.model,
        provider: "openrouter",
      };
    } catch (err) {
      const raw = err as Error & { status?: number };
      const classified = classifyError(err, raw.status);

      console.error(
        `[Planner] Request Failed — model=${model} type=${classified.type} message=${classified.message.slice(0, 120)}`,
      );

      modelErrors.push({ model, error: classified });

      // Non-retryable errors abort the entire chain immediately
      if (!classified.retryable) {
        return {
          content: buildFatalErrorMessage(classified, model),
          model,
          provider: "openrouter",
          error: classified.type,
        };
      }

      // Try the next model in the fallback chain
      const nextIndex = PLANNER_MODELS.indexOf(model) + 1;
      if (nextIndex < PLANNER_MODELS.length) {
        const nextModel = PLANNER_MODELS[nextIndex]!;
        console.log(
          `[Planner] Fallback Activated — switching from ${model} to ${nextModel}`,
        );
      }
    }
  }

  // All models exhausted
  console.error("[Planner] All models in fallback chain failed");
  return {
    content: buildAllFailedMessage(modelErrors),
    model: "none",
    provider: "openrouter",
    error: "all_models_failed",
  };
}

// ── Error messages ────────────────────────────────────────────────────────────

function buildConfigurationGuide(userMessage: string): string {
  return `## Planner Engine — Configuration Required

The AI Planner requires an OpenRouter API key to generate architecture plans.

**Your request:** "${userMessage.slice(0, 120)}${userMessage.length > 120 ? "..." : ""}"

---

To activate the Planner, set this environment variable in Replit Secrets:

**OPENROUTER_API_KEY** — Your API key from [openrouter.ai](https://openrouter.ai/keys)

OpenRouter is free to sign up. The Planner uses:
- **Primary:** moonshotai/kimi-k2
- **Fallback 1:** qwen/qwen3-coder
- **Fallback 2:** deepseek/deepseek-v3

Once the key is set, restart the backend and try again.`;
}

function buildFatalErrorMessage(
  classified: ClassifiedError,
  model: PlannerModel,
): string {
  return `⚠️ Planner Error

**Provider:** OpenRouter
**Model:** ${model}
**Error type:** ${classified.type}

${classified.userMessage}

${
  classified.type === "invalid_api_key"
    ? "Add your OpenRouter API key to Replit Secrets as **OPENROUTER_API_KEY** and restart the backend."
    : "Please check your network connection and try again."
}`;
}

function buildAllFailedMessage(
  modelErrors: { model: PlannerModel; error: ClassifiedError }[],
): string {
  const lines = modelErrors.map(
    ({ model, error }) => `- **${model}**: ${error.userMessage}`,
  );

  return `⚠️ Planner — All Models Unavailable

The Planner tried every model in the fallback chain but none succeeded:

${lines.join("\n")}

**Provider:** OpenRouter
**Fallback chain:** ${PLANNER_MODELS.join(" → ")}

Please try again in a moment. If the issue persists, verify your OPENROUTER_API_KEY is valid at [openrouter.ai/keys](https://openrouter.ai/keys).`;
}
