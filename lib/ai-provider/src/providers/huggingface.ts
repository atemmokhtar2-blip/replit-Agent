/**
 * HuggingFace Space Provider
 *
 * Calls HuggingFace Spaces that expose an OpenAI-compatible
 * /v1/chat/completions endpoint (e.g. Text Generation Inference Spaces).
 *
 * Configure base_url to your Space's root URL, e.g.:
 *   https://your-username-your-space.hf.space
 *
 * The provider appends /v1/chat/completions automatically.
 * It never constructs api-inference.huggingface.co URLs.
 *
 * Docs: https://huggingface.co/docs/text-generation-inference
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

const SPACE_MODELS: ModelInfo[] = [
  { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B Instruct", isFree: true, contextLength: 32768 },
  { id: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B Instruct", isFree: true, contextLength: 131072 },
  { id: "HuggingFaceH4/zephyr-7b-beta", name: "Zephyr 7B Beta", isFree: true, contextLength: 32768 },
  { id: "microsoft/Phi-3.5-mini-instruct", name: "Phi-3.5 Mini Instruct", isFree: true, contextLength: 131072 },
  { id: "Qwen/Qwen2.5-7B-Instruct", name: "Qwen 2.5 7B Instruct", isFree: true, contextLength: 32768 },
  { id: "google/gemma-2-2b-it", name: "Gemma 2 2B IT", isFree: true, contextLength: 8192 },
];

export class HuggingFaceProvider extends BaseProvider {
  readonly slug = "huggingface";
  readonly name = "Hugging Face";
  readonly description =
    "HuggingFace Spaces with OpenAI-compatible endpoints (Text Generation Inference). Set base_url to your Space root URL.";
  readonly defaultBaseUrl = "";
  readonly defaultModel = "mistralai/Mistral-7B-Instruct-v0.3";
  readonly freeTierNote =
    "Use any public Space with a TGI-compatible endpoint. Set base_url to your Space URL.";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: false,
    functionCalling: false,
    freeModelsAvailable: true,
  };

  private resolveEndpoint(config: ProviderConfig): string {
    const base = this.resolveBaseUrl(config);
    if (!base) {
      throw new Error(
        "HuggingFace provider requires a base_url (your Space URL). " +
          "Configure it in Settings → AI Providers. Example: https://your-username-your-space.hf.space",
      );
    }
    return `${base}/v1/chat/completions`;
  }

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const endpoint = this.resolveEndpoint(config);
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.buildHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.7,
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HuggingFace Space error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string }; finish_reason: string }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    return {
      content: data.choices[0]?.message?.content ?? "",
      model,
      finishReason: data.choices[0]?.finish_reason,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *chatStream(
    request: ChatRequest,
    config: ProviderConfig,
  ): AsyncGenerator<StreamChunk> {
    const endpoint = this.resolveEndpoint(config);
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.buildHeaders(config.apiKey),
      body: JSON.stringify({
        model,
        messages,
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HuggingFace Space stream error ${response.status}: ${err}`);
    }

    yield* this.parseSSEStream(response);
  }

  async listModels(_config: ProviderConfig): Promise<ModelInfo[]> {
    return SPACE_MODELS;
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const endpoint = this.resolveEndpoint(config);
      const model = config.defaultModel ?? this.defaultModel!;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: this.buildHeaders(config.apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 5,
          stream: false,
        }),
      });
      const ok = res.status === 200 || res.status === 503;
      return {
        ok,
        message: ok ? "Connection successful" : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
        model,
      };
    } catch (err) {
      return {
        ok: false,
        message: String(err),
        latencyMs: Date.now() - start,
      };
    }
  }
}

export const huggingfaceProvider = new HuggingFaceProvider();
