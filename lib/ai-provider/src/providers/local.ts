/**
 * Local Provider (Ollama-compatible)
 *
 * Connect to any locally running model server using the Ollama API format.
 * Compatible with: Ollama, LM Studio, Jan.ai, LocalAI, llama.cpp server.
 * Completely free. No API key required.
 *
 * Docs: https://ollama.ai/
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

export class LocalProvider extends BaseProvider {
  readonly slug = "local";
  readonly name = "Local Model";
  readonly description = "Connect to a locally running model server (Ollama, LM Studio, LocalAI, etc.). No API key required.";
  readonly defaultBaseUrl = "http://localhost:11434";
  readonly defaultModel = "llama3.2";
  readonly freeTierNote = "Completely free. Runs on your own hardware. Install Ollama at ollama.ai";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: false,
    functionCalling: false,
    freeModelsAvailable: true,
  };

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const baseUrl = this.resolveBaseUrl(config);
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        options: {
          num_predict: request.maxTokens ?? 2048,
          temperature: request.temperature ?? 0.7,
        },
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Local model error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      message: { content: string };
      model?: string;
      done_reason?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content ?? "",
      model: data.model ?? model,
      finishReason: data.done_reason,
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }

  async *chatStream(request: ChatRequest, config: ProviderConfig): AsyncGenerator<StreamChunk> {
    const baseUrl = this.resolveBaseUrl(config);
    const model = this.resolveModel(request, config);
    const messages = this.buildMessages(request);

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        options: {
          num_predict: request.maxTokens ?? 2048,
          temperature: request.temperature ?? 0.7,
        },
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Local model stream error ${response.status}: ${err}`);
    }

    const reader = response.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line) as {
              message?: { content?: string };
              done?: boolean;
            };
            const content = json.message?.content ?? "";
            if (content) yield { content, done: false };
            if (json.done) yield { content: "", done: true };
          } catch {
            // skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(config: ProviderConfig): Promise<ModelInfo[]> {
    try {
      const baseUrl = this.resolveBaseUrl(config);
      const res = await fetch(`${baseUrl}/api/tags`);
      if (!res.ok) return [];
      const data = await res.json() as { models: { name: string; size?: number }[] };
      return (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        isFree: true,
      }));
    } catch {
      return [];
    }
  }

  async testConnection(config: ProviderConfig): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const baseUrl = this.resolveBaseUrl(config);
      const res = await fetch(`${baseUrl}/api/tags`);
      return {
        ok: res.ok,
        message: res.ok ? "Local server is running" : `HTTP ${res.status} — Is Ollama running?`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Cannot connect to local server: ${String(err)}`,
        latencyMs: Date.now() - start,
      };
    }
  }
}

export const localProvider = new LocalProvider();
