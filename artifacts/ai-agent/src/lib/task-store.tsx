/**
 * TaskExecutionStore
 *
 * Global context that tracks all background execution tasks.
 * Tasks are persisted in localStorage so history survives page refresh.
 * The chat never touches this — only the floating TaskExecutionPanel reads it.
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
  | "ready"
  | "error"
  | "cancelled";

export interface ExecutionTask {
  id: string;
  conversationId: string;
  title: string;
  userPrompt: string;
  status: TaskStatus;
  progress: number; // 0-100
  stages: StageState[];
  startedAt: string;
  completedAt?: string;
  result?: { content: string; model: string };
  error?: string;
  dismissed?: boolean;
}

type TaskAction =
  | { type: "CREATE_TASK"; task: ExecutionTask }
  | { type: "STAGE_START"; taskId: string; stageId: number; startedAt: string }
  | { type: "STAGE_COMPLETE"; taskId: string; stageId: number; completedAt: string }
  | { type: "COMPLETE_TASK"; taskId: string; content: string; model: string; completedAt: string }
  | { type: "FAIL_TASK"; taskId: string; error: string }
  | { type: "CANCEL_TASK"; taskId: string }
  | { type: "DISMISS_TASK"; taskId: string }
  | { type: "LOAD_TASKS"; tasks: ExecutionTask[] };

interface TaskStore {
  tasks: ExecutionTask[];
  dispatch: React.Dispatch<TaskAction>;
}

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

    default:
      return state;
  }
}

// ── Persistence ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "aiagent_tasks_v1";
const MAX_STORED = 50;

function saveTasks(tasks: ExecutionTask[]) {
  try {
    // Only persist completed/failed/cancelled tasks (not mid-flight)
    const toStore = tasks
      .filter((t) => t.status === "ready" || t.status === "error" || t.status === "cancelled")
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

  // Load persisted tasks on mount
  useEffect(() => {
    const stored = loadTasks();
    if (stored.length > 0) {
      dispatch({ type: "LOAD_TASKS", tasks: stored });
    }
  }, []);

  // Persist when tasks change
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  return (
    <TaskContext.Provider value={{ tasks, dispatch }}>
      {children}
    </TaskContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useTaskStore() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTaskStore must be inside TaskProvider");
  return ctx;
}

/** Returns a stable set of action creators bound to the store's dispatch */
export function useTaskActions() {
  const { dispatch } = useTaskStore();

  const createTask = useCallback(
    (task: Omit<ExecutionTask, "status" | "progress" | "dismissed">) => {
      dispatch({
        type: "CREATE_TASK",
        task: { ...task, status: "planning", progress: 0, dismissed: false },
      });
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
    (taskId: string, error: string) => {
      dispatch({ type: "FAIL_TASK", taskId, error });
    },
    [dispatch]
  );

  const cancelTask = useCallback(
    (taskId: string) => {
      dispatch({ type: "CANCEL_TASK", taskId });
    },
    [dispatch]
  );

  const dismissTask = useCallback(
    (taskId: string) => {
      dispatch({ type: "DISMISS_TASK", taskId });
    },
    [dispatch]
  );

  return { createTask, stageStart, stageComplete, completeTask, failTask, cancelTask, dismissTask };
}
