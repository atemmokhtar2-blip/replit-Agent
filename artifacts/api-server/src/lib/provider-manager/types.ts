/**
 * Enterprise AI Provider Manager — Type Definitions
 */

// ── Task types ─────────────────────────────────────────────────────────────────

export type TaskType =
  | "planning"
  | "code-gen"
  | "debugging"
  | "documentation"
  | "review"
  | "verification"
  | "general";

// ── Load balancing strategies ─────────────────────────────────────────────────

export type RoutingStrategy =
  | "round-robin"
  | "least-recently-used"
  | "lowest-latency"
  | "random"
  | "priority"
  | "least-failures";

// ── Provider status ────────────────────────────────────────────────────────────

export type ProviderStatus = "healthy" | "degraded" | "unhealthy" | "disabled";
export type KeyStatus      = "active" | "disabled" | "exhausted" | "cooling" | "error";

// ── Error classification ───────────────────────────────────────────────────────

export type ProviderErrorKind =
  | "insufficient_credits"
  | "auth_failed"
  | "rate_limited"
  | "timeout"
  | "server_error"
  | "parse_error"
  | "incomplete_response"
  | "network_error"
  | "unknown";

export interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  statusCode?: number;
  retryable: boolean;
  waitMs: number;
  suggestNextProvider?: boolean;
}

// ── LLM message / options / response ─────────────────────────────────────────

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RotationEvent {
  type: "key_try" | "key_success" | "key_fail" | "key_switch" | "provider_switch";
  provider: string;
  providerDisplay: string;
  keyName?: string;
  keyIndex?: number;
  totalKeys?: number;
  model?: string;
  reason?: string;
  nextProvider?: string;
  nextProviderDisplay?: string;
}

export interface LLMOptions {
  model?:             string;
  maxTokens?:         number;
  temperature?:       number;
  taskType?:          TaskType;
  stream?:            boolean;
  signal?:            AbortSignal;
  onRotationEvent?:   (event: RotationEvent) => void;
}

export interface LLMResponse {
  content:           string;
  model:             string;
  providerSlug:      string;
  keyId:             string;
  promptTokens?:     number;
  completionTokens?: number;
  latencyMs:         number;
  retries:           number;
}

// ── Model discovery ────────────────────────────────────────────────────────────

export type ModelCategory =
  | "coding"
  | "reasoning"
  | "fast"
  | "vision"
  | "long-context"
  | "general"
  | "free"
  | "paid"
  | "multimodal";

export interface DiscoveredModel {
  modelId:           string;
  displayName:       string;
  description?:      string;
  contextLength?:    number;
  inputPricePer1M?:  number;  // USD per 1M prompt tokens
  outputPricePer1M?: number;  // USD per 1M completion tokens
  isFree:            boolean;
  supportsVision:    boolean;
  supportsTools:     boolean;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  categories:        ModelCategory[];
  rankScore:         number;
  rawMetadata?:      Record<string, unknown>;
}

// ── Provider adapter interface ─────────────────────────────────────────────────

export interface ProviderAdapter {
  readonly slug:          string;
  readonly displayName:   string;
  readonly baseUrl:       string;
  readonly envPrefix:     string;   // e.g. "OPENROUTER_API_KEY" — used for auto-discovery
  readonly defaultModels: Record<TaskType, string>;

  complete(
    messages: LLMMessage[],
    options: LLMOptions,
    apiKey: string,
  ): Promise<{ content: string; promptTokens?: number; completionTokens?: number }>;

  testConnection(apiKey: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;

  classifyError(err: unknown, statusCode?: number): ProviderError;

  /**
   * Optional: fetch models available for this API key from the provider's API.
   * When implemented, called during model discovery to populate aiDiscoveredModelsTable.
   */
  listModels?(apiKey: string): Promise<DiscoveredModel[]>;
}

// ── In-memory runtime key state ───────────────────────────────────────────────

export interface RuntimeKeyState {
  id:                   string;
  providerSlug:         string;
  name:                 string;
  keyEncrypted:         string;
  keyPrefix:            string;
  enabled:              boolean;
  status:               KeyStatus;
  totalRequests:        number;
  successCount:         number;
  failureCount:         number;
  consecutiveFailures:  number;
  avgResponseTimeMs:    number;
  lastUsedAt?:          Date;
  lastSuccessAt?:       Date;
  lastFailureAt?:       Date;
  lastError?:           string;
  cooldownUntil?:       Date;
}

// ── In-memory runtime provider state ─────────────────────────────────────────

export interface RuntimeProviderState {
  slug:             string;
  displayName:      string;
  enabled:          boolean;
  priority:         number;
  routingStrategy:  RoutingStrategy;
  healthScore:      number;
  status:           ProviderStatus;
  totalRequests:    number;
  successCount:     number;
  failureCount:     number;
  avgLatencyMs:     number;
  lastHealthCheck?: Date;
  keys:             RuntimeKeyState[];
  rrIndex:          number;
}

// ── Health report ──────────────────────────────────────────────────────────────

export interface KeyHealthReport {
  id:                  string;
  name:                string;
  prefix:              string;
  status:              KeyStatus;
  enabled:             boolean;
  totalRequests:       number;
  successRate:         number;
  avgResponseTimeMs:   number;
  consecutiveFailures: number;
  lastUsed?:           string;
  lastSuccess?:        string;
  lastFailure?:        string;
  lastError?:          string;
  cooldownUntil?:      string;
}

export interface ProviderHealthReport {
  slug:             string;
  displayName:      string;
  status:           ProviderStatus;
  healthScore:      number;
  enabled:          boolean;
  priority:         number;
  totalRequests:    number;
  successCount:     number;
  failureCount:     number;
  successRate:      number;
  avgLatencyMs:     number;
  lastHealthCheck?: string;
  activeKeys:       number;
  totalKeys:        number;
  keys:             KeyHealthReport[];
}

export interface SystemHealthReport {
  generatedAt:     string;
  activeProviders: number;
  totalProviders:  number;
  totalKeys:       number;
  activeKeys:      number;
  totalRequests:   number;
  overallSuccess:  number;
  avgLatencyMs:    number;
  currentStrategy: RoutingStrategy;
  providers:       ProviderHealthReport[];
}
