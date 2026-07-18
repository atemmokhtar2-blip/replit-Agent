/**
 * Model Registry
 *
 * Config-driven catalog of AI models, task affinities, health metadata, and fallback chains.
 * All models default to OpenRouter as the provider.
 *
 * EXTENDING THE PLATFORM:
 * - Add a new model: append one object to MODEL_CATALOG below.
 * - Add a new provider: register it in @workspace/ai-provider.
 * - No other files need to change.
 *
 * Fields:
 *   id               — unique registry ID (kebab-case)
 *   name             — human-readable label
 *   providerSlug     — must match a registered @workspace/ai-provider slug
 *   modelId          — exact string passed to the provider API
 *   taskAffinity     — task types this model excels at (order matters: first = primary)
 *   capabilities     — capability metadata
 *   priority         — higher = preferred when multiple entries match same (task, provider)
 *   fallbackPriority — order in the fallback chain (lower = tried first)
 *   enabled          — whether this model is enabled for routing
 *   status           — current operational status (updated by health monitor)
 */

import type { ModelRegistryEntry, TaskType, ModelStatus } from "./types.js";

// ─── Model Catalog ────────────────────────────────────────────────────────────

export const MODEL_CATALOG: ModelRegistryEntry[] = [
  // ── Planning ──────────────────────────────────────────────────────────────
  {
    id: "or-kimi-k2",
    name: "Kimi K2 (Moonshot AI)",
    providerSlug: "openrouter",
    modelId: "moonshotai/kimi-k2",
    taskAffinity: ["planning", "research", "analysis", "documentation"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: false, tags: ["planning", "architecture", "high-quality"] },
    priority: 10,
    fallbackPriority: 1,
    enabled: true,
    status: "unknown",
  },
  // ── Coding / Debugging ────────────────────────────────────────────────────
  {
    id: "or-deepseek-chat-v3",
    name: "DeepSeek Chat V3",
    providerSlug: "openrouter",
    modelId: "deepseek/deepseek-chat-v3-0324",
    taskAffinity: ["coding", "debugging", "database", "research", "analysis", "general"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: false, tags: ["versatile", "high-quality", "fast"] },
    priority: 8,
    fallbackPriority: 2,
    enabled: true,
    status: "unknown",
  },
  {
    id: "or-qwen-coder-32b",
    name: "Qwen 2.5 Coder 32B",
    providerSlug: "openrouter",
    modelId: "qwen/qwen-2.5-coder-32b-instruct",
    taskAffinity: ["coding", "debugging", "database"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: false, tags: ["code-specialized", "large", "high-quality"] },
    priority: 9,
    fallbackPriority: 2,
    enabled: true,
    status: "unknown",
  },
  // ── Research / Documentation ──────────────────────────────────────────────
  {
    id: "or-gemma-3-27b",
    name: "Gemma 3 27B IT (Free)",
    providerSlug: "openrouter",
    modelId: "google/gemma-3-27b-it:free",
    taskAffinity: ["research", "analysis", "writing", "documentation", "general"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: true, tags: ["free", "large", "google"] },
    priority: 7,
    fallbackPriority: 3,
    enabled: true,
    status: "unknown",
  },
  // ── Security / Analysis ────────────────────────────────────────────────────
  {
    id: "or-llama-3.3-70b",
    name: "Llama 3.3 70B Instruct",
    providerSlug: "openrouter",
    modelId: "meta-llama/llama-3.3-70b-instruct",
    taskAffinity: ["writing", "research", "security", "analysis", "documentation", "general"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: true, tags: ["large", "versatile", "instruction-tuned"] },
    priority: 7,
    fallbackPriority: 3,
    enabled: true,
    status: "unknown",
  },
  // ── Deployment / Infrastructure ───────────────────────────────────────────
  {
    id: "or-deepseek-r1-free",
    name: "DeepSeek R1 (Free)",
    providerSlug: "openrouter",
    modelId: "deepseek/deepseek-r1:free",
    taskAffinity: ["deployment", "analysis", "planning", "debugging"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: true, tags: ["reasoning", "free", "analysis"] },
    priority: 6,
    fallbackPriority: 4,
    enabled: true,
    status: "unknown",
  },
  // ── Database Design ────────────────────────────────────────────────────────
  {
    id: "or-qwen-72b",
    name: "Qwen 2.5 72B Instruct (Free)",
    providerSlug: "openrouter",
    modelId: "qwen/qwen-2.5-72b-instruct:free",
    taskAffinity: ["database", "coding", "analysis", "documentation"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: true, tags: ["large", "free", "versatile"] },
    priority: 7,
    fallbackPriority: 3,
    enabled: true,
    status: "unknown",
  },
  // ── UI/UX Design ───────────────────────────────────────────────────────────
  {
    id: "or-mistral-small",
    name: "Mistral Small 3.1 (Free)",
    providerSlug: "openrouter",
    modelId: "mistralai/mistral-small-3.1-24b-instruct:free",
    taskAffinity: ["ui_design", "writing", "general", "documentation"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: true, tags: ["fast", "free", "versatile"] },
    priority: 6,
    fallbackPriority: 4,
    enabled: true,
    status: "unknown",
  },
  // ── Free fallback chain ────────────────────────────────────────────────────
  {
    id: "or-llama-3.1-8b-free",
    name: "Llama 3.1 8B Instruct (Free)",
    providerSlug: "openrouter",
    modelId: "meta-llama/llama-3.1-8b-instruct:free",
    taskAffinity: ["planning", "coding", "debugging", "research", "analysis", "documentation", "general"],
    capabilities: { maxTokens: 8192, supportsStreaming: true, isFree: true, tags: ["versatile", "free", "fallback"] },
    priority: 5,
    fallbackPriority: 5,
    enabled: true,
    status: "unknown",
  },
  {
    id: "or-mistral-7b",
    name: "Mistral 7B Instruct (Free)",
    providerSlug: "openrouter",
    modelId: "mistralai/mistral-7b-instruct:free",
    taskAffinity: ["writing", "general", "documentation"],
    capabilities: { maxTokens: 4096, supportsStreaming: true, isFree: true, tags: ["fast", "free"] },
    priority: 4,
    fallbackPriority: 6,
    enabled: true,
    status: "unknown",
  },
];

// ─── In-Memory Health State ────────────────────────────────────────────────────

const _runtimeStatus = new Map<string, { status: ModelStatus; lastUpdated: Date }>();

// ─── Registry Class ────────────────────────────────────────────────────────────

class ModelRegistry {
  private catalog: ModelRegistryEntry[];

  constructor(catalog: ModelRegistryEntry[]) {
    this.catalog = catalog.map((e) => ({ ...e }));
  }

  /** Find the highest-priority enabled catalog entry for a given task type and provider */
  findBestForTask(taskType: TaskType, providerSlug: string): ModelRegistryEntry | undefined {
    return this.catalog
      .filter((e) => e.enabled && e.providerSlug === providerSlug && e.taskAffinity.includes(taskType))
      .sort((a, b) => b.priority - a.priority)[0];
  }

  /** Get the ordered fallback chain for a given task type (all providers) */
  getFallbackChain(taskType: TaskType, providerSlug: string): ModelRegistryEntry[] {
    return this.catalog
      .filter((e) => e.enabled && e.providerSlug === providerSlug && e.taskAffinity.includes(taskType))
      .sort((a, b) => {
        if (a.fallbackPriority !== b.fallbackPriority) return a.fallbackPriority - b.fallbackPriority;
        return b.priority - a.priority;
      });
  }

  /** Get fallback chain that spans ALL providers, ordered by fallback priority */
  getGlobalFallbackChain(taskType: TaskType): ModelRegistryEntry[] {
    return this.catalog
      .filter((e) => e.enabled && e.taskAffinity.includes(taskType))
      .sort((a, b) => {
        if (a.fallbackPriority !== b.fallbackPriority) return a.fallbackPriority - b.fallbackPriority;
        return b.priority - a.priority;
      });
  }

  /** Look up a specific entry by its registry ID */
  findById(id: string): ModelRegistryEntry | undefined {
    return this.catalog.find((e) => e.id === id);
  }

  /** All entries in the catalog */
  listAll(): ModelRegistryEntry[] {
    return [...this.catalog];
  }

  /** All entries for a specific provider slug */
  listByProvider(providerSlug: string): ModelRegistryEntry[] {
    return this.catalog.filter((e) => e.providerSlug === providerSlug);
  }

  /** All entries that handle a given task type */
  listByTask(taskType: TaskType): ModelRegistryEntry[] {
    return this.catalog
      .filter((e) => e.taskAffinity.includes(taskType))
      .sort((a, b) => b.priority - a.priority);
  }

  /** Enable or disable a model by registry ID */
  setEnabled(registryId: string, enabled: boolean): boolean {
    const entry = this.catalog.find((e) => e.id === registryId);
    if (!entry) return false;
    entry.enabled = enabled;
    return true;
  }

  /** Update the priority of a model by registry ID */
  setPriority(registryId: string, priority: number): boolean {
    const entry = this.catalog.find((e) => e.id === registryId);
    if (!entry) return false;
    entry.priority = priority;
    return true;
  }

  /** Update runtime health status (called by health monitor) */
  updateStatus(registryId: string, status: ModelStatus): void {
    const entry = this.catalog.find((e) => e.id === registryId);
    if (entry) {
      entry.status = status;
      _runtimeStatus.set(registryId, { status, lastUpdated: new Date() });
    }
  }

  /** Dynamically register a new model at runtime */
  register(entry: ModelRegistryEntry): void {
    const existing = this.catalog.findIndex((e) => e.id === entry.id);
    if (existing >= 0) {
      this.catalog[existing] = { ...entry };
    } else {
      this.catalog.push({ ...entry });
    }
  }
}

export const modelRegistry = new ModelRegistry(MODEL_CATALOG);
