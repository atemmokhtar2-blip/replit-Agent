/**
 * Task Queue — Phase 5 & 6: Task Queue + Live Execution
 *
 * Adds a persistent in-memory task queue on top of the existing AI orchestrator.
 * Each task wraps an agent invocation or understanding pipeline, adds step-level
 * progress tracking, and streams live events via SSE.
 *
 * Routes:
 *   POST   /v1/tasks            — create + start task
 *   GET    /v1/tasks            — list user tasks
 *   GET    /v1/tasks/:id        — get task detail
 *   DELETE /v1/tasks/:id        — cancel task
 *   GET    /v1/tasks/:id/stream — SSE live stream
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import {
  aiRouter as orchestratorRouter,
  analyzeProject,
  buildSpec,
  validateArchitecture,
  getDefaultPhasePlan,
  AGENT_TYPES,
} from "@workspace/ai-orchestrator";
import type { AgentType } from "@workspace/ai-orchestrator";

const router = Router();
router.use(authenticate);

// ─── Types ─────────────────────────────────────────────────────────────────────

type QueueTaskType = "agent_invoke" | "pipeline" | "understand";
type QueueTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
type StepStatus = "pending" | "running" | "completed" | "failed";

interface TaskStep {
  name: string;
  status: StepStatus;
  detail?: string;
  startedAt?: string;
  completedAt?: string;
}

interface QueueTask {
  id: string;
  userId: string;
  type: QueueTaskType;
  status: QueueTaskStatus;
  label: string;
  agentType?: string;
  taskType?: string;
  modelId?: string;
  providerSlug?: string;
  steps: TaskStep[];
  output: {
    content?: string;
    understanding?: unknown;
    spec?: unknown;
    validation?: unknown;
    phasePlan?: unknown;
    error?: string;
  } | null;
  startedAt: string;
  completedAt?: string;
  executionId?: string;
  input: {
    messages?: Array<{ role: string; content: string }>;
    request?: string;
    conversationId?: string;
    repositoryId?: string;
    preferredAgent?: string;
    projectId?: string;
  };
}

// ─── In-memory stores ──────────────────────────────────────────────────────────

const taskStore = new Map<string, QueueTask>();
const sseClients = new Map<string, Set<Response>>();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function serializeTask(t: QueueTask) {
  return {
    id: t.id,
    type: t.type,
    status: t.status,
    label: t.label,
    agent_type: t.agentType ?? null,
    task_type: t.taskType ?? null,
    model_id: t.modelId ?? null,
    provider_slug: t.providerSlug ?? null,
    steps: t.steps,
    output: t.output,
    started_at: t.startedAt,
    completed_at: t.completedAt ?? null,
    execution_id: t.executionId ?? null,
  };
}

function pushSSE(taskId: string, data: Record<string, unknown>): void {
  const clients = sseClients.get(taskId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // client disconnected
    }
  }
}

function setStepRunning(task: QueueTask, stepName: string, detail?: string): void {
  let step = task.steps.find((s) => s.name === stepName);
  if (!step) {
    step = { name: stepName, status: "running", startedAt: new Date().toISOString() };
    task.steps.push(step);
  } else {
    step.status = "running";
    step.startedAt = new Date().toISOString();
  }
  if (detail) step.detail = detail;
  pushSSE(task.id, { type: "step", step: { name: stepName, status: "running", detail } });
}

function setStepDone(task: QueueTask, stepName: string, detail?: string): void {
  const step = task.steps.find((s) => s.name === stepName);
  if (step) {
    step.status = "completed";
    step.completedAt = new Date().toISOString();
    if (detail) step.detail = detail;
  }
  pushSSE(task.id, { type: "step", step: { name: stepName, status: "completed", detail } });
}

function setStepFailed(task: QueueTask, stepName: string, detail?: string): void {
  const step = task.steps.find((s) => s.name === stepName);
  if (step) {
    step.status = "failed";
    step.completedAt = new Date().toISOString();
    if (detail) step.detail = detail;
  }
  pushSSE(task.id, { type: "step", step: { name: stepName, status: "failed", detail } });
}

function failTask(task: QueueTask, error: string): void {
  if (task.status === "cancelled") return;
  task.status = "failed";
  task.completedAt = new Date().toISOString();
  task.output = { error };
  for (const s of task.steps) {
    if (s.status === "running") {
      s.status = "failed";
      s.completedAt = new Date().toISOString();
    }
  }
  pushSSE(task.id, { type: "complete", status: "failed", error });
  pushSSE(task.id, { type: "done" });
}

// ─── Task runners ──────────────────────────────────────────────────────────────

async function runAgentInvoke(task: QueueTask): Promise<void> {
  const { input } = task;
  const messages = (
    input.messages ?? [{ role: "user" as const, content: input.request ?? "" }]
  ) as Array<{ role: "user" | "assistant" | "system"; content: string }>;

  try {
    setStepRunning(task, "Classifying Task");
    setStepDone(task, "Classifying Task");

    setStepRunning(task, "Selecting Agent & Model");

    const result = await orchestratorRouter.executeWithAgent({
      messages,
      userId: task.userId,
      conversationId: input.conversationId,
      projectId: input.projectId,
      preferredAgentType: input.preferredAgent as AgentType | undefined,
      signal: AbortSignal.timeout(120_000),
    });

    task.agentType = result.agentType;
    task.taskType = result.taskType;
    task.modelId = result.modelId;
    task.providerSlug = result.providerSlug;
    task.executionId = result.executionId;

    setStepDone(task, "Selecting Agent & Model", `${result.agentType} via ${result.modelId}`);
    setStepRunning(task, "Generating Response");

    pushSSE(task.id, {
      type: "agent",
      agentType: result.agentType,
      modelId: result.modelId,
      taskType: result.taskType,
      rationale: result.rationale,
    });

    pushSSE(task.id, { type: "progress", text: result.content });
    setStepDone(task, "Generating Response");

    setStepRunning(task, "Finalizing");
    setStepDone(task, "Finalizing");

    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.output = { content: result.content };
    pushSSE(task.id, { type: "complete", status: "completed", output: { content: result.content } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setStepFailed(task, "Generating Response", msg);
    failTask(task, msg);
    return;
  }

  pushSSE(task.id, { type: "done" });
}

async function runPipeline(task: QueueTask): Promise<void> {
  const request = task.input.request ?? "";
  const conversationId = task.input.conversationId ?? `conv_${task.id}`;

  try {
    setStepRunning(task, "Analyzing Project");
    const understanding = await analyzeProject(request, AbortSignal.timeout(90_000));
    setStepDone(
      task,
      "Analyzing Project",
      `${understanding.projectType} — ${understanding.complexity} complexity`
    );

    setStepRunning(task, "Building Execution Spec");
    const spec = await buildSpec(conversationId, understanding, AbortSignal.timeout(90_000));
    setStepDone(
      task,
      "Building Execution Spec",
      `${spec.features.length} features · ${spec.pages.length} pages · ${spec.dbSchema.length} tables`
    );

    setStepRunning(task, "Validating Architecture");
    const validation = validateArchitecture(spec);
    setStepDone(
      task,
      "Validating Architecture",
      `Score ${validation.score}/100 — ${validation.valid ? "passed" : "issues found"}`
    );

    setStepRunning(task, "Generating Phase Plan");
    const phasePlan = getDefaultPhasePlan(spec);
    setStepDone(task, "Generating Phase Plan", `${phasePlan.length} development phases ready`);

    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.output = { understanding, spec, validation, phasePlan };
    pushSSE(task.id, {
      type: "complete",
      status: "completed",
      output: { understanding, spec, validation, phasePlan },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failTask(task, msg);
    return;
  }

  pushSSE(task.id, { type: "done" });
}

async function runUnderstand(task: QueueTask): Promise<void> {
  const request = task.input.request ?? "";

  try {
    setStepRunning(task, "Parsing Request");
    const understanding = await analyzeProject(request, AbortSignal.timeout(60_000));
    setStepDone(task, "Parsing Request", understanding.projectType);

    setStepRunning(task, "Inferring Requirements");
    setStepDone(
      task,
      "Inferring Requirements",
      `${understanding.inferredRequirements.length} requirements inferred`
    );

    setStepRunning(task, "Identifying Ambiguities");
    setStepDone(
      task,
      "Identifying Ambiguities",
      `${understanding.ambiguities.length} clarification points`
    );

    task.status = "completed";
    task.completedAt = new Date().toISOString();
    task.output = { understanding };
    pushSSE(task.id, {
      type: "complete",
      status: "completed",
      output: { understanding },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failTask(task, msg);
    return;
  }

  pushSSE(task.id, { type: "done" });
}

function dispatchTask(task: QueueTask): void {
  setImmediate(async () => {
    const t = taskStore.get(task.id);
    if (!t || t.status === "cancelled") return;
    t.status = "running";
    pushSSE(task.id, { type: "start", taskId: task.id, label: task.label, taskCategory: task.type });

    if (t.type === "agent_invoke") await runAgentInvoke(t);
    else if (t.type === "pipeline") await runPipeline(t);
    else if (t.type === "understand") await runUnderstand(t);
  });
}

// ─── Routes ────────────────────────────────────────────────────────────────────

// POST /v1/tasks — create + start a task
router.post("/", (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const body = req.body as {
    type?: QueueTaskType;
    label?: string;
    messages?: Array<{ role: string; content: string }>;
    request?: string;
    conversation_id?: string;
    preferred_agent?: string;
    project_id?: string;
    repository_id?: string;
  };

  const type: QueueTaskType = (body.type as QueueTaskType) ?? "agent_invoke";
  if (!["agent_invoke", "pipeline", "understand"].includes(type)) {
    res.status(400).json({ error: "type must be: agent_invoke | pipeline | understand" });
    return;
  }

  if (type === "agent_invoke") {
    if (!body.messages?.length && !body.request?.trim()) {
      res.status(400).json({ error: "messages or request required for agent_invoke" });
      return;
    }
  } else {
    if (!body.request || body.request.trim().length < 5) {
      res.status(400).json({ error: "request is required (min 5 chars) for pipeline/understand" });
      return;
    }
  }

  if (body.preferred_agent && !AGENT_TYPES.includes(body.preferred_agent as AgentType)) {
    res.status(400).json({
      error: `preferred_agent must be one of: ${AGENT_TYPES.join(", ")}`,
    });
    return;
  }

  const id = makeTaskId();
  const requestPreview = body.request?.slice(0, 60)
    ?? body.messages?.[body.messages.length - 1]?.content?.slice(0, 60)
    ?? "";
  const label =
    body.label ??
    (type === "agent_invoke"
      ? `Agent: ${requestPreview}…`
      : type === "pipeline"
      ? `Pipeline: ${requestPreview}…`
      : `Understand: ${requestPreview}…`);

  const initialSteps: TaskStep[] =
    type === "agent_invoke"
      ? [
          { name: "Classifying Task", status: "pending" },
          { name: "Selecting Agent & Model", status: "pending" },
          { name: "Generating Response", status: "pending" },
          { name: "Finalizing", status: "pending" },
        ]
      : type === "pipeline"
      ? [
          { name: "Analyzing Project", status: "pending" },
          { name: "Building Execution Spec", status: "pending" },
          { name: "Validating Architecture", status: "pending" },
          { name: "Generating Phase Plan", status: "pending" },
        ]
      : [
          { name: "Parsing Request", status: "pending" },
          { name: "Inferring Requirements", status: "pending" },
          { name: "Identifying Ambiguities", status: "pending" },
        ];

  const task: QueueTask = {
    id,
    userId,
    type,
    status: "pending",
    label,
    steps: initialSteps,
    output: null,
    startedAt: new Date().toISOString(),
    input: {
      messages: body.messages,
      request: body.request,
      conversationId: body.conversation_id,
      repositoryId: body.repository_id,
      preferredAgent: body.preferred_agent,
      projectId: body.project_id,
    },
  };

  taskStore.set(id, task);
  dispatchTask(task);

  res.status(201).json({ task: serializeTask(task) });
});

// GET /v1/tasks — list user's tasks (newest first)
router.get("/", (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const limit = Math.min(Number((req.query["limit"] as string | undefined) ?? "50"), 100);

  const items = [...taskStore.values()]
    .filter((t) => t.userId === userId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit)
    .map(serializeTask);

  res.json({ items, total: items.length });
});

// GET /v1/tasks/:id — single task
router.get("/:id", (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };
  const task = taskStore.get(id);
  if (!task || task.userId !== userId) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json({ task: serializeTask(task) });
});

// DELETE /v1/tasks/:id — cancel
router.delete("/:id", (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };
  const task = taskStore.get(id);
  if (!task || task.userId !== userId) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  if (task.status === "completed" || task.status === "failed") {
    res.status(400).json({ error: "Task already finished" });
    return;
  }
  task.status = "cancelled";
  task.completedAt = new Date().toISOString();
  pushSSE(id, { type: "complete", status: "cancelled" });
  pushSSE(id, { type: "done" });
  res.json({ message: "Task cancelled" });
});

// GET /v1/tasks/:id/stream — SSE live stream
router.get("/:id/stream", (req: Request, res: Response) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };
  const task = taskStore.get(id);

  if (!task || task.userId !== userId) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send current snapshot immediately
  res.write(`data: ${JSON.stringify({ type: "snapshot", task: serializeTask(task) })}\n\n`);

  // Already finished — close immediately
  if (
    task.status === "completed" ||
    task.status === "failed" ||
    task.status === "cancelled"
  ) {
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
    return;
  }

  // Register as SSE subscriber
  if (!sseClients.has(id)) sseClients.set(id, new Set());
  sseClients.get(id)!.add(res);

  // Keepalive ping every 20s
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(ping);
    }
  }, 20_000);

  res.on("close", () => {
    clearInterval(ping);
    sseClients.get(id)?.delete(res);
    if (sseClients.get(id)?.size === 0) sseClients.delete(id);
  });
});

export default router;
