/**
 * DeepSeek Provider
 *
 * DeepSeek offers highly capable open-weight models via a low-cost API.
 * Free credits on registration. OpenAI-compatible API.
 *
 * Docs: https://platform.deepseek.com/api-docs
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

const MODELS: ModelInfo[] = [
  { id: "deepseek-chat", name: "DeepSeek Chat (V3)", contextLength: 65536 },
  { id: "deepseek-reasoner", name: "DeepSeek Reasoner (R1)", contextLength: 65536 },
];

export class DeepSeekProvider extends BaseProvider {
  readonly slug = "deepseek";
  readonly name = "DeepSeek";
  readonly description = "High-quality open-weight models with competitive pricing. Free credits on sign-up.";
  readonly defaultBaseUrl = "https://api.deepseek.com/v1";
  readonly defaultModel = "deepseek-chat";
  readonly freeTierNote = "Free credits on registration at platform.deepseek.com";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: false,
    functionCalling: true,
    freeModelsAvailable: true,
  };

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const baseUrl = this.resolveBaseUrl(config);
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 1.0,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek error ${response.status}: ${err}`);
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
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 1.0,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek stream error ${response.status}: ${err}`);
    }

    yield* this.parseSSEStream(response);
  }

  async listModels(_config: ProviderConfig): Promise<ModelInfo[]> {
    return MODELS;
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const baseUrl = this.resolveBaseUrl(config);
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

export const deepseekProvider = new DeepSeekProvider();
