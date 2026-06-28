import type { ProviderAdapter, LLMMessage, LLMOptions, ProviderError, DiscoveredModel, ModelCategory } from "../types.js";

const TIMEOUT_MS = 55_000;
const BASE_URL   = "https://api.cohere.com/v2";

export const cohereAdapter: ProviderAdapter = {
  slug:        "cohere",
  displayName: "Cohere",
  baseUrl:     BASE_URL,
  envPrefix:   "COHERE_API_KEY",
  defaultModels: {
    planning:      "command-r-plus-08-2024",
    "code-gen":    "command-r-plus-08-2024",
    debugging:     "command-r-plus-08-2024",
    documentation: "command-r-08-2024",
    review:        "command-r-plus-08-2024",
    verification:  "command-r-08-2024",
    general:       "command-r-08-2024",
  },

  async complete(messages: LLMMessage[], options: LLMOptions, apiKey: string) {
    const model = options.model ?? this.defaultModels[options.taskType ?? "general"];
    const ctrl  = new AbortController();
    const tid   = setTimeout(() => ctrl.abort(new Error("CohereTimeout")), TIMEOUT_MS);
    const combined = AbortSignal.any
      ? AbortSignal.any([ctrl.signal, ...(options.signal ? [options.signal] : [])])
      : ctrl.signal;

    // Cohere v2 uses OpenAI-compatible chat format
    try {
      const resp = await fetch(`${BASE_URL}/chat`, {
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
        message?: { content?: Array<{ type: string; text?: string }> };
        usage?:   { tokens?: { input_tokens?: number; output_tokens?: number } };
      };
      const content = data.message?.content?.find(b => b.type === "text")?.text ?? "";
      if (!content) {
        const pe: ProviderError = { kind: "incomplete_response", message: "Empty Cohere response", retryable: true, waitMs: 0, suggestNextProvider: false };
        throw Object.assign(new Error("Empty Cohere response"), { providerError: pe });
      }
      return {
        content,
        promptTokens:     data.usage?.tokens?.input_tokens,
        completionTokens: data.usage?.tokens?.output_tokens,
      };
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  },

  async testConnection(apiKey: string) {
    const t0 = Date.now();
    try {
      const resp = await fetch("https://api.cohere.com/v1/models", {
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
      const resp = await fetch("https://api.cohere.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { models?: Array<{ name: string; endpoints?: string[]; context_length?: number }> };
      return (data.models ?? [])
        .filter(m => m.endpoints?.includes("chat"))
        .map(m => {
          const isPlus = m.name.includes("plus");
          const cats: ModelCategory[] = ["general", "paid"];
          if (!isPlus) cats.push("fast");
          if (m.context_length && m.context_length >= 100_000) cats.push("long-context");
          return {
            modelId:           m.name,
            displayName:       m.name,
            contextLength:     m.context_length,
            isFree:            false,
            supportsVision:    false,
            supportsTools:     true,
            supportsReasoning: false,
            supportsStreaming:  true,
            categories:        cats,
            rankScore:         isPlus ? 70 : 58,
          };
        });
    } catch {
      return [];
    }
  },

  classifyError(err: unknown, statusCode?: number): ProviderError {
    const msg   = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",    message: "Auth failed", statusCode, retryable: false, waitMs: 0,     suggestNextProvider: true  };
    if (statusCode === 429) return { kind: "rate_limited",   message: "Rate limited", statusCode: 429, retryable: true,  waitMs: 8_000, suggestNextProvider: false };
    if (statusCode && statusCode >= 500) return { kind: "server_error",  message: `Server error ${statusCode}`, statusCode, retryable: true, waitMs: 2_000, suggestNextProvider: false };
    if (lower.includes("abort") || lower.includes("timeout"))      return { kind: "timeout",       message: msg, retryable: true, waitMs: 0,     suggestNextProvider: true  };
    if (lower.includes("econnrefused") || lower.includes("fetch")) return { kind: "network_error", message: msg, retryable: true, waitMs: 2_000, suggestNextProvider: true  };
    return { kind: "unknown", message: msg, retryable: true, waitMs: 1_000, suggestNextProvider: false };
  },
};
