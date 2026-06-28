import type { ProviderAdapter, LLMMessage, LLMOptions, ProviderError } from "../types.js";

const TIMEOUT_MS = 50_000;

// Cloudflare AI Gateway uses: https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/
// OR the Workers AI REST API: https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/{model}
// The apiKey format for this adapter is: "account_id:api_token" (colon-separated)
// We treat the REST API approach so no gateway setup is needed.

export const cloudflareAdapter: ProviderAdapter = {
  slug:        "cloudflare",
  displayName: "Cloudflare AI",
  baseUrl:     "https://api.cloudflare.com/client/v4/accounts",
  envPrefix:   "CLOUDFLARE_API_KEY",
  defaultModels: {
    planning:      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "code-gen":    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    debugging:     "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    documentation: "@cf/meta/llama-3.1-8b-instruct",
    review:        "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    verification:  "@cf/meta/llama-3.1-8b-instruct",
    general:       "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  },

  async complete(messages: LLMMessage[], options: LLMOptions, apiKey: string) {
    // apiKey format: "accountId:token"
    const [accountId, token] = apiKey.split(":") as [string, string];
    if (!accountId || !token) {
      const pe: ProviderError = { kind: "auth_failed", message: "Cloudflare apiKey must be 'accountId:token'", retryable: false, waitMs: 0, suggestNextProvider: true };
      throw Object.assign(new Error("Invalid Cloudflare key format"), { providerError: pe });
    }

    const model  = options.model ?? this.defaultModels[options.taskType ?? "general"];
    const ctrl   = new AbortController();
    const tid    = setTimeout(() => ctrl.abort(new Error("CloudflareTimeout")), TIMEOUT_MS);

    try {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:  `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages,
            max_tokens:  options.maxTokens  ?? 2048,
            temperature: options.temperature ?? 0.2,
          }),
          signal: ctrl.signal,
        },
      );
      clearTimeout(tid);

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        const pe   = this.classifyError(null, resp.status);
        throw Object.assign(new Error(`HTTP ${resp.status}: ${body.slice(0, 120)}`), { providerError: pe });
      }

      const data = await resp.json() as {
        result?: { response?: string };
        success?: boolean;
      };
      const content = data.result?.response ?? "";
      if (!content) {
        const pe: ProviderError = { kind: "incomplete_response", message: "Empty Cloudflare response", retryable: true, waitMs: 0, suggestNextProvider: false };
        throw Object.assign(new Error("Empty Cloudflare AI response"), { providerError: pe });
      }
      return { content };
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  },

  async testConnection(apiKey: string) {
    const t0 = Date.now();
    const [accountId, token] = apiKey.split(":") as [string, string];
    if (!accountId || !token) {
      return { ok: false, latencyMs: 0, error: "Key must be accountId:token" };
    }
    try {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
      return { ok: resp.ok, latencyMs: Date.now() - t0, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  classifyError(err: unknown, statusCode?: number): ProviderError {
    const msg   = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",    message: "Auth failed",              statusCode, retryable: false, waitMs: 0,     suggestNextProvider: true  };
    if (statusCode === 429) return { kind: "rate_limited",   message: "Rate limited",             statusCode: 429, retryable: true,  waitMs: 5_000,  suggestNextProvider: false };
    if (statusCode && statusCode >= 500) return { kind: "server_error",  message: `Server error ${statusCode}`, statusCode, retryable: true,  waitMs: 2_000, suggestNextProvider: false };
    if (lower.includes("abort") || lower.includes("timeout"))      return { kind: "timeout",       message: msg, retryable: true,  waitMs: 0,     suggestNextProvider: true  };
    if (lower.includes("econnrefused") || lower.includes("fetch")) return { kind: "network_error", message: msg, retryable: true,  waitMs: 2_000, suggestNextProvider: true  };
    return { kind: "unknown", message: msg, retryable: true, waitMs: 1_000, suggestNextProvider: false };
  },
};
