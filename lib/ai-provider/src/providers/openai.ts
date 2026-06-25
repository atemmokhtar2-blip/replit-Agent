/**
 * OpenAI Provider
 *
 * Implements the AIProvider interface for the OpenAI API.
 * Requires: OPENAI_API_KEY environment variable.
 * Supports: GPT-4o, GPT-4o-mini, o1, o3-mini, and all OpenAI chat completion models.
 */

import { BaseProvider } from "./base.js";
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  StreamChunk,
  ProviderConfig,
  ProviderCapabilities,
  ModelInfo,
  ConnectionTestResult,
} from "../types.js";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";

class OpenAIProvider extends BaseProvider implements AIProvider {
  readonly slug = "openai";
  readonly name = "OpenAI";
  readonly description = "OpenAI GPT-4o, o1, o3 models via the official API";
  readonly defaultBaseUrl = OPENAI_BASE_URL;
  readonly defaultModel = DEFAULT_MODEL;
  readonly freeTierNote = "Requires a paid API key from platform.openai.com";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: true,
    functionCalling: true,
    freeModelsAvailable: false,
  };

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const apiKey = this.resolveOpenAIKey(config);
    const baseUrl = this.resolveBaseUrl(config) || OPENAI_BASE_URL;
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);
    const headers = this.buildHeaders(apiKey);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        stream: false,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`OpenAI HTTP ${response.status}: ${errText.slice(0, 300)}`),
        { status: response.status },
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data["choices"] as { message: { content: string | null }; finish_reason: string }[] | undefined;
    const content = choices?.[0]?.message?.content?.trim() ?? "";
    const usage = data["usage"] as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

    return {
      content,
      model: typeof data["model"] === "string" ? data["model"] : model,
      finishReason: choices?.[0]?.finish_reason,
      usage: usage ? {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      } : undefined,
    };
  }

  async *chatStream(request: ChatRequest, config: ProviderConfig): AsyncGenerator<StreamChunk> {
    const apiKey = this.resolveOpenAIKey(config);
    const baseUrl = this.resolveBaseUrl(config) || OPENAI_BASE_URL;
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);
    const headers = this.buildHeaders(apiKey);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`OpenAI HTTP ${response.status}: ${errText.slice(0, 300)}`),
        { status: response.status },
      );
    }

    yield* this.parseSSEStream(response);
  }

  async listModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const apiKey = this.resolveOpenAIKey(config);
    const baseUrl = this.resolveBaseUrl(config) || OPENAI_BASE_URL;
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: this.buildHeaders(apiKey),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return this.defaultModelList();
      const data = await response.json() as { data?: { id: string }[] };
      return (data.data ?? [])
        .filter((m) => m.id.startsWith("gpt") || m.id.startsWith("o1") || m.id.startsWith("o3"))
        .map((m) => ({ id: m.id, name: m.id }));
    } catch {
      return this.defaultModelList();
    }
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const result = await this.chat(
        { messages: [{ role: "user", content: "ping" }], maxTokens: 1 },
        config,
      );
      return { ok: true, message: "Connection successful", latencyMs: Date.now() - start, model: result.model };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, message: msg, latencyMs: Date.now() - start };
    }
  }

  private resolveOpenAIKey(config: ProviderConfig): string {
    return config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
  }

  private defaultModelList(): ModelInfo[] {
    return [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "o1", name: "o1" },
      { id: "o3-mini", name: "o3-mini" },
    ];
  }
}

export const openaiProvider = new OpenAIProvider();
