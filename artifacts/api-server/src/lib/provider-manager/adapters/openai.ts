import type { ProviderAdapter, LLMMessage, LLMOptions, ProviderError, DiscoveredModel, ModelCategory } from "../types.js";

const TIMEOUT_MS = 55_000;
const BASE_URL   = "https://api.openai.com/v1";

export const openaiAdapter: ProviderAdapter = {
  slug:        "openai",
  displayName: "OpenAI",
  baseUrl:     BASE_URL,
  envPrefix:   "OPENAI_API_KEY",
  defaultModels: {
    planning:      "gpt-4o",
    "code-gen":    "gpt-4o",
    debugging:     "gpt-4o",
    documentation: "gpt-4o-mini",
    review:        "gpt-4o",
    verification:  "gpt-4o-mini",
    general:       "gpt-4o-mini",
  },

  async complete(messages: LLMMessage[], options: LLMOptions, apiKey: string) {
    const model = options.model ?? this.defaultModels[options.taskType ?? "general"];
    const ctrl  = new AbortController();
    const tid   = setTimeout(() => ctrl.abort(new Error("OpenAITimeout")), TIMEOUT_MS);
    const combined = AbortSignal.any
      ? AbortSignal.any([ctrl.signal, ...(options.signal ? [options.signal] : [])])
      : ctrl.signal;

    try {
      const resp = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens:  options.maxTokens  ?? 4096,
          temperature: options.temperature ?? 0.2,
          stream: false,
        }),
        signal: combined,
      });
      clearTimeout(tid);

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        const pe   = this.classifyError(null, resp.status);
        throw Object.assign(new Error(`HTTP ${resp.status}: ${body.slice(0, 120)}`), { providerError: pe });
      }

      const data = await resp.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?:   { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? "";
      if (!content) {
        const pe: ProviderError = { kind: "incomplete_response", message: "Empty OpenAI response", retryable: true, waitMs: 0, suggestNextProvider: false };
        throw Object.assign(new Error("Empty OpenAI response"), { providerError: pe });
      }
      return { content, promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens };
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  },

  async testConnection(apiKey: string) {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: resp.ok, latencyMs: Date.now() - t0, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  async listModels(apiKey: string): Promise<DiscoveredModel[]> {
    try {
      const resp = await fetch(`${BASE_URL}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { data?: Array<{ id: string; owned_by?: string }> };
      const chatModels = (data.data ?? []).filter(m =>
        m.id.startsWith("gpt-") || m.id.startsWith("o1") || m.id.startsWith("o3") || m.id.startsWith("o4"),
      );
      return chatModels.map(m => {
        const id = m.id;
        const isReasoning = id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4");
        const isMini  = id.includes("mini") || id.includes("nano");
        const cats: ModelCategory[] = ["general"];
        if (isReasoning) cats.push("reasoning");
        if (isMini) cats.push("fast");
        if (id.includes("4o")) cats.push("vision");
        cats.push("paid");
        return {
          modelId: id,
          displayName: id,
          isFree: false,
          supportsVision: id.includes("4o") || id.includes("4-turbo"),
          supportsTools: !isReasoning,
          supportsReasoning: isReasoning,
          supportsStreaming: true,
          categories: cats,
          rankScore: isReasoning ? 85 : isMini ? 60 : 75,
        };
      });
    } catch {
      return [];
    }
  },

  classifyError(err: unknown, statusCode?: number): ProviderError {
    const msg   = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (statusCode === 402) return { kind: "insufficient_credits", message: "Insufficient credits",    statusCode: 402, retryable: true,  waitMs: 0,      suggestNextProvider: true  };
    if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",           message: "Auth failed",              statusCode,      retryable: false, waitMs: 0,      suggestNextProvider: true  };
    if (statusCode === 429) return { kind: "rate_limited",         message: "Rate limited",             statusCode: 429, retryable: true,  waitMs: 10_000, suggestNextProvider: false };
    if (statusCode === 408 || statusCode === 504) return { kind: "timeout",              message: "Request timeout",          statusCode,      retryable: true,  waitMs: 0,      suggestNextProvider: true  };
    if (statusCode && statusCode >= 500) return { kind: "server_error",        message: `Server error ${statusCode}`, statusCode, retryable: true,  waitMs: 2_000, suggestNextProvider: false };
    if (lower.includes("abort") || lower.includes("timeout"))      return { kind: "timeout",       message: msg, retryable: true,  waitMs: 0,     suggestNextProvider: true  };
    if (lower.includes("econnrefused") || lower.includes("fetch")) return { kind: "network_error", message: msg, retryable: true,  waitMs: 2_000, suggestNextProvider: true  };
    return { kind: "unknown", message: msg, retryable: true, waitMs: 1_000, suggestNextProvider: false };
  },
};
