/**
 * AI Orchestrator — Core Types
 *
 * All types used by the orchestration layer.
 * No provider-specific dependencies at the type level.
 */

import type { ChatMessage, ProviderConfig, AIProvider } from "@workspace/ai-provider";

// ─── Task Classification ───────────────────────────────────────────────────────

/**
 * The 7 supported task categories.
 * Adding a new task type in the future = extend this union + add patterns to
 * TaskClassifier + add model entries to MODEL_CATALOG. No other changes needed.
 */
export type TaskType =
  | "coding"
  | "debugging"
  | "planning"
  | "research"
  | "writing"
  | "analysis"
  | "general";

export const TASK_TYPES: TaskType[] = [
  "coding",
  "debugging",
  "planning",
  "research",
  "writing",
  "analysis",
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

/**
 * One entry in the model catalog.
 * Config-driven: adding a new model = appending one object to MODEL_CATALOG.
 * No architecture changes required.
 */
export interface ModelRegistryEntry {
  /** Unique registry ID, e.g. "hf-qwen2.5-coder-32b" */
  id: string;
  /** Human-readable label, e.g. "Qwen2.5-Coder 32B" */
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
    /** Descriptive tags, e.g. "code-specialized", "fast", "large-context" */
    tags: string[];
  };
  /**
   * Higher priority = preferred when multiple catalog entries match the same
   * (taskType, providerSlug) pair.
   */
  priority: number;
}

// ─── Routing ───────────────────────────────────────────────────────────────────

/** The router's complete output — what will be used for the actual API call */
export interface RoutingDecision {
  taskType: TaskType;
  classification: TaskClassification;
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
  /**
   * Provider config with `defaultModel` injected to reflect the routed model.
   * Pass this (instead of the original config) to provider.chat().
   */
  resolvedConfig: ProviderConfig;
}
