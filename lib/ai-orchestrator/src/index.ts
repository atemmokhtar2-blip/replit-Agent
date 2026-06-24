/**
 * @workspace/ai-orchestrator
 *
 * AI Orchestration layer — sits between the API server and ai-provider.
 *
 * Architecture:
 *   API route → aiRouter.route(request) → provider.chat(resolvedConfig)
 *
 * Components:
 *   aiRouter        — routes each message to the best provider + model
 *   modelRegistry   — config-driven catalog of models and task affinities
 *   taskClassifier  — heuristic keyword classifier for task types
 *
 * Extending the platform:
 *   New model    → append one entry to MODEL_CATALOG in model-registry.ts
 *   New task     → extend TaskType union + add patterns in task-classifier.ts
 *   New provider → register in @workspace/ai-provider, then add MODEL_CATALOG entries
 */

export { aiRouter } from "./router.js";
export { modelRegistry, MODEL_CATALOG } from "./model-registry.js";
export { taskClassifier, classifyTask } from "./task-classifier.js";
export { TASK_TYPES } from "./types.js";
export { runPlanner } from "./planner.js";

export type {
  TaskType,
  TaskClassification,
  ModelRegistryEntry,
  RoutingDecision,
  OrchestrationRequest,
  OrchestrationResult,
} from "./types.js";
export type { PlannerMessage, PlannerResult } from "./planner.js";
