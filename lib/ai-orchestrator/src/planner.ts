/**
 * AI Planner Engine
 *
 * Sends requests exclusively to the HuggingFace Space defined in HF_SPACE_URL.
 * Supports Gradio 4.x/6.x Spaces and OpenAI-compatible custom endpoints.
 *
 * Detection rules (applied to HF_SPACE_URL):
 *   path ends with /run/predict or /api/predict     → Gradio (old-style)
 *   path ends with /chat/completions                → OpenAI-compatible, call directly
 *   hostname ends with .hf.space (bare or root path)→ probe /config; detect Gradio or OpenAI
 *   anything else                                   → OpenAI-compatible, call directly
 *
 * Gradio 6.x call flow:
 *   1. GET {origin}/config               (Accept: application/json) → read api_prefix
 *   2. GET {origin}{api_prefix}/info     (Accept: application/json) → find chat endpoint name
 *   3. POST {origin}{api_prefix}/call/{endpoint} → returns { event_id }
 *   4. GET {origin}{api_prefix}/call/{endpoint}/{event_id} → SSE stream → parse complete event
 *
 * Never constructs api-inference.huggingface.co URLs.
 * Never appends /models/{model}/v1/chat/completions or any inference API path.
 */

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
  error?: string;
}

const TIMEOUT_MS = 90_000;
const PROBE_TIMEOUT_MS = 8_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitizeEnvString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(
    /^[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+|[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+$/g,
    "",
  );
  return cleaned || undefined;
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// ── Gradio Space detection ────────────────────────────────────────────────────

interface GradioConfig {
  apiPrefix: string;
  version: string;
}

/**
 * Fetch /config with Accept: application/json to detect Gradio and read api_prefix.
 * Returns null if the endpoint is not a Gradio Space or the request fails.
 */
async function fetchGradioConfig(
  origin: string,
  apiKey: string | undefined,
): Promise<GradioConfig | null> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${origin}/config`, {
      headers: { Accept: "application/json", ...authHeaders(apiKey) },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) return null;
    const data = (await res.json()) as {
      api_prefix?: string;
      version?: string;
    };
    if (!data.api_prefix) return null;
    return {
      apiPrefix: data.api_prefix,
      version: data.version ?? "unknown",
    };
  } catch {
    return null;
  }
}

/**
 * Preferred endpoint names for the chat/respond function, in priority order.
 */
const CHAT_ENDPOINT_NAMES = [
  "/respond",
  "/chat",
  "/predict",
  "/generate",
  "/answer",
  "/reply",
  "/complete",
  "/inference",
];

/**
 * Fetch {origin}{apiPrefix}/info to find the chat endpoint name exposed by the Space.
 * Falls back to "/predict" if no named endpoint matches.
 */
async function findGradioChatEndpoint(
  origin: string,
  apiPrefix: string,
  apiKey: string | undefined,
): Promise<string> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${origin}${apiPrefix}/info`, {
      headers: { Accept: "application/json", ...authHeaders(apiKey) },
      signal: ctrl.signal,
    });
    if (!res.ok) return "/predict";
    const info = (await res.json()) as {
      named_endpoints?: Record<string, unknown>;
    };
    const namedKeys = Object.keys(info.named_endpoints ?? {});
    for (const preferred of CHAT_ENDPOINT_NAMES) {
      if (namedKeys.includes(preferred)) return preferred;
    }
    // Use first available named endpoint if none match preferred names
    if (namedKeys.length > 0) return namedKeys[0]!;
  } catch {
    // fall through
  }
  return "/predict";
}

// ── Gradio SSE reader ─────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: string;
}

async function* readSseEvents(
  response: Response,
): AsyncGenerator<SseEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "message";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        yield { event: currentEvent, data: line.slice(5).trim() };
        currentEvent = "message";
      }
    }
  }
}

// ── Gradio call ───────────────────────────────────────────────────────────────

/**
 * Call a Gradio 4.x/6.x named endpoint using the two-step call + SSE pattern.
 */
async function callGradioEndpoint(
  origin: string,
  apiPrefix: string,
  endpointName: string,
  inputData: unknown[],
  apiKey: string | undefined,
): Promise<string> {
  const headers = {
    "Content-Type": "application/json",
    ...authHeaders(apiKey),
  };

  // Step 1: submit
  const submitUrl = `${origin}${apiPrefix}/call${endpointName}`;
  const submitCtrl = new AbortController();
  setTimeout(() => submitCtrl.abort(), 30_000);

  const submitRes = await fetch(submitUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: inputData }),
    signal: submitCtrl.signal,
  });

  if (!submitRes.ok) {
    const text = await submitRes.text();
    throw new Error(`Gradio submit failed (${submitRes.status}): ${text.slice(0, 200)}`);
  }

  const { event_id } = (await submitRes.json()) as { event_id: string };

  // Step 2: read SSE result stream
  const sseUrl = `${origin}${apiPrefix}/call${endpointName}/${event_id}`;
  const sseCtrl = new AbortController();
  setTimeout(() => sseCtrl.abort(), TIMEOUT_MS);

  const sseRes = await fetch(sseUrl, {
    headers: authHeaders(apiKey),
    signal: sseCtrl.signal,
  });

  if (!sseRes.ok) {
    throw new Error(`Gradio SSE failed (${sseRes.status})`);
  }

  let lastGenerating = "";
  let completed = false;

  for await (const ev of readSseEvents(sseRes)) {
    if (ev.event === "heartbeat") continue;

    if (ev.event === "error") {
      throw new Error(
        `Gradio Space returned an error. The Space's AI backend may be unavailable or misconfigured. ` +
          `Raw error: ${ev.data}`,
      );
    }

    if (ev.event === "generating") {
      // Accumulate streaming tokens
      try {
        const parsed = JSON.parse(ev.data);
        if (typeof parsed === "string") lastGenerating += parsed;
      } catch {
        lastGenerating += ev.data;
      }
    }

    if (ev.event === "complete") {
      completed = true;
      // complete data is an array: ["response text"]
      if (ev.data && ev.data !== "null") {
        try {
          const parsed = JSON.parse(ev.data);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return String(parsed[0]);
          }
          if (typeof parsed === "string") return parsed;
        } catch {
          // fall through to lastGenerating
        }
      }
      break;
    }
  }

  if (lastGenerating) return lastGenerating;
  if (completed) throw new Error("Gradio Space returned an empty response.");
  throw new Error("Gradio SSE stream ended without a complete event.");
}

// ── OpenAI-compatible call ────────────────────────────────────────────────────

async function callOpenAIEndpoint(
  targetUrl: string,
  messages: { role: string; content: string }[],
  apiKey: string | undefined,
): Promise<{ content: string; model?: string }> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), TIMEOUT_MS);

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(apiKey),
    },
    body: JSON.stringify({
      messages,
      max_tokens: 2500,
      temperature: 0.3,
      stream: false,
    }),
    signal: controller.signal,
  });

  console.log("[Planner] Response status =", response.status);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Space returned HTTP ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (typeof data["error"] === "string") throw new Error(data["error"]);

  const choices = data["choices"] as
    | { message: { content: string }; finish_reason: string }[]
    | undefined;
  const content = choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error(
      `Space returned an empty response. Raw: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  return {
    content,
    model: typeof data["model"] === "string" ? data["model"] : undefined,
  };
}

// ── Reachability pre-check ────────────────────────────────────────────────────

async function checkReachability(
  target: string,
  apiKey: string | undefined,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(target, {
      method: "HEAD",
      headers: authHeaders(apiKey),
      signal: ctrl.signal,
    });
    // Any HTTP response (even 4xx/5xx) means the host is reachable
    return { ok: true, status: res.status };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    return {
      ok: false,
      error: err.cause?.code
        ? `${err.message} (${err.cause.code})`
        : err.message,
    };
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runPlanner(
  userMessage: string,
  history: PlannerMessage[] = [],
): Promise<PlannerResult> {
  const spaceUrl = sanitizeEnvString(process.env["HF_SPACE_URL"]);
  const apiKey = sanitizeEnvString(process.env["HF_API_KEY"]);

  // ── Diagnostic 1 ──────────────────────────────────────────────────────────
  console.log("[Planner] HF_SPACE_URL =", spaceUrl ?? "(not set)");

  if (!spaceUrl) {
    console.warn("[Planner] HF_SPACE_URL is not set — returning configuration guide");
    return { content: buildConfigurationGuide(userMessage), model: "fallback" };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(spaceUrl);
  } catch {
    const charCodes = [...spaceUrl.slice(0, 40)].map((c) => c.charCodeAt(0));
    console.error("[Planner] HF_SPACE_URL is not a valid URL. Char codes:", charCodes);
    return {
      content:
        `⚠️ HF_SPACE_URL is not a valid URL.\n\n` +
        `Stored value starts with: \`${spaceUrl.slice(0, 80)}\`\n\n` +
        `Please re-enter the URL in Replit Secrets — copy only the URL itself with no surrounding quotes.`,
      error: "invalid_url",
    };
  }

  const origin = `${parsedUrl.protocol}//${parsedUrl.host}`;
  const urlPath = parsedUrl.pathname.replace(/\/+$/, "").toLowerCase();

  // ── Reachability pre-check (on origin, not full path) ─────────────────────
  const reach = await checkReachability(origin, apiKey);
  if (!reach.ok) {
    console.error("[Planner] Space unreachable:", reach.error);
    return {
      content:
        `⚠️ The Planner Space is unreachable.\n\n` +
        `**URL:** ${spaceUrl}\n` +
        `**Error:** ${reach.error}\n\n` +
        `**Possible causes:**\n` +
        `- The Space is sleeping — open it in a browser first to wake it up\n` +
        `- The URL in HF_SPACE_URL is incorrect\n` +
        `- A network restriction is blocking the connection`,
      error: reach.error,
    };
  }

  // ── Detect Space type ──────────────────────────────────────────────────────
  // Fast static check first
  let spaceType: "gradio" | "openai" = "openai";
  let gradioApiPrefix = "/gradio_api";
  let gradioChatEndpoint = "/respond";

  if (
    urlPath === "/run/predict" ||
    urlPath === "/api/predict"
  ) {
    spaceType = "gradio";
    gradioApiPrefix = ""; // old-style path directly on origin
  } else if (
    urlPath.endsWith("/chat/completions") ||
    urlPath.endsWith("/completions")
  ) {
    spaceType = "openai";
  } else {
    // Probe /config to detect Gradio
    const config = await fetchGradioConfig(origin, apiKey);
    if (config) {
      spaceType = "gradio";
      gradioApiPrefix = config.apiPrefix;
      console.log(
        `[Planner] Detected Gradio ${config.version} (api_prefix: ${config.apiPrefix})`,
      );
      gradioChatEndpoint = await findGradioChatEndpoint(
        origin,
        config.apiPrefix,
        apiKey,
      );
      console.log(`[Planner] Using Gradio endpoint: ${gradioChatEndpoint}`);
    }
  }

  // ── Resolve request target for logging ────────────────────────────────────
  let requestTarget: string;
  if (spaceType === "gradio") {
    requestTarget =
      gradioApiPrefix === ""
        ? spaceUrl // old-style /run/predict URL passed directly
        : `${origin}${gradioApiPrefix}/call${gradioChatEndpoint}`;
  } else {
    requestTarget = spaceUrl;
  }

  // ── Diagnostic 2 ──────────────────────────────────────────────────────────
  console.log(
    "[Planner] Request target =",
    requestTarget,
    `(type: ${spaceType})`,
  );

  // ── Build messages for OpenAI path ────────────────────────────────────────
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  // ── Call the Space ────────────────────────────────────────────────────────
  try {
    let content: string;
    let model: string | undefined;

    if (spaceType === "gradio") {
      if (gradioApiPrefix === "") {
        // Old-style /run/predict — call with Gradio predict body directly
        const prompt = messages
          .map((m) =>
            m.role === "system"
              ? `[System]: ${m.content}`
              : m.role === "assistant"
                ? `Assistant: ${m.content}`
                : `User: ${m.content}`,
          )
          .join("\n\n");
        content = await callGradioEndpoint(
          origin,
          "",
          "/run/predict",
          [prompt],
          apiKey,
        );
      } else {
        // Gradio 4.x/6.x named endpoint
        content = await callGradioEndpoint(
          origin,
          gradioApiPrefix,
          gradioChatEndpoint,
          [userMessage, SYSTEM_PROMPT, 2500, 0.3],
          apiKey,
        );
      }
      // ── Diagnostic 3 (Gradio: logged inside callGradioEndpoint step 2) ──
      console.log("[Planner] Response status = 200 (Gradio SSE complete)");
      model = "gradio";
    } else {
      const result = await callOpenAIEndpoint(requestTarget, messages, apiKey);
      // ── Diagnostic 3 logged inside callOpenAIEndpoint ───────────────────
      content = result.content;
      model = result.model ?? "openai-compatible";
    }

    return { content, model };
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      console.warn("[Planner] Request timed out after", TIMEOUT_MS, "ms");
      return {
        content:
          "⚠️ The Planner timed out. The Space may be loading or under heavy load — please try again in a moment.",
        error: "timeout",
      };
    }
    console.error("[Planner] Space error:", err);
    return {
      content: buildProviderErrorMessage(err as Error, spaceUrl),
      error: String(err),
    };
  }
}

// ── Error messages ────────────────────────────────────────────────────────────

function buildConfigurationGuide(userMessage: string): string {
  return `## Planner Engine — Configuration Required

The AI Planner is not yet connected to a HuggingFace Space.

**Your request:** "${userMessage.slice(0, 120)}${userMessage.length > 120 ? "..." : ""}"

---

To activate the Planner, set these environment variables in Replit Secrets:

**HF_SPACE_URL** — The URL of your HuggingFace Space.

Supported formats:
\`https://your-username-your-space.hf.space\`
\`https://your-username-your-space.hf.space/run/predict\`
\`https://your-username-your-space.hf.space/v1/chat/completions\`

The Planner will automatically detect whether the Space is a Gradio app or an OpenAI-compatible endpoint.

**HF_API_KEY** *(optional)* — Your HuggingFace API token for private Spaces.
Get one free at: https://huggingface.co/settings/tokens`;
}

function buildProviderErrorMessage(err: Error, spaceUrl: string): string {
  const message = err.message.slice(0, 400);
  return `⚠️ The Planner could not get a response from the HuggingFace Space.

**Space URL:** ${spaceUrl}
**Error:** ${message}

**Possible causes:**
- The Space's AI backend is unavailable or not configured correctly
- The Space is sleeping — open it in a browser to wake it up, then retry
- Rate limit reached on the Space
- The Space requires an API key — verify HF_API_KEY is set correctly

Please verify your Space is running and try again.`;
}
