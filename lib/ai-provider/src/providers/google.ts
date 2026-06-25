/**
 * Google AI Provider (Gemini)
 *
 * Implements the AIProvider interface for Google's Gemini API.
 * Requires: GOOGLE_AI_API_KEY or GEMINI_API_KEY environment variable.
 * Supports: gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash, etc.
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

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.0-flash";

class GoogleAIProvider extends BaseProvider implements AIProvider {
  readonly slug = "google";
  readonly name = "Google AI";
  readonly description = "Google Gemini 2.0 Flash, 1.5 Pro/Flash via the Gemini API";
  readonly defaultBaseUrl = GOOGLE_BASE_URL;
  readonly defaultModel = DEFAULT_MODEL;
  readonly freeTierNote = "Free tier available at aistudio.google.com";
  readonly capabilities: ProviderCapabilities = {
    chat: true,
    streaming: true,
    vision: true,
    functionCalling: true,
    freeModelsAvailable: true,
  };

  async chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const apiKey = this.resolveGoogleKey(config);
    const baseUrl = this.resolveBaseUrl(config) || GOOGLE_BASE_URL;
    const model = this.resolveModel(request, config);
    const body = this.buildGeminiBody(request);

    const response = await fetch(
      `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`Google AI HTTP ${response.status}: ${errText.slice(0, 300)}`),
        { status: response.status },
      );
    }

    const data = await response.json() as Record<string, unknown>;
    const content = this.extractGeminiContent(data);
    const usage = data["usageMetadata"] as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

    return {
      content,
      model,
      usage: usage ? {
        promptTokens: usage.promptTokenCount,
        completionTokens: usage.candidatesTokenCount,
        totalTokens: (usage.promptTokenCount ?? 0) + (usage.candidatesTokenCount ?? 0),
      } : undefined,
    };
  }

  async *chatStream(request: ChatRequest, config: ProviderConfig): AsyncGenerator<StreamChunk> {
    const apiKey = this.resolveGoogleKey(config);
    const baseUrl = this.resolveBaseUrl(config) || GOOGLE_BASE_URL;
    const model = this.resolveModel(request, config);
    const body = this.buildGeminiBody(request);

    const response = await fetch(
      `${baseUrl}/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      },
    );

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw Object.assign(
        new Error(`Google AI HTTP ${response.status}: ${errText.slice(0, 300)}`),
        { status: response.status },
      );
    }

    if (!response.body) throw new Error("No response body for streaming");

    // Google SSE uses a different structure — parse it manually
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
            const data = JSON.parse(jsonStr) as Record<string, unknown>;
            const text = this.extractGeminiContent(data);
            if (text) yield { content: text, done: false };
          } catch {
            // skip malformed lines
          }
        }
      }
      yield { content: "", done: true };
    } finally {
      reader.releaseLock();
    }
  }

  async listModels(_config: ProviderConfig): Promise<ModelInfo[]> {
    return [
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
      { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
      { id: "gemini-1.5-flash-8b", name: "Gemini 1.5 Flash 8B" },
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

  private resolveGoogleKey(config: ProviderConfig): string {
    return config.apiKey ?? process.env["GOOGLE_AI_API_KEY"] ?? process.env["GEMINI_API_KEY"] ?? "";
  }

  private buildGeminiBody(request: ChatRequest) {
    const contents: { role: string; parts: { text: string }[] }[] = [];
    let systemInstruction: { parts: { text: string }[] } | undefined;

    if (request.systemPrompt) {
      systemInstruction = { parts: [{ text: request.systemPrompt }] };
    }

    for (const msg of request.messages) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: msg.content }] };
        continue;
      }
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }

    return {
      ...(systemInstruction ? { system_instruction: systemInstruction } : {}),
      contents,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
      },
    };
  }

  private extractGeminiContent(data: Record<string, unknown>): string {
    const candidates = data["candidates"] as {
      content?: { parts?: { text?: string }[] };
    }[] | undefined;
    return candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
}

export const googleAIProvider = new GoogleAIProvider();
