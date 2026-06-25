/**
 * AI Orchestrator — Core Types
 *
 * All types used by the orchestration layer.
 * No provider-specific dependencies at the type level.
 */

import type { ChatMessage, ProviderConfig, AIProvider } from "@workspace/ai-provider";

// ─── Task Classification ───────────────────────────────────────────────────────

/**
 * All supported task categories.
 * Adding a new task type = extend this union + add patterns to TaskClassifier
 * + add model entries to MODEL_CATALOG. No other changes needed.
 */
export type TaskType =
  | "coding"
  | "debugging"
  | "planning"
  | "research"
  | "writing"
  | "analysis"
  | "deployment"
  | "documentation"
  | "database"
  | "security"
  | "ui_design"
  | "general";

export const TASK_TYPES: TaskType[] = [
  "coding",
  "debugging",
  "planning",
  "research",
  "writing",
  "analysis",
  "deployment",
  "documentation",
  "database",
  "security",
  "ui_design",
  "general",
];

/** Result of classifying a user message */
export interface TaskClassification {
  taskType: TaskType;
  /** Normalized confidence score 0.0–1.0 */
  confidence: number;
  /** Matched keywords/patterns — useful for logging and debugging */
  signals: string[];
}

// ─── Model Registry ────────────────────────────────────────────────────────────

/** Model operational status */
export type ModelStatus = "available" | "degraded" | "offline" | "unknown";

/**
 * One entry in the model catalog.
 * Config-driven: adding a new model = appending one object to MODEL_CATALOG.
 * No architecture changes required.
 */
export interface ModelRegistryEntry {
  /** Unique registry ID, e.g. "or-kimi-k2" */
  id: string;
  /** Human-readable label */
  name: string;
  /** Must match a registered ai-provider slug */
  providerSlug: string;
  /** Exact model ID string passed to the provider API */
  modelId: string;
  /** Task types this model is optimized for */
  taskAffinity: TaskType[];
  capabilities: {
    maxTokens: number;
    supportsStreaming: boolean;
    isFree: boolean;
    tags: string[];
  };
  /** Higher = preferred when multiple entries match the same (task, provider) */
  priority: number;
  /** Fallback priority: lower = tried first during failover */
  fallbackPriority: number;
  /** Whether this model is enabled for routing */
  enabled: boolean;
  /** Current operational status (updated by health monitor) */
  status: ModelStatus;
}

// ─── Agent Architecture ────────────────────────────────────────────────────────

export type AgentType =
  | "planner"
  | "builder"
  | "research"
  | "debug"
  | "deployment"
  | "database"
  | "security";

export const AGENT_TYPES: AgentType[] = [
  "planner",
  "builder",
  "research",
  "debug",
  "deployment",
  "database",
  "security",
];

/** Input to any agent's execute() method */
export interface AgentRequest {
  messages: ChatMessage[];
  userProviderConfig?: ProviderConfig;
  requestedModel?: string;
  /** Execution record ID for telemetry linkage */
  executionId?: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Max tokens for the response */
  maxTokens?: number;
  /** Temperature override */
  temperature?: number;
}

/** Result returned by any agent */
export interface AgentResult {
  content: string;
  agentType: AgentType;
  modelId: string;
  providerSlug: string;
  registryEntryId: string;
  latencyMs: number;
  retries: number;
  failovers: number;
  error?: string;
}

// ─── Routing ───────────────────────────────────────────────────────────────────

/** The router's complete output — what will be used for the actual API call */
export interface RoutingDecision {
  taskType: TaskType;
  classification: TaskClassification;
  agentType: AgentType;
  /** Exact modelId string that will be sent to the provider */
  selectedModelId: string;
  /** Which catalog entry was chosen ("user-override" / "provider-default" for special cases) */
  selectedRegistryEntryId: string;
  providerSlug: string;
  /** Human-readable explanation of the routing choice */
  rationale: string;
  /** true = no catalog entry matched, fell back to provider/user default */
  fallback: boolean;
}

/** Input passed to the router for each message */
export interface OrchestrationRequest {
  messages: ChatMessage[];
  userProviderConfig: ProviderConfig;
  /** Explicit model override from the user — bypasses catalog routing */
  requestedModel?: string;
}

/** Full result returned by the router */
export interface OrchestrationResult {
  decision: RoutingDecision;
  provider: AIProvider;
  resolvedConfig: ProviderConfig;
}

// ─── Health Monitoring ─────────────────────────────────────────────────────────

export interface ModelHealthMetrics {
  registryEntryId: string;
  providerSlug: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  activeRequests: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  lastError?: string;
}

export interface HealthReport {
  registryEntryId: string;
  providerSlug: string;
  status: ModelStatus;
  uptimePct: number;
  successRate: number;
  errorRate: number;
  avgResponseMs: number;
  minResponseMs: number;
  maxResponseMs: number;
  totalRequests: number;
  activeRequests: number;
  lastSuccessAt?: Date;
  lastFailureAt?: Date;
  lastError?: string;
}

// ─── Execution Tracking ────────────────────────────────────────────────────────

export type ExecutionStatus = "pending" | "running" | "completed" | "failed";

export type RoutingEventType =
  | "agent_selected"
  | "model_selected"
  | "fallback_activated"
  | "recovery"
  | "completed"
  | "failed";

export interface ExecutionRoutingEvent {
  type: RoutingEventType;
  fromModelId?: string;
  toModelId?: string;
  agentType?: string;
  taskType?: string;
  reason?: string;
  timestamp: Date;
}

// ─── Memory ────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  key: string;
  value: unknown;
  scope: "global" | "session" | "agent";
  expiresAt?: Date;
}

export interface ConversationContext {
  conversationId: string;
  projectId?: string;
  recentMessages: ChatMessage[];
  summary?: string;
  userPreferences?: Record<string, unknown>;
}

// Re-export provider types so consumers only need to import from @workspace/ai-orchestrator
export type { ChatMessage, ProviderConfig, AIProvider };
