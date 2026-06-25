/**
 * Model Registry
 *
 * Config-driven catalog of AI models and their task affinities.
 * All models route through OpenRouter.
 *
 * EXTENDING THE PLATFORM:
 * To add a new model, append one object to MODEL_CATALOG below.
 * No other files need to change. The router will automatically
 * consider it for routing decisions.
 *
 * Fields:
 *   id           — unique registry ID (kebab-case, prefix with provider slug)
 *   name         — human-readable label
 *   providerSlug — must match a registered @workspace/ai-provider slug
 *   modelId      — exact string passed to the provider API
 *   taskAffinity — task types this model excels at (order matters: first = primary)
 *   capabilities — capability metadata
 *   priority     — higher = preferred when multiple entries match same (task, provider)
 */

import type { ModelRegistryEntry, TaskType } from "./types.js";

// ─── Model Catalog ─────────────────────────────────────────────────────────────
// All models use OpenRouter as the provider.

export const MODEL_CATALOG: ModelRegistryEntry[] = [
  // ── Planning (primary chain) ──────────────────────────────────────────────────
  {
    id: "or-kimi-k2",
    name: "Kimi K2 (Moonshot AI)",
    providerSlug: "openrouter",
    modelId: "moonshotai/kimi-k2",
    taskAffinity: ["planning", "research", "analysis"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: true,
      isFree: false,
      tags: ["planning", "architecture", "high-quality"],
    },
    priority: 10,
  },
  {
    id: "or-deepseek-chat-v3",
    name: "DeepSeek Chat V3 (March 2024)",
    providerSlug: "openrouter",
    modelId: "deepseek/deepseek-chat-v3-0324",
    taskAffinity: ["coding", "debugging", "research", "analysis", "general"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: true,
      isFree: false,
      tags: ["versatile", "high-quality", "fast"],
    },
    priority: 8,
  },
  {
    id: "or-gpt-oss-20b",
    name: "GPT-OSS 20B (Free)",
    providerSlug: "openrouter",
    modelId: "openai/gpt-oss-20b:free",
    taskAffinity: ["planning", "coding", "debugging", "research", "analysis", "general"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: true,
      isFree: true,
      tags: ["versatile", "free", "fallback"],
    },
    priority: 6,
  },
  {
    id: "or-qwen-coder-32b",
    name: "Qwen 2.5 Coder 32B",
    providerSlug: "openrouter",
    modelId: "qwen/qwen-2.5-coder-32b-instruct",
    taskAffinity: ["coding", "debugging"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: true,
      isFree: false,
      tags: ["code-specialized", "large", "high-quality"],
    },
    priority: 7,
  },

  // ── General / Writing ─────────────────────────────────────────────────────────
  {
    id: "or-llama-3.3-70b",
    name: "Llama 3.3 70B Instruct",
    providerSlug: "openrouter",
    modelId: "meta-llama/llama-3.3-70b-instruct",
    taskAffinity: ["writing", "research", "general"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: true,
      isFree: true,
      tags: ["large", "versatile", "instruction-tuned"],
    },
    priority: 7,
  },
  {
    id: "or-mistral-7b",
    name: "Mistral 7B Instruct (Free)",
    providerSlug: "openrouter",
    modelId: "mistralai/mistral-7b-instruct:free",
    taskAffinity: ["writing", "general"],
    capabilities: {
      maxTokens: 4096,
      supportsStreaming: true,
      isFree: true,
      tags: ["fast", "free", "versatile"],
    },
    priority: 5,
  },
  {
    id: "or-gemma-3-27b",
    name: "Gemma 3 27B IT (Free)",
    providerSlug: "openrouter",
    modelId: "google/gemma-3-27b-it:free",
    taskAffinity: ["analysis", "writing", "general"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: true,
      isFree: true,
      tags: ["free", "large", "google"],
    },
    priority: 6,
  },
];

// ─── Registry Class ────────────────────────────────────────────────────────────

class ModelRegistry {
  private readonly catalog: ModelRegistryEntry[];

  constructor(catalog: ModelRegistryEntry[]) {
    this.catalog = catalog;
  }

  /**
   * Find the highest-priority catalog entry for a given task type and provider.
   * Returns undefined if no entry matches — the router will fall back to the
   * provider's configured default.
   */
  findBestForTask(taskType: TaskType, providerSlug: string): ModelRegistryEntry | undefined {
    const candidates = this.catalog
      .filter(
        (e) =>
          e.providerSlug === providerSlug && e.taskAffinity.includes(taskType)
      )
      .sort((a, b) => b.priority - a.priority);

    return candidates[0];
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
}

export const modelRegistry = new ModelRegistry(MODEL_CATALOG);
