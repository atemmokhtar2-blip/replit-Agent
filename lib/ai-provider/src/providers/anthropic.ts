/**
 * Anthropic Provider
 *
 * Implements the AIProvider interface for the Anthropic API (Claude models).
 * Requires: ANTHROPIC_API_KEY environment variable.
 * Supports: claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus, and all Claude models.
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

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-3-5-haiku-20241022";

class AnthropicProvider extends BaseProvider implements AIProvider {
  readonly slug = "anthropic";
  readonly name = "Anthropic";
  readonly description = "Anthropic Claude 3.5 Sonnet, Haiku, Opus via the official API";
  readonly defaultBaseUrl = ANTHROPIC_BASE_URL;
  readonly defaultModel = DEFAULT_MODEL;
  readonly freeTierNote = "Requires a paid API key from console.anthropic.com";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: true,
    functionCalling: true,
    freeModelsAvailable: false,
  };

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const apiKey = this.resolveAnthropicKey(config);
    const baseUrl = this.resolveBaseUrl(config) || ANTHROPIC_BASE_URL;
    const model = this.resolveModel(request, config);
    const { system, messages } = this.splitSystemMessages(request);

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(system ? { system } : {}),
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`Anthropic HTTP ${response.status}: ${errText.slice(0, 300)}`),
        { status: response.status },
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const contentBlocks = data["content"] as { type: string; text?: string }[] | undefined;
    const content = contentBlocks?.filter((b) => b.type === "text").map((b) => b.text ?? "").join("") ?? "";
    const usage = data["usage"] as { input_tokens?: number; output_tokens?: number } | undefined;

    return {
      content,
      model: typeof data["model"] === "string" ? data["model"] : model,
      finishReason: data["stop_reason"] as string | undefined,
      usage: usage ? {
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      } : undefined,
    };
  }

  async *chatStream(request: ChatRequest, config: ProviderConfig): AsyncGenerator<StreamChunk> {
    const apiKey = this.resolveAnthropicKey(config);
    const baseUrl = this.resolveBaseUrl(config) || ANTHROPIC_BASE_URL;
    const model = this.resolveModel(request, config);
    const { system, messages } = this.splitSystemMessages(request);

    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        messages,
        ...(system ? { system } : {}),
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        stream: true,
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`Anthropic HTTP ${response.status}: ${errText.slice(0, 300)}`),
        { status: response.status },
      );
    }

    if (!response.body) throw new Error("No response body for streaming");

    // Anthropic SSE has a different format — parse it manually
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const jsonStr = trimmed.slice(6);
          if (jsonStr === "[DONE]") { yield { content: "", done: true }; continue; }
          try {
            const evt = JSON.parse(jsonStr) as { type?: string; delta?: { type?: string; text?: string } };
            if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
              const text = evt.delta.text ?? "";
              if (text) yield { content: text, done: false };
            } else if (evt.type === "message_stop") {
              yield { content: "", done: true };
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(_config: ProviderConfig): Promise<ModelInfo[]> {
    return [
      { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
      { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
      { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
      { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
      { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
    ];
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

  private resolveAnthropicKey(config: ProviderConfig): string {
    return config.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? "";
  }

  private splitSystemMessages(request: ChatRequest): {
    system?: string;
    messages: { role: string; content: string }[];
  } {
    let system = request.systemPrompt;
    const systemMsgs = request.messages.filter((m) => m.role === "system");
    if (systemMsgs.length > 0) system = systemMsgs.map((m) => m.content).join("\n\n");
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));
    return { system, messages };
  }
}

export const anthropicProvider = new AnthropicProvider();
