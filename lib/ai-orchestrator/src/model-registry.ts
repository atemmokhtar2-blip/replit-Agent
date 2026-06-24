/**
 * Model Registry
 *
 * Config-driven catalog of AI models and their task affinities.
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
// Add new models here. That is the only change needed to extend the platform.

export const MODEL_CATALOG: ModelRegistryEntry[] = [
  // ── HuggingFace: Coding & Debugging ──────────────────────────────────────────
  {
    id: "hf-qwen2.5-coder-32b",
    name: "Qwen2.5-Coder 32B Instruct",
    providerSlug: "huggingface",
    modelId: "Qwen/Qwen2.5-Coder-32B-Instruct",
    taskAffinity: ["coding", "debugging"],
    capabilities: {
      maxTokens: 8192,
      supportsStreaming: false,
      isFree: true,
      tags: ["code-specialized", "large", "high-quality"],
    },
    priority: 10,
  },
  {
    id: "hf-deepseek-coder-7b",
    name: "DeepSeek Coder 7B Instruct",
    providerSlug: "huggingface",
    modelId: "deepseek-ai/deepseek-coder-7b-instruct-v1.5",
    taskAffinity: ["coding", "debugging"],
    capabilities: {
      maxTokens: 4096,
      supportsStreaming: false,
      isFree: true,
      tags: ["code-specialized", "fast"],
    },
    priority: 7,
  },

  // ── HuggingFace: Research & Planning ─────────────────────────────────────────
  {
    id: "hf-mixtral-8x7b",
    name: "Mixtral 8x7B Instruct",
    providerSlug: "huggingface",
    modelId: "mistralai/Mixtral-8x7B-Instruct-v0.1",
    taskAffinity: ["research", "planning", "analysis"],
    capabilities: {
      maxTokens: 32768,
      supportsStreaming: false,
      isFree: true,
      tags: ["large-context", "high-quality", "mixture-of-experts"],
    },
    priority: 9,
  },
  {
    id: "hf-phi3-mini",
    name: "Phi-3 Mini 4K Instruct",
    providerSlug: "huggingface",
    modelId: "microsoft/Phi-3-mini-4k-instruct",
    taskAffinity: ["planning", "analysis", "general"],
    capabilities: {
      maxTokens: 4096,
      supportsStreaming: false,
      isFree: true,
      tags: ["fast", "efficient", "reasoning"],
    },
    priority: 6,
  },

  // ── HuggingFace: Writing ──────────────────────────────────────────────────────
  {
    id: "hf-mistral-7b",
    name: "Mistral 7B Instruct v0.3",
    providerSlug: "huggingface",
    modelId: "mistralai/Mistral-7B-Instruct-v0.3",
    taskAffinity: ["writing", "research", "general"],
    capabilities: {
      maxTokens: 32768,
      supportsStreaming: false,
      isFree: true,
      tags: ["fast", "versatile", "large-context"],
    },
    priority: 8,
  },
  {
    id: "hf-zephyr-7b",
    name: "Zephyr 7B Beta",
    providerSlug: "huggingface",
    modelId: "HuggingFaceH4/zephyr-7b-beta",
    taskAffinity: ["writing", "analysis"],
    capabilities: {
      maxTokens: 4096,
      supportsStreaming: false,
      isFree: true,
      tags: ["instruction-tuned", "fast"],
    },
    priority: 7,
  },

  // ── HuggingFace: General fallback ─────────────────────────────────────────────
  {
    id: "hf-falcon-7b",
    name: "Falcon 7B Instruct",
    providerSlug: "huggingface",
    modelId: "tiiuae/falcon-7b-instruct",
    taskAffinity: ["general"],
    capabilities: {
      maxTokens: 2048,
      supportsStreaming: false,
      isFree: true,
      tags: ["general-purpose"],
    },
    priority: 4,
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
