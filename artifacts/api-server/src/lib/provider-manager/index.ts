/**
 * Provider Manager — singleton export
 *
 * Import `providerManager` anywhere in the backend and call:
 *   await providerManager.complete(messages, { taskType: "code-gen" });
 *
 * The manager initializes lazily on first use (or explicitly via .initialize()).
 */

export { ProviderManager } from "./manager.js";
export type {
  LLMMessage,
  LLMOptions,
  LLMResponse,
  TaskType,
  RoutingStrategy,
  ProviderError,
  ProviderErrorKind,
  SystemHealthReport,
  ProviderHealthReport,
  KeyHealthReport,
} from "./types.js";

import { ProviderManager } from "./manager.js";

export const providerManager = new ProviderManager();

// Initialize in background — non-blocking
// The manager handles its own initialization on first complete() call too,
// so this is just an eager optimization.
void providerManager.initialize().catch(err =>
  console.error("[ProviderManager] Background init failed:", err),
);
