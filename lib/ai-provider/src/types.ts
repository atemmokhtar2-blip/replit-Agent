/**
 * AI Provider Abstraction Layer — Core Types
 *
 * Provider-agnostic interfaces for AI capabilities.
 * No provider-specific dependencies. No paid services required.
 *
 * Supported provider slugs:
 *   openrouter | deepseek | qwen | local | custom
 */

export type ProviderSlug =
  | "openrouter"
  | "deepseek"
  | "qwen"
  | "local"
  | "custom";

export type MessageRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: MessageRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  model?: string;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface StreamChunk {
  content: string;
  done: boolean;
  model?: string;
}

export interface ProviderCapabilities {
  chat: boolean;
  streaming: boolean;
  vision: boolean;
  functionCalling: boolean;
  freeModelsAvailable: boolean;
}

export interface ProviderConfig {
  id: string;
  slug: ProviderSlug | string;
  name: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  isActive: boolean;
  config?: Record<string, unknown> | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  isFree?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  model?: string;
}

export interface AIProvider {
  readonly slug: ProviderSlug | string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: ProviderCapabilities;
  readonly defaultBaseUrl?: string;
  readonly defaultModel?: string;
  readonly freeTierNote?: string;

  chat(request: ChatRequest, config: ProviderConfig): Promise<ChatResponse>;
  chatStream(
    request: ChatRequest,
    config: ProviderConfig
  ): AsyncGenerator<StreamChunk>;
  listModels(config: ProviderConfig): Promise<ModelInfo[]>;
  testConnection(config: ProviderConfig): Promise<ConnectionTestResult>;
}

export interface ProviderRegistryEntry {
  provider: AIProvider;
  meta: {
    slug: string;
    name: string;
    description: string;
    capabilities: ProviderCapabilities;
    defaultBaseUrl?: string;
    defaultModel?: string;
    freeTierNote?: string;
  };
}
