import type { ProviderAdapter, LLMMessage, LLMOptions, ProviderError, DiscoveredModel, ModelCategory } from "../types.js";

const TIMEOUT_MS = 55_000;
const BASE_URL   = "https://api.anthropic.com/v1";

// Well-known Anthropic models (Anthropic does not have a public list-models endpoint)
const ANTHROPIC_MODELS: Array<{ id: string; contextLength: number; inputPrice: number; outputPrice: number; fast: boolean }> = [
  { id: "claude-opus-4-5",   contextLength: 200_000, inputPrice: 15,   outputPrice: 75,   fast: false },
  { id: "claude-sonnet-4-5", contextLength: 200_000, inputPrice: 3,    outputPrice: 15,   fast: false },
  { id: "claude-haiku-3-5",  contextLength: 200_000, inputPrice: 0.8,  outputPrice: 4,    fast: true  },
  { id: "claude-opus-4-0",   contextLength: 200_000, inputPrice: 15,   outputPrice: 75,   fast: false },
  { id: "claude-sonnet-4-0", contextLength: 200_000, inputPrice: 3,    outputPrice: 15,   fast: false },
  { id: "claude-haiku-3",    contextLength: 200_000, inputPrice: 0.25, outputPrice: 1.25, fast: true  },
];

function toAnthropicMessages(messages: LLMMessage[]): { system?: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const system = messages.find(m => m.role === "system")?.content;
  const turns  = messages.filter(m => m.role !== "system").map(m => ({
    role:    m.role as "user" | "assistant",
    content: m.content,
  }));
  return { system, messages: turns };
}

export const anthropicAdapter: ProviderAdapter = {
  slug:        "anthropic",
  displayName: "Anthropic Claude",
  baseUrl:     BASE_URL,
  envPrefix:   "ANTHROPIC_API_KEY",
  defaultModels: {
    planning:      "claude-sonnet-4-5",
    "code-gen":    "claude-opus-4-5",
    debugging:     "claude-sonnet-4-5",
    documentation: "claude-haiku-3-5",
    review:        "claude-sonnet-4-5",
    verification:  "claude-haiku-3-5",
    general:       "claude-haiku-3-5",
  },

  async complete(messages: LLMMessage[], options: LLMOptions, apiKey: string) {
    const model = options.model ?? this.defaultModels[options.taskType ?? "general"];
    const { system, messages: turns } = toAnthropicMessages(messages);
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(new Error("AnthropicTimeout")), TIMEOUT_MS);
    const combined = AbortSignal.any
      ? AbortSignal.any([ctrl.signal, ...(options.signal ? [options.signal] : [])])
      : ctrl.signal;

    try {
      const body: Record<string, unknown> = {
        model,
        messages: turns,
        max_tokens:  options.maxTokens  ?? 4096,
        temperature: options.temperature ?? 0.2,
      };
      if (system) body["system"] = system;

      const resp = await fetch(`${BASE_URL}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key":    apiKey,
          "anthropic-version": "2023-06-01",
        },
        body:   JSON.stringify(body),
        signal: combined,
      });
      clearTimeout(tid);

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const pe   = this.classifyError(null, resp.status);
        throw Object.assign(new Error(`HTTP ${resp.status}: ${text.slice(0, 120)}`), { providerError: pe });
      }

      const data = await resp.json() as {
        content?: Array<{ type: string; text?: string }>;
        usage?:   { input_tokens?: number; output_tokens?: number };
      };
      const content = data.content?.find(b => b.type === "text")?.text ?? "";
      if (!content) {
        const pe: ProviderError = { kind: "incomplete_response", message: "Empty Anthropic response", retryable: true, waitMs: 0, suggestNextProvider: false };
        throw Object.assign(new Error("Empty Anthropic response"), { providerError: pe });
      }
      return { content, promptTokens: data.usage?.input_tokens, completionTokens: data.usage?.output_tokens };
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  },

  async testConnection(apiKey: string) {
    const t0 = Date.now();
    try {
      const resp = await fetch(`${BASE_URL}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-3",
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const ok = resp.ok || resp.status === 200;
      return { ok: resp.ok, latencyMs: Date.now() - t0, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  async listModels(_apiKey: string): Promise<DiscoveredModel[]> {
    return ANTHROPIC_MODELS.map(m => {
      const cats: ModelCategory[] = ["general", "paid"];
      if (m.fast) cats.push("fast");
      if (!m.fast) cats.push("reasoning");
      if (m.contextLength >= 100_000) cats.push("long-context");
      cats.push("vision");
      return {
        modelId:           m.id,
        displayName:       m.id,
        contextLength:     m.contextLength,
        inputPricePer1M:   m.inputPrice,
        outputPricePer1M:  m.outputPrice,
        isFree:            false,
        supportsVision:    true,
        supportsTools:     true,
        supportsReasoning: !m.fast,
        supportsStreaming:  true,
        categories:        cats,
        rankScore:         m.fast ? 65 : 88,
      };
    });
  },

  classifyError(err: unknown, statusCode?: number): ProviderError {
    const msg   = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (statusCode === 402) return { kind: "insufficient_credits", message: "Insufficient credits", statusCode: 402, retryable: true,  waitMs: 0,      suggestNextProvider: true  };
    if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",    message: "Auth failed", statusCode, retryable: false, waitMs: 0, suggestNextProvider: true  };
    if (statusCode === 429) return { kind: "rate_limited",   message: "Rate limited", statusCode: 429, retryable: true,  waitMs: 12_000, suggestNextProvider: false };
    if (statusCode && statusCode >= 500) return { kind: "server_error",  message: `Server error ${statusCode}`, statusCode, retryable: true, waitMs: 2_000, suggestNextProvider: false };
    if (lower.includes("abort") || lower.includes("timeout"))      return { kind: "timeout",       message: msg, retryable: true, waitMs: 0,     suggestNextProvider: true  };
    if (lower.includes("econnrefused") || lower.includes("fetch")) return { kind: "network_error", message: msg, retryable: true, waitMs: 2_000, suggestNextProvider: true  };
    return { kind: "unknown", message: msg, retryable: true, waitMs: 1_000, suggestNextProvider: false };
  },
};
