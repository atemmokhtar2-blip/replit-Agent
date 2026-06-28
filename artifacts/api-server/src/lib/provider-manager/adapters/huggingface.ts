import type { ProviderAdapter, LLMMessage, LLMOptions, ProviderError, DiscoveredModel, ModelCategory } from "../types.js";

const TIMEOUT_MS = 55_000;
const BASE_URL   = "https://api-inference.huggingface.co/v1";

export const huggingfaceAdapter: ProviderAdapter = {
  slug:        "huggingface",
  displayName: "HuggingFace",
  baseUrl:     BASE_URL,
  envPrefix:   "HUGGINGFACE_API_KEY",
  defaultModels: {
    planning:      "meta-llama/Llama-3.3-70B-Instruct",
    "code-gen":    "Qwen/Qwen2.5-Coder-32B-Instruct",
    debugging:     "Qwen/Qwen2.5-Coder-32B-Instruct",
    documentation: "meta-llama/Llama-3.1-8B-Instruct",
    review:        "meta-llama/Llama-3.3-70B-Instruct",
    verification:  "meta-llama/Llama-3.1-8B-Instruct",
    general:       "meta-llama/Llama-3.1-8B-Instruct",
  },

  async complete(messages: LLMMessage[], options: LLMOptions, apiKey: string) {
    const model = options.model ?? this.defaultModels[options.taskType ?? "general"];
    const ctrl  = new AbortController();
    const tid   = setTimeout(() => ctrl.abort(new Error("HuggingFaceTimeout")), TIMEOUT_MS);
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
        const pe: ProviderError = { kind: "incomplete_response", message: "Empty HuggingFace response", retryable: true, waitMs: 0, suggestNextProvider: false };
        throw Object.assign(new Error("Empty HuggingFace response"), { providerError: pe });
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
      const resp = await fetch("https://huggingface.co/api/whoami-v2", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: resp.ok, latencyMs: Date.now() - t0, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  async listModels(_apiKey: string): Promise<DiscoveredModel[]> {
    // HF has millions of models; return a curated set of popular chat models
    const popular: Array<{ id: string; coder: boolean; large: boolean }> = [
      { id: "meta-llama/Llama-3.3-70B-Instruct",      coder: false, large: true  },
      { id: "meta-llama/Llama-3.1-8B-Instruct",       coder: false, large: false },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct",        coder: true,  large: true  },
      { id: "Qwen/Qwen2.5-72B-Instruct",              coder: false, large: true  },
      { id: "mistralai/Mistral-7B-Instruct-v0.3",     coder: false, large: false },
      { id: "mistralai/Mixtral-8x7B-Instruct-v0.1",   coder: false, large: true  },
      { id: "google/gemma-2-9b-it",                   coder: false, large: false },
      { id: "microsoft/Phi-3.5-mini-instruct",        coder: false, large: false },
    ];
    return popular.map(m => {
      const cats: ModelCategory[] = ["general", "free"];
      if (m.coder)  cats.push("coding");
      if (!m.large) cats.push("fast");
      return {
        modelId:           m.id,
        displayName:       m.id.split("/")[1] ?? m.id,
        isFree:            true,
        supportsVision:    false,
        supportsTools:     false,
        supportsReasoning: false,
        supportsStreaming:  true,
        categories:        cats,
        rankScore:         m.large ? (m.coder ? 68 : 62) : 50,
      };
    });
  },

  classifyError(err: unknown, statusCode?: number): ProviderError {
    const msg   = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",    message: "Auth failed", statusCode, retryable: false, waitMs: 0,     suggestNextProvider: true  };
    if (statusCode === 429) return { kind: "rate_limited",   message: "Rate limited", statusCode: 429, retryable: true,  waitMs: 10_000, suggestNextProvider: false };
    if (statusCode === 503) return { kind: "server_error",   message: "Model loading", statusCode: 503, retryable: true,  waitMs: 20_000, suggestNextProvider: false };
    if (statusCode && statusCode >= 500) return { kind: "server_error",  message: `Server error ${statusCode}`, statusCode, retryable: true, waitMs: 2_000, suggestNextProvider: false };
    if (lower.includes("abort") || lower.includes("timeout"))      return { kind: "timeout",       message: msg, retryable: true, waitMs: 0,     suggestNextProvider: true  };
    if (lower.includes("econnrefused") || lower.includes("fetch")) return { kind: "network_error", message: msg, retryable: true, waitMs: 2_000, suggestNextProvider: true  };
    return { kind: "unknown", message: msg, retryable: true, waitMs: 1_000, suggestNextProvider: false };
  },
};
