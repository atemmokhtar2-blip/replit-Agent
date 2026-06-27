import type { ProviderAdapter, LLMMessage, LLMOptions, ProviderError } from "../types.js";

const TIMEOUT_MS = 55_000;
const BASE_URL   = "https://generativelanguage.googleapis.com/v1beta";

// Map OpenAI-style roles to Gemini roles
function toGeminiContents(messages: LLMMessage[]) {
  const system = messages.find(m => m.role === "system")?.content ?? "";
  const turns  = messages.filter(m => m.role !== "system");
  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: turns.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
}

export const geminiAdapter: ProviderAdapter = {
  slug:        "gemini",
  displayName: "Google Gemini",
  baseUrl:     BASE_URL,
  defaultModels: {
    planning:      "gemini-2.5-flash",
    "code-gen":    "gemini-2.5-flash",
    debugging:     "gemini-2.5-flash",
    documentation: "gemini-1.5-flash",
    review:        "gemini-1.5-flash",
    verification:  "gemini-1.5-flash",
    general:       "gemini-2.5-flash",
  },

  async complete(messages: LLMMessage[], options: LLMOptions, apiKey: string) {
    const model  = options.model ?? this.defaultModels[options.taskType ?? "general"];
    const { systemInstruction, contents } = toGeminiContents(messages);
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(new Error("GeminiTimeout")), TIMEOUT_MS);

    try {
      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          maxOutputTokens: options.maxTokens  ?? 4096,
          temperature:     options.temperature ?? 0.2,
        },
      };
      if (systemInstruction) body["system_instruction"] = systemInstruction;

      const resp = await fetch(
        `${BASE_URL}/models/${model}:generateContent?key=${apiKey}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(body),
          signal:  ctrl.signal,
        },
      );
      clearTimeout(tid);

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        const pe   = this.classifyError(null, resp.status);
        throw Object.assign(new Error(`HTTP ${resp.status}: ${text.slice(0, 120)}`), { providerError: pe });
      }

      const data = await resp.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      if (!content) {
        const pe: ProviderError = { kind: "incomplete_response", message: "Empty Gemini response", retryable: true, waitMs: 0, suggestNextProvider: false };
        throw Object.assign(new Error("Empty Gemini response"), { providerError: pe });
      }
      return {
        content,
        promptTokens:     data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
      };
    } catch (err) {
      clearTimeout(tid);
      throw err;
    }
  },

  async testConnection(apiKey: string) {
    const t0 = Date.now();
    try {
      const resp = await fetch(
        `${BASE_URL}/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      return { ok: resp.ok, latencyMs: Date.now() - t0, error: resp.ok ? undefined : `HTTP ${resp.status}` };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - t0, error: (err as Error).message };
    }
  },

  classifyError(err: unknown, statusCode?: number): ProviderError {
    const msg   = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (statusCode === 400) return { kind: "parse_error",          message: "Bad request",              statusCode, retryable: false, waitMs: 0,     suggestNextProvider: false };
    if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",           message: "Auth failed",              statusCode, retryable: false, waitMs: 0,     suggestNextProvider: true  };
    if (statusCode === 429) return { kind: "rate_limited",         message: "Rate limited",             statusCode: 429, retryable: true,  waitMs: 10_000, suggestNextProvider: false };
    if (statusCode && statusCode >= 500) return { kind: "server_error",        message: `Server error ${statusCode}`, statusCode, retryable: true,  waitMs: 2_000, suggestNextProvider: false };
    if (lower.includes("abort") || lower.includes("timeout"))     return { kind: "timeout",              message: msg,                       retryable: true,  waitMs: 0,     suggestNextProvider: true  };
    if (lower.includes("econnrefused") || lower.includes("fetch")) return { kind: "network_error",       message: msg,                       retryable: true,  waitMs: 2_000, suggestNextProvider: true  };
    return { kind: "unknown", message: msg, retryable: true, waitMs: 1_000, suggestNextProvider: false };
  },
};
