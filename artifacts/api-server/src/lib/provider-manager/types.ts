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
  | "insufficient_credits"  // 402
  | "auth_failed"           // 401 | 403
  | "rate_limited"          // 429
  | "timeout"              // 408 | 504 | AbortError
  | "server_error"          // 500–503
  | "parse_error"           // bad JSON / empty body
  | "incomplete_response"   // content too short
  | "network_error"         // fetch threw
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
  content:          string;
  model:            string;
  providerSlug:     string;
  keyId:            string;
  promptTokens?:    number;
  completionTokens?: number;
  latencyMs:        number;
  retries:          number;
}

// ── Provider adapter interface ─────────────────────────────────────────────────

export interface ProviderAdapter {
  readonly slug:          string;
  readonly displayName:   string;
  readonly baseUrl:       string;
  readonly defaultModels: Record<TaskType, string>;

  complete(
    messages: LLMMessage[],
    options: LLMOptions,
    apiKey: string,
  ): Promise<{ content: string; promptTokens?: number; completionTokens?: number }>;

  testConnection(apiKey: string): Promise<{ ok: boolean; latencyMs: number; error?: string }>;

  classifyError(err: unknown, statusCode?: number): ProviderError;
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
  slug:            string;
  displayName:     string;
  enabled:         boolean;
  priority:        number;
  routingStrategy: RoutingStrategy;
  healthScore:     number;
  status:          ProviderStatus;
  totalRequests:   number;
  successCount:    number;
  failureCount:    number;
  avgLatencyMs:    number;
  lastHealthCheck?: Date;
  keys:            RuntimeKeyState[];
  rrIndex:         number;  // round-robin cursor
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
  slug:            string;
  displayName:     string;
  status:          ProviderStatus;
  healthScore:     number;
  enabled:         boolean;
  priority:        number;
  totalRequests:   number;
  successCount:    number;
  failureCount:    number;
  successRate:     number;
  avgLatencyMs:    number;
  lastHealthCheck?: string;
  activeKeys:      number;
  totalKeys:       number;
  keys:            KeyHealthReport[];
}

export interface SystemHealthReport {
  generatedAt:      string;
  activeProviders:  number;
  totalProviders:   number;
  totalKeys:        number;
  activeKeys:       number;
  totalRequests:    number;
  overallSuccess:   number;
  avgLatencyMs:     number;
  currentStrategy:  RoutingStrategy;
  providers:        ProviderHealthReport[];
}
