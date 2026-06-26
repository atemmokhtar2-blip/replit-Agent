/**
 * Task Queue API Client
 * Typed fetch helpers for the /v1/tasks endpoints.
 */

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`), {
      status: res.status,
      data: body,
    });
  }
  return res.json() as Promise<T>;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TaskCategory = "agent_invoke" | "pipeline" | "understand";
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface TaskStep {
  name: string;
  status: StepStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface QueueTask {
  id: string;
  type: TaskCategory;
  status: TaskStatus;
  label: string;
  agent_type: string | null;
  task_type: string | null;
  model_id: string | null;
  provider_slug: string | null;
  steps: TaskStep[];
  output: {
    content?: string;
    understanding?: unknown;
    spec?: unknown;
    validation?: unknown;
    phasePlan?: unknown;
    error?: string;
  } | null;
  started_at: string;
  completed_at: string | null;
  execution_id: string | null;
}

export type TaskStreamEvent =
  | { type: "snapshot"; task: QueueTask }
  | { type: "start"; taskId: string; label: string; taskCategory: TaskCategory }
  | { type: "step"; step: { name: string; status: StepStatus; detail?: string } }
  | { type: "agent"; agentType: string; modelId: string; taskType: string; rationale?: string }
  | { type: "progress"; text: string }
  | { type: "complete"; status: TaskStatus; output?: QueueTask["output"]; error?: string }
  | { type: "done" };

// ─── API ───────────────────────────────────────────────────────────────────────

export const tasksApi = {
  create: (payload: {
    type?: TaskCategory;
    label?: string;
    messages?: Array<{ role: string; content: string }>;
    request?: string;
    conversation_id?: string;
    preferred_agent?: string;
    project_id?: string;
    repository_id?: string;
  }) =>
    apiFetch<{ task: QueueTask }>("/tasks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  list: (limit = 50) =>
    apiFetch<{ items: QueueTask[]; total: number }>(`/tasks?limit=${limit}`),

  get: (id: string) => apiFetch<{ task: QueueTask }>(`/tasks/${id}`),

  cancel: (id: string) =>
    apiFetch<{ message: string }>(`/tasks/${id}`, { method: "DELETE" }),
};

// ─── SSE Stream ────────────────────────────────────────────────────────────────

export async function streamTask(
  taskId: string,
  onEvent: (event: TaskStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem("access_token");

  const response = await fetch(`/api/v1/tasks/${taskId}/stream`, {
    headers: {
      Accept: "text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal,
  });

  if (!response.ok) {
    let msg = `Stream failed (${response.status})`;
    try {
      const b = (await response.json()) as { error?: string };
      if (b.error) msg = b.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          const event = JSON.parse(data) as TaskStreamEvent;
          onEvent(event);
          if (event.type === "done") return;
        } catch {
          // malformed — skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
