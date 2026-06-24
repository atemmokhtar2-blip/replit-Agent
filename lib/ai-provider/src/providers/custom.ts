/**
 * Custom Provider
 *
 * Connect to any OpenAI-compatible API endpoint.
 * Works with: self-hosted vLLM, LiteLLM proxy, OpenLLM, TGI, FastChat,
 *             Qwen-API, Together AI, Groq, Mistral, Anyscale, Perplexity, etc.
 *
 * Requires: baseUrl pointing to the /v1 endpoint of your server.
 */

import { BaseProvider } from "./base.js";
import type {
  ChatRequest,
  ChatResponse,
  ConnectionTestResult,
  ModelInfo,
  ProviderCapabilities,
  ProviderConfig,
  StreamChunk,
} from "../types.js";

export class CustomProvider extends BaseProvider {
  readonly slug = "custom";
  readonly name = "Custom Endpoint";
  readonly description = "Any OpenAI-compatible API (vLLM, LiteLLM, Together AI, Groq, Mistral, etc.)";
  readonly defaultBaseUrl = "";
  readonly defaultModel = "default";
  readonly freeTierNote = "Works with any self-hosted or third-party OpenAI-compatible server.";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: false,
    functionCalling: false,
    freeModelsAvailable: true,
  };

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const baseUrl = this.resolveBaseUrl(config);
    if (!baseUrl) throw new Error("Custom provider requires a base URL");

    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Custom provider error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string }; finish_reason: string }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? "",
      model: data.model ?? model,
      finishReason: data.choices[0]?.finish_reason,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async *chatStream(request: ChatRequest, config: ProviderConfig): AsyncGenerator<StreamChunk> {
    const baseUrl = this.resolveBaseUrl(config);
    if (!baseUrl) throw new Error("Custom provider requires a base URL");

    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Custom stream error ${response.status}: ${err}`);
    }

    yield* this.parseSSEStream(response);
  }

  async listModels(config: ProviderConfig): Promise<ModelInfo[]> {
    try {
      const baseUrl = this.resolveBaseUrl(config);
      if (!baseUrl) return [];
      const res = await fetch(`${baseUrl}/models`, {
        headers: this.buildHeaders(config.apiKey),
      });
      if (!res.ok) return [];
      const data = await res.json() as { data: { id: string }[] };
      return (data.data ?? []).map((m) => ({ id: m.id, name: m.id, isFree: true }));
    } catch {
      return [];
    }
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const baseUrl = this.resolveBaseUrl(config);
      if (!baseUrl) return { ok: false, message: "No base URL configured" };
      const res = await fetch(`${baseUrl}/models`, {
        headers: this.buildHeaders(config.apiKey),
      });
      return {
        ok: res.ok,
        message: res.ok ? "Connection successful" : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return { ok: false, message: String(err), latencyMs: Date.now() - start };
    }
  }
}

export const customProvider = new CustomProvider();
