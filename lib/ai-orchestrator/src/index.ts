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

// ─── Project Understanding Engine ─────────────────────────────────────────────
export { analyzeProject } from "./understanding/project-analyzer.js";
export { buildSpec } from "./specification/spec-builder.js";
export { saveSpec, getSpecByConversation, getSpecById, updateSpecStatus } from "./specification/spec-store.js";
export { validateArchitecture } from "./validation/architecture-validator.js";
export { runPhases, getDefaultPhasePlan } from "./execution/phase-runner.js";
export { reviewPhase } from "./execution/self-review-agent.js";
export { runFinalVerification } from "./execution/final-verifier.js";
export type { PhaseExecutionResult } from "./execution/phase-runner.js";
export type {
  ProjectType,
  ProjectUnderstanding,
  FrontendRequirements,
  BackendRequirements,
  DatabaseRequirements,
  AuthRequirements,
  ApiRequirements,
  DeploymentRequirements,
  SecurityRequirements,
  PerformanceRequirements,
  ScalabilityRequirements,
  InferredRequirement,
} from "./understanding/types.js";
export type {
  ExecutionSpec,
  SpecFeature,
  SpecPage,
  SpecComponent,
  FolderNode,
  DbTable,
  DbColumn,
  ApiContract,
  UserRole,
  Permission,
  PackageDependency,
  DeploymentPlan,
  RoadmapPhase,
  ValidationIssue,
  ValidationResult,
  PhaseStatus,
  PhaseTask,
  ReviewFinding,
  ReviewResult,
  ExecutionPhaseInfo,
  VerificationReport,
} from "./specification/spec-types.js";

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
export type { PlannerMessage, PlannerResult, PlannerCompleteFnNonStream } from "./planner.js";
export type { PlannerStreamEvent, PlannerStreamMessage, PlannerCompleteFn } from "./planner-stream.js";
export type { UserAiPrefs } from "./memory.js";
