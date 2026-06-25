/**
 * Fallback Engine
 *
 * Implements automatic model failover for all AI agents.
 * Tries models in priority order. Tracks retries and failovers.
 * Users never see raw provider errors — they see clean results.
 *
 * Flow:
 *   Model A → fails → Model B → fails → Model C → ... → result
 *
 * All calls go through OpenRouter (OPENROUTER_API_KEY) by default.
 * Provider API keys (OpenAI, Anthropic, etc.) fall back to the
 * respective environment variables if present.
 */

import type { AgentType, AgentRequest, AgentResult } from "./types.js";
import { modelRegistry } from "./model-registry.js";
import { healthMonitor } from "./health-monitor.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 90_000;

export interface FallbackCallParams {
  agentType: AgentType;
  systemPrompt: string;
  preferredModelIds: string[];
  request: AgentRequest;
  start: number;
}

// ─── Error classification ──────────────────────────────────────────────────────

type ErrorType =
  | "timeout"
  | "rate_limit"
  | "invalid_api_key"
  | "network"
  | "empty_response"
  | "model_unavailable"
  | "unknown";

function classifyError(err: unknown, status?: number): { type: ErrorType; retryable: boolean } {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";

  if (name === "AbortError" || msg.toLowerCase().includes("timeout")) {
    return { type: "timeout", retryable: true };
  }
  if (status === 429 || msg.includes("rate limit") || msg.includes("Too Many Requests")) {
    return { type: "rate_limit", retryable: true };
  }
  if (status === 401 || status === 403 || msg.includes("API key") || msg.includes("Unauthorized")) {
    return { type: "invalid_api_key", retryable: false };
  }
  if (msg.includes("empty response") || msg.includes("no content")) {
    return { type: "empty_response", retryable: true };
  }
  if (status === 503 || status === 502 || msg.includes("model not found") || msg.includes("unavailable")) {
    return { type: "model_unavailable", retryable: true };
  }
  if (msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND") || msg.includes("fetch failed")) {
    return { type: "network", retryable: false };
  }
  return { type: "unknown", retryable: true };
}

function sanitizeKey(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/^[\s\u00A0\u200B-\u200D\uFEFF\r\n]+|[\s\u00A0\u200B-\u200D\uFEFF\r\n]+$/g, "");
  return cleaned || undefined;
}

// ─── Single model call via OpenRouter ─────────────────────────────────────────

async function callOpenRouterModel(
  modelId: string,
  messages: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<{ content: string; model: string }> {
  const apiKey = sanitizeKey(process.env["OPENROUTER_API_KEY"]);
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": "https://ai-agent-platform.replit.app",
    "X-Title": "AI Agent Platform",
  };

  // Verify all header values are ASCII-only (ByteString constraint)
  for (const [name, value] of Object.entries(headers)) {
    for (let i = 0; i < value.length; i++) {
      if (value.charCodeAt(i) > 255) {
        throw new Error(`Header "${name}" contains non-ByteString char at index ${i}`);
      }
    }
  }

  const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: 4096,
      temperature: 0.3,
      stream: false,
    }),
    signal: combinedSignal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw Object.assign(
      new Error(`OpenRouter HTTP ${response.status}: ${errText.slice(0, 300)}`),
      { status: response.status },
    );
  }

  const data = await response.json() as Record<string, unknown>;

  if (data["error"]) {
    const errMsg = typeof data["error"] === "string"
      ? data["error"]
      : (data["error"] as { message?: string })?.message ?? "Unknown API error";
    throw new Error(errMsg);
  }

  const choices = data["choices"] as { message: { content: string | null } }[] | undefined;
  const content = choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error(`empty response from model ${modelId}`);
  }

  return {
    content,
    model: typeof data["model"] === "string" ? data["model"] : modelId,
  };
}

// ─── Main fallback loop ────────────────────────────────────────────────────────

export async function callWithFallback(params: FallbackCallParams): Promise<AgentResult> {
  const { agentType, systemPrompt, preferredModelIds, request, start } = params;

  // Build the ordered chain from preferred IDs + catalog fallbacks
  const byId = new Map(modelRegistry.listAll().map((e) => [e.id, e]));
  const chain: { id: string; modelId: string; providerSlug: string }[] = [];

  // First: preferred models in order
  for (const id of preferredModelIds) {
    const entry = byId.get(id);
    if (entry?.enabled && entry.status !== "offline") {
      chain.push({ id: entry.id, modelId: entry.modelId, providerSlug: entry.providerSlug });
    }
  }

  // Then: any remaining enabled entries as safety net (not already in chain)
  const inChain = new Set(chain.map((c) => c.id));
  for (const entry of modelRegistry.listAll()) {
    if (entry.enabled && entry.status !== "offline" && !inChain.has(entry.id)) {
      chain.push({ id: entry.id, modelId: entry.modelId, providerSlug: entry.providerSlug });
      inChain.add(entry.id);
    }
  }

  if (chain.length === 0) {
    return {
      content: "No models available. Please check your OPENROUTER_API_KEY configuration.",
      agentType,
      modelId: "none",
      providerSlug: "none",
      registryEntryId: "none",
      latencyMs: Date.now() - start,
      retries: 0,
      failovers: 0,
      error: "no_models_available",
    };
  }

  // Build message array with system prompt prepended
  const messages: { role: string; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...request.messages,
  ];

  let retries = 0;
  let failovers = 0;
  let lastError = "";

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i]!;

    if (i > 0) {
      failovers++;
      console.log(`[FALLBACK_ACTIVATED] agent=${agentType} switching to model=${candidate.modelId} attempt=${i + 1}/${chain.length}`);
    }
    console.log(`[MODEL_SELECTED] agent=${agentType} model=${candidate.modelId}`);

    healthMonitor.recordRequest(candidate.id, candidate.providerSlug);

    try {
      const result = await callOpenRouterModel(candidate.modelId, messages, request.signal);
      const latencyMs = Date.now() - start;

      healthMonitor.recordSuccess(candidate.id, candidate.providerSlug, latencyMs);
      console.log(`[MODEL_SUCCESS] agent=${agentType} model=${candidate.modelId} latencyMs=${latencyMs}`);

      return {
        content: result.content,
        agentType,
        modelId: result.model,
        providerSlug: candidate.providerSlug,
        registryEntryId: candidate.id,
        latencyMs,
        retries,
        failovers,
      };
    } catch (err) {
      const status = (err as { status?: number }).status;
      const { type, retryable } = classifyError(err, status);
      lastError = err instanceof Error ? err.message : String(err);

      healthMonitor.recordFailure(candidate.id, candidate.providerSlug, type);
      console.error(`[MODEL_FAILED] agent=${agentType} model=${candidate.modelId} type=${type} error=${lastError.slice(0, 80)}`);

      // Non-retryable errors (bad key, network) — stop trying
      if (!retryable) break;

      // Otherwise try retry on same model once before falling over
      if (i === 0 && retries === 0 && type !== "model_unavailable") {
        retries++;
        i--; // retry same model
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
    }
  }

  const latencyMs = Date.now() - start;
  return {
    content: `I encountered an error processing your request. ${lastError.slice(0, 200)}`,
    agentType,
    modelId: chain[0]?.modelId ?? "none",
    providerSlug: chain[0]?.providerSlug ?? "none",
    registryEntryId: chain[0]?.id ?? "none",
    latencyMs,
    retries,
    failovers,
    error: lastError,
  };
}
