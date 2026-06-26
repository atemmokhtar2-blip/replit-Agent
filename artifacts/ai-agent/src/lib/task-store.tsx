/**
 * TaskExecutionStore
 *
 * Global context that tracks all background execution tasks.
 * Tasks are persisted in localStorage so history survives page refresh.
 * The chat never touches this — only the floating TaskExecutionPanel reads it.
 *
 * Execution lifecycle:
 *   planning → working → building → executing → verifying → fixing → verified (or error)
 *
 * Health report is computed by the backend at the end of every pipeline run
 * and stored on the task for display in the VerificationCard.
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { StageState } from "@/components/design-system/AgentTimeline";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "planning"
  | "working"
  | "building"
  | "executing"
  | "verifying"
  | "fixing"
  | "verified"
  | "ready"
  | "error"
  | "cancelled";

export type ExecPhaseStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface ExecPhase {
  id: number;
  name: string;
  label: string;
  status: ExecPhaseStatus;
  duration?: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export type VerifyStatus = "pending" | "checking" | "pass" | "fail" | "skip" | "fixing" | "fixed";

export interface VerificationCheck {
  id: string;
  name: string;
  domain?: string;
  status: VerifyStatus;
  detail?: string;
  duration?: number;
}

// ── Health report types ────────────────────────────────────────────────────────

export type HealthDomainStatus = "pass" | "warn" | "fail" | "skip";

export interface DomainScore {
  domain: string;
  label: string;
  score: number;         // 0-100
  status: HealthDomainStatus;
  checksTotal: number;
  checksPassed: number;
}

export interface HealthReport {
  overallScore: number;   // 0-100
  productionReady: boolean;
  buildStatus: "pass" | "fail" | "warn";
  domains: DomainScore[];
  totalChecks: number;
  passedChecks: number;
  skippedChecks: number;
  failedChecks: number;
  fixesApplied: number;
  generatedAt: string;
}

export interface ExecutionResult {
  phases: ExecPhase[];
  checks: VerificationCheck[];
  healthReport?: HealthReport;
  allPassed: boolean;
  completedAt: string;
}

export interface ProductionGate {
  buildSuccessful:            boolean;
  runtimeHealthy:             boolean;
  previewResponding:          boolean;
  routesVerified:             boolean;
  apiVerified:                boolean;
  databaseHealthy:            boolean;
  assetsLoaded:               boolean;
  noCriticalErrors:           boolean;
  productionValidationPassed: boolean;
  allGatesPassed:             boolean;
}

export interface ExecutionTask {
  id: string;
  conversationId: string;
  title: string;
  userPrompt: string;
  status: TaskStatus;
  progress: number;
  stages: StageState[];
  startedAt: string;
  completedAt?: string;
  result?: { content: string; model: string };
  error?: string;
  dismissed?: boolean;
  execPhases?: ExecPhase[];
  verificationChecks?: VerificationCheck[];
  executionResult?: ExecutionResult;
  healthReport?: HealthReport;
  retryCount?: number;
  previewUrl?: string;
  productionGate?: ProductionGate;
}

type TaskAction =
  | { type: "CREATE_TASK"; task: ExecutionTask }
  | { type: "STAGE_START"; taskId: string; stageId: number; startedAt: string }
  | { type: "STAGE_COMPLETE"; taskId: string; stageId: number; completedAt: string }
  | { type: "COMPLETE_TASK"; taskId: string; content: string; model: string; completedAt: string }
  | { type: "FAIL_TASK"; taskId: string; error: string }
  | { type: "CANCEL_TASK"; taskId: string }
  | { type: "DISMISS_TASK"; taskId: string }
  | { type: "LOAD_TASKS"; tasks: ExecutionTask[] }
  | { type: "START_EXECUTION"; taskId: string; phases: ExecPhase[] }
  | { type: "EXEC_PHASE_START"; taskId: string; phaseId: number; startedAt: string }
  | { type: "EXEC_PHASE_COMPLETE"; taskId: string; phaseId: number; duration: number; completedAt: string }
  | { type: "EXEC_PHASE_FAIL"; taskId: string; phaseId: number; error: string }
  | { type: "SET_VERIFY_CHECK"; taskId: string; check: VerificationCheck }
  | { type: "SET_VERIFY_FIXING"; taskId: string; checkId: string; strategy: string }
  | { type: "SET_VERIFIED"; taskId: string; result: ExecutionResult; previewUrl?: string; productionGate?: ProductionGate }
  | { type: "SET_HEALTH_REPORT"; taskId: string; healthReport: HealthReport }
  | { type: "SET_EXEC_ERROR"; taskId: string; error: string }
  | { type: "RETRY_EXECUTION"; taskId: string };

interface TaskStore {
  tasks: ExecutionTask[];
  dispatch: React.Dispatch<TaskAction>;
}

// ── Default execution phases (17 stages) ──────────────────────────────────────

export const DEFAULT_EXEC_PHASES: ExecPhase[] = [
  { id:  1, name: "Planning",            label: "Planning",   status: "pending" },
  { id:  2, name: "Generating Files",    label: "Generating", status: "pending" },
  { id:  3, name: "Installing",          label: "Installing", status: "pending" },
  { id:  4, name: "Building",            label: "Building",   status: "pending" },
  { id:  5, name: "Linting",             label: "Linting",    status: "pending" },
  { id:  6, name: "Type Checking",       label: "Checking",   status: "pending" },
  { id:  7, name: "Testing",             label: "Testing",    status: "pending" },
  { id:  8, name: "Starting Server",     label: "Starting",   status: "pending" },
  { id:  9, name: "Building Production", label: "Bundling",   status: "pending" },
  { id: 10, name: "Verifying",           label: "Verifying",  status: "pending" },
  { id: 11, name: "Routing",             label: "Routing",    status: "pending" },
  { id: 12, name: "APIs",               label: "APIs",       status: "pending" },
  { id: 13, name: "Health Check",        label: "Health",     status: "pending" },
  { id: 14, name: "Endpoint Verify",     label: "Endpoints",  status: "pending" },
  { id: 15, name: "Auto Debug",          label: "Debugging",  status: "pending" },
  { id: 16, name: "Auto Fix & Rebuild",  label: "Repairing",  status: "pending" },
  { id: 17, name: "Final Verification",  label: "Finalizing", status: "pending" },
];

// ── Default verification checks (18 checks, includes assets_loaded) ────────────

export const DEFAULT_VERIFY_CHECKS: VerificationCheck[] = [
  { id: "build_success",     name: "Build Success",        domain: "build",         status: "pending" },
  { id: "build_errors",      name: "Build Errors",         domain: "build",         status: "pending" },
  { id: "missing_deps",      name: "Missing Dependencies", domain: "build",         status: "pending" },
  { id: "ts_errors",         name: "TypeScript Errors",    domain: "typescript",    status: "pending" },
  { id: "missing_imports",   name: "Missing Imports",      domain: "typescript",    status: "pending" },
  { id: "missing_exports",   name: "Missing Exports",      domain: "typescript",    status: "pending" },
  { id: "circular_imports",  name: "Circular Imports",     domain: "typescript",    status: "pending" },
  { id: "broken_components", name: "Broken Components",    domain: "frontend",      status: "pending" },
  { id: "hydration_errors",  name: "Hydration Errors",     domain: "frontend",      status: "pending" },
  { id: "react_warnings",    name: "React Warnings",       domain: "frontend",      status: "pending" },
  { id: "console_errors",    name: "Console Errors",       domain: "frontend",      status: "pending" },
  { id: "api_failures",      name: "API Failures",         domain: "backend",       status: "pending" },
  { id: "runtime_errors",    name: "Runtime Errors",       domain: "backend",       status: "pending" },
  { id: "missing_routes",    name: "Missing Routes",       domain: "routing",       status: "pending" },
  { id: "db_connection",     name: "Database Connection",  domain: "database",      status: "pending" },
  { id: "env_vars",          name: "Environment Variables",domain: "security",      status: "pending" },
  { id: "broken_preview",    name: "Preview Running",      domain: "frontend",      status: "pending" },
  { id: "assets_loaded",     name: "Assets Loaded",        domain: "frontend",      status: "pending" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function stageProgress(stages: StageState[]): number {
  if (stages.length === 0) return 0;
  const done = stages.filter((s) => s.status === "complete").length;
  const running = stages.some((s) => s.status === "running") ? 0.5 : 0;
  return Math.round(((done + running) / stages.length) * 100);
}

function statusFromStages(stages: StageState[]): TaskStatus {
  const runningIdx = stages.findIndex((s) => s.status === "running");
  if (runningIdx === -1) {
    const allDone = stages.every((s) => s.status === "complete");
    return allDone ? "ready" : "planning";
  }
  if (runningIdx <= 2) return "planning";
  if (runningIdx <= 5) return "working";
  return "building";
}

function execProgress(phases: ExecPhase[]): number {
  if (phases.length === 0) return 0;
  const done = phases.filter((p) => p.status === "complete").length;
  const running = phases.some((p) => p.status === "running") ? 0.5 : 0;
  return Math.round(((done + running) / phases.length) * 100);
}

// ── Reducer ────────────────────────────────────────────────────────────────────

function reducer(state: ExecutionTask[], action: TaskAction): ExecutionTask[] {
  switch (action.type) {
    case "LOAD_TASKS":
      return action.tasks;

    case "CREATE_TASK":
      return [action.task, ...state];

    case "STAGE_START": {
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const stages = t.stages.map((s) =>
          s.id === action.stageId
            ? { ...s, status: "running" as const, startedAt: action.startedAt }
            : s
        );
        return {
          ...t,
          stages,
          status: statusFromStages(stages),
          progress: stageProgress(stages),
        };
      });
    }

    case "STAGE_COMPLETE": {
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const stages = t.stages.map((s) =>
          s.id === action.stageId
            ? { ...s, status: "complete" as const, completedAt: action.completedAt }
            : s
        );
        return {
          ...t,
          stages,
          status: statusFromStages(stages),
          progress: stageProgress(stages),
        };
      });
    }

    case "COMPLETE_TASK":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const stages = t.stages.map((s) => ({
          ...s,
          status: "complete" as const,
          completedAt: s.completedAt ?? action.completedAt,
        }));
        return {
          ...t,
          stages,
          status: "ready" as const,
          progress: 100,
          completedAt: action.completedAt,
          result: { content: action.content, model: action.model },
        };
      });

    case "FAIL_TASK":
      return state.map((t) =>
        t.id === action.taskId
          ? { ...t, status: "error" as const, error: action.error, completedAt: new Date().toISOString() }
          : t
      );

    case "CANCEL_TASK":
      return state.map((t) =>
        t.id === action.taskId
          ? { ...t, status: "cancelled" as const, completedAt: new Date().toISOString() }
          : t
      );

    case "DISMISS_TASK":
      return state.map((t) =>
        t.id === action.taskId ? { ...t, dismissed: true } : t
      );

    case "START_EXECUTION":
      return state.map((t) =>
        t.id === action.taskId
          ? {
              ...t,
              status: "executing" as const,
              progress: 0,
              execPhases: action.phases,
              verificationChecks: DEFAULT_VERIFY_CHECKS.map((c) => ({ ...c })),
              healthReport: undefined,
            }
          : t
      );

    case "EXEC_PHASE_START":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const execPhases = (t.execPhases ?? []).map((p) =>
          p.id === action.phaseId
            ? { ...p, status: "running" as const, startedAt: action.startedAt }
            : p
        );
        return {
          ...t,
          execPhases,
          status: action.phaseId >= 10 ? "verifying" as const : "executing" as const,
          progress: execProgress(execPhases),
        };
      });

    case "EXEC_PHASE_COMPLETE":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const execPhases = (t.execPhases ?? []).map((p) =>
          p.id === action.phaseId
            ? { ...p, status: "complete" as const, duration: action.duration, completedAt: action.completedAt }
            : p
        );
        return {
          ...t,
          execPhases,
          progress: execProgress(execPhases),
        };
      });

    case "EXEC_PHASE_FAIL":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const execPhases = (t.execPhases ?? []).map((p) =>
          p.id === action.phaseId
            ? { ...p, status: "failed" as const, error: action.error }
            : p
        );
        return { ...t, execPhases, status: "error" as const };
      });

    case "SET_VERIFY_CHECK":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const existing = t.verificationChecks ?? DEFAULT_VERIFY_CHECKS.map((c) => ({ ...c }));
        const idx = existing.findIndex((c) => c.id === action.check.id);
        const verificationChecks = idx >= 0
          ? existing.map((c) => c.id === action.check.id ? { ...c, ...action.check } : c)
          : [...existing, { ...action.check }];
        const isFixing = verificationChecks.some((c) => c.status === "fixing");
        return {
          ...t,
          verificationChecks,
          status: isFixing ? "fixing" as const : "verifying" as const,
        };
      });

    case "SET_VERIFY_FIXING":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        const verificationChecks = (t.verificationChecks ?? []).map((c) =>
          c.id === action.checkId ? { ...c, status: "fixing" as const, detail: action.strategy } : c
        );
        return { ...t, verificationChecks, status: "fixing" as const };
      });

    case "SET_VERIFIED":
      return state.map((t) => {
        if (t.id !== action.taskId) return t;
        return {
          ...t,
          status: action.result.allPassed ? "verified" as const : "error" as const,
          progress: 100,
          completedAt: action.result.completedAt,
          executionResult: action.result,
          verificationChecks: action.result.checks,
          healthReport: action.result.healthReport,
          previewUrl: action.previewUrl ?? t.previewUrl,
          productionGate: action.productionGate ?? t.productionGate,
        };
      });

    case "SET_HEALTH_REPORT":
      return state.map((t) =>
        t.id === action.taskId
          ? { ...t, healthReport: action.healthReport }
          : t
      );

    case "SET_EXEC_ERROR":
      return state.map((t) =>
        t.id === action.taskId
          ? { ...t, status: "error" as const, error: action.error, completedAt: new Date().toISOString() }
          : t
      );

    case "RETRY_EXECUTION":
      return state.map((t) =>
        t.id === action.taskId
          ? {
              ...t,
              status: "executing" as const,
              progress: 0,
              error: undefined,
              execPhases: DEFAULT_EXEC_PHASES.map((p) => ({ ...p })),
              verificationChecks: DEFAULT_VERIFY_CHECKS.map((c) => ({ ...c })),
              healthReport: undefined,
              completedAt: undefined,
              retryCount: (t.retryCount ?? 0) + 1,
            }
          : t
      );

    default:
      return state;
  }
}

// ── Persistence ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "aiagent_tasks_v2";
const MAX_STORED = 50;

function saveTasks(tasks: ExecutionTask[]) {
  try {
    const toStore = tasks
      .filter((t) =>
        t.status === "ready" || t.status === "verified" ||
        t.status === "error" || t.status === "cancelled"
      )
      .slice(0, MAX_STORED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* ignore */ }
}

function loadTasks(): ExecutionTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ExecutionTask[];
  } catch {
    return [];
  }
}

// ── Context ────────────────────────────────────────────────────────────────────

const TaskContext = createContext<TaskStore | null>(null);

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, dispatch] = useReducer(reducer, []);

  useEffect(() => {
    const stored = loadTasks();
    if (stored.length > 0) {
      dispatch({ type: "LOAD_TASKS", tasks: stored });
    }
  }, []);

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  return (
    <TaskContext.Provider value={{ tasks, dispatch }}>
      {children}
    </TaskContext.Provider>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

export function useTaskStore() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTaskStore must be inside TaskProvider");
  return ctx;
}

export function useTaskActions() {
  const { dispatch } = useTaskStore();

  const createTask = useCallback(
    (task: Omit<ExecutionTask, "status" | "progress" | "dismissed">) => {
      dispatch({ type: "CREATE_TASK", task: { ...task, status: "planning", progress: 0, dismissed: false } });
    },
    [dispatch]
  );

  const stageStart = useCallback(
    (taskId: string, stageId: number) => {
      dispatch({ type: "STAGE_START", taskId, stageId, startedAt: new Date().toISOString() });
    },
    [dispatch]
  );

  const stageComplete = useCallback(
    (taskId: string, stageId: number) => {
      dispatch({ type: "STAGE_COMPLETE", taskId, stageId, completedAt: new Date().toISOString() });
    },
    [dispatch]
  );

  const completeTask = useCallback(
    (taskId: string, content: string, model: string) => {
      dispatch({ type: "COMPLETE_TASK", taskId, content, model, completedAt: new Date().toISOString() });
    },
    [dispatch]
  );

  const failTask = useCallback(
    (taskId: string, error: string) => { dispatch({ type: "FAIL_TASK", taskId, error }); },
    [dispatch]
  );

  const cancelTask = useCallback(
    (taskId: string) => { dispatch({ type: "CANCEL_TASK", taskId }); },
    [dispatch]
  );

  const dismissTask = useCallback(
    (taskId: string) => { dispatch({ type: "DISMISS_TASK", taskId }); },
    [dispatch]
  );

  const startExecution = useCallback(
    (taskId: string, phases: ExecPhase[]) => {
      dispatch({ type: "START_EXECUTION", taskId, phases });
    },
    [dispatch]
  );

  const execPhaseStart = useCallback(
    (taskId: string, phaseId: number) => {
      dispatch({ type: "EXEC_PHASE_START", taskId, phaseId, startedAt: new Date().toISOString() });
    },
    [dispatch]
  );

  const execPhaseComplete = useCallback(
    (taskId: string, phaseId: number, duration: number) => {
      dispatch({ type: "EXEC_PHASE_COMPLETE", taskId, phaseId, duration, completedAt: new Date().toISOString() });
    },
    [dispatch]
  );

  const execPhaseFail = useCallback(
    (taskId: string, phaseId: number, error: string) => {
      dispatch({ type: "EXEC_PHASE_FAIL", taskId, phaseId, error });
    },
    [dispatch]
  );

  const setVerifyCheck = useCallback(
    (taskId: string, check: VerificationCheck) => {
      dispatch({ type: "SET_VERIFY_CHECK", taskId, check });
    },
    [dispatch]
  );

  const setVerifyFixing = useCallback(
    (taskId: string, checkId: string, strategy: string) => {
      dispatch({ type: "SET_VERIFY_FIXING", taskId, checkId, strategy });
    },
    [dispatch]
  );

  const setVerified = useCallback(
    (taskId: string, result: ExecutionResult, previewUrl?: string, productionGate?: ProductionGate) => {
      dispatch({ type: "SET_VERIFIED", taskId, result, previewUrl, productionGate });
    },
    [dispatch]
  );

  const setHealthReport = useCallback(
    (taskId: string, healthReport: HealthReport) => {
      dispatch({ type: "SET_HEALTH_REPORT", taskId, healthReport });
    },
    [dispatch]
  );

  const setExecError = useCallback(
    (taskId: string, error: string) => {
      dispatch({ type: "SET_EXEC_ERROR", taskId, error });
    },
    [dispatch]
  );

  const retryExecution = useCallback(
    (taskId: string) => {
      dispatch({ type: "RETRY_EXECUTION", taskId });
    },
    [dispatch]
  );

  return {
    createTask, stageStart, stageComplete, completeTask, failTask, cancelTask, dismissTask,
    startExecution, execPhaseStart, execPhaseComplete, execPhaseFail,
    setVerifyCheck, setVerifyFixing, setVerified, setHealthReport, setExecError, retryExecution,
  } as const;
}
