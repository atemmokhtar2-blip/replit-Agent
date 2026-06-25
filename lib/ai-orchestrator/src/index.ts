/**
 * @workspace/ai-orchestrator
 *
 * AI OS — Orchestration layer sitting between the API server and ai-provider.
 *
 * Architecture:
 *   User → AI Router → Specialized Agent → Fallback Engine → Best Model → Result
 *
 * Components:
 *   aiRouter          — routes to agent + model; executeWithAgent() for full execution
 *   agentRegistry     — 7 specialized agents (planner, builder, research, debug, deployment, database, security)
 *   modelRegistry     — config-driven catalog of 10+ models with health metadata
 *   taskClassifier    — heuristic keyword classifier for 12 task types
 *   fallbackEngine    — automatic model failover
 *   healthMonitor     — per-model health metrics
 *   executionTracker  — DB-backed execution records and routing events
 *
 * Extending the platform:
 *   New model    → append to MODEL_CATALOG in model-registry.ts
 *   New task     → extend TaskType in types.ts + add patterns in task-classifier.ts
 *   New provider → register in @workspace/ai-provider + add MODEL_CATALOG entries
 *   New agent    → extend BaseAgent, add to AGENTS_LIST in agent-registry.ts
 */

// ─── Router + Core ─────────────────────────────────────────────────────────────
export { aiRouter, taskClassifier } from "./router.js";
export { modelRegistry, MODEL_CATALOG } from "./model-registry.js";
export { classifyTask } from "./task-classifier.js";

// ─── Agent OS ─────────────────────────────────────────────────────────────────
export { agentRegistry } from "./agent-registry.js";
export { healthMonitor } from "./health-monitor.js";
export { executionTracker } from "./execution-tracker.js";

// ─── Planner (unchanged) ───────────────────────────────────────────────────────
export { runPlanner } from "./planner.js";
export { runPlannerStream, PLANNER_STAGES } from "./planner-stream.js";

// ─── Memory Layer ─────────────────────────────────────────────────────────────
export {
  setProjectMemory,
  getProjectMemory,
  getAllProjectMemory,
  deleteProjectMemory,
  saveConversationContext,
  loadConversationContext,
  getUserPreferences,
  setUserPreferences,
  saveProjectContext,
  loadProjectContext,
} from "./memory.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export { TASK_TYPES, AGENT_TYPES } from "./types.js";
export type {
  TaskType,
  AgentType,
  TaskClassification,
  ModelRegistryEntry,
  ModelStatus,
  RoutingDecision,
  OrchestrationRequest,
  OrchestrationResult,
  AgentRequest,
  AgentResult,
  HealthReport,
  ModelHealthMetrics,
  ExecutionStatus,
  RoutingEventType,
  MemoryEntry,
  ConversationContext,
} from "./types.js";
export type { PlannerMessage, PlannerResult } from "./planner.js";
export type { PlannerStreamEvent, PlannerStreamMessage } from "./planner-stream.js";
export type { UserAiPrefs } from "./memory.js";
