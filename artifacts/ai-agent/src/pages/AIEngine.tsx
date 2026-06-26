/**
 * AI Engine — Phase 5 & 6 Frontend
 * Task Queue + Live Execution for the autonomous AI development engine.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  BrainCircuit,
  Plus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  ChevronRight,
  Zap,
  Bot,
  GitBranch,
  Search,
  Play,
  Trash2,
  RefreshCw,
  AlertCircle,
  Code2,
  Layers,
  Shield,
  Database,
  Rocket,
  Bug,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  tasksApi,
  streamTask,
  type QueueTask,
  type TaskCategory,
  type TaskStreamEvent,
  type TaskStep,
} from "@/lib/tasks-api";

// ─── Constants ─────────────────────────────────────────────────────────────────

const AGENT_OPTIONS = [
  { value: "", label: "Auto-select", icon: BrainCircuit, color: "text-primary" },
  { value: "planner", label: "Planner", icon: Layers, color: "text-blue-400" },
  { value: "builder", label: "Builder", icon: Code2, color: "text-emerald-400" },
  { value: "research", label: "Research", icon: Search, color: "text-amber-400" },
  { value: "debug", label: "Debug", icon: Bug, color: "text-red-400" },
  { value: "deployment", label: "Deployment", icon: Rocket, color: "text-purple-400" },
  { value: "database", label: "Database", icon: Database, color: "text-cyan-400" },
  { value: "security", label: "Security", icon: Shield, color: "text-orange-400" },
];

const TASK_TYPES: { value: TaskCategory; label: string; description: string }[] = [
  {
    value: "agent_invoke",
    label: "Agent Invoke",
    description: "Ask any agent a question or give it a task",
  },
  {
    value: "pipeline",
    label: "Full Pipeline",
    description: "Analyze → Specify → Validate architecture",
  },
  {
    value: "understand",
    label: "Understand",
    description: "Parse request + infer requirements",
  },
];

// ─── Status helpers ────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 16 }: { status: string; size?: number }) {
  const cls = `h-${size === 16 ? 4 : 3} w-${size === 16 ? 4 : 3} flex-shrink-0`;
  if (status === "completed") return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  if (status === "failed") return <XCircle className={`${cls} text-red-400`} />;
  if (status === "running") return <Loader2 className={`${cls} text-blue-400 animate-spin`} />;
  if (status === "cancelled") return <Ban className={`${cls} text-muted-foreground`} />;
  return <Clock className={`${cls} text-muted-foreground`} />;
}

function statusColor(status: string): string {
  if (status === "completed") return "text-emerald-400 bg-emerald-400/10 border-emerald-400/20";
  if (status === "failed") return "text-red-400 bg-red-400/10 border-red-400/20";
  if (status === "running") return "text-blue-400 bg-blue-400/10 border-blue-400/20";
  if (status === "cancelled") return "text-muted-foreground bg-muted/30 border-border";
  return "text-muted-foreground bg-muted/20 border-border";
}

function agentColor(agentType: string | null): string {
  const map: Record<string, string> = {
    planner: "text-blue-400",
    builder: "text-emerald-400",
    research: "text-amber-400",
    debug: "text-red-400",
    deployment: "text-purple-400",
    database: "text-cyan-400",
    security: "text-orange-400",
  };
  return map[agentType ?? ""] ?? "text-primary";
}

function AgentIcon({ agentType }: { agentType: string | null }) {
  const opt = AGENT_OPTIONS.find((a) => a.value === (agentType ?? ""));
  const Icon = opt?.icon ?? Bot;
  return <Icon className={`h-4 w-4 ${opt?.color ?? "text-primary"}`} />;
}

function fmtDuration(start: string, end?: string | null): string {
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Step Row ──────────────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: TaskStep; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-start gap-3 py-2"
    >
      <div className="mt-0.5 flex-shrink-0">
        <StatusIcon status={step.status} size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              step.status === "completed"
                ? "text-foreground"
                : step.status === "running"
                ? "text-blue-300"
                : step.status === "failed"
                ? "text-red-400"
                : "text-muted-foreground"
            }`}
          >
            {step.name}
          </span>
          {step.startedAt && step.status === "running" && (
            <span className="text-xs text-muted-foreground">running…</span>
          )}
        </div>
        {step.detail && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{step.detail}</p>
        )}
      </div>
      {step.startedAt && step.completedAt && (
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {fmtDuration(step.startedAt, step.completedAt)}
        </span>
      )}
    </motion.div>
  );
}

// ─── Task Queue Item ───────────────────────────────────────────────────────────

function TaskQueueItem({
  task,
  isSelected,
  onClick,
}: {
  task: QueueTask;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-3 py-2.5 rounded-lg transition-colors border",
        isSelected
          ? "bg-primary/10 border-primary/30"
          : "bg-card/50 border-border hover:bg-muted/50",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-1">
        <StatusIcon status={task.status} size={14} />
        <AgentIcon agentType={task.agent_type} />
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${statusColor(task.status)}`}>
          {task.status}
        </span>
        <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
          {fmtTime(task.started_at)}
        </span>
      </div>
      <p className="text-sm text-foreground font-medium leading-snug line-clamp-2">{task.label}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-muted-foreground">{task.type.replace("_", " ")}</span>
        {task.completed_at && (
          <span className="text-xs text-muted-foreground">
            · {fmtDuration(task.started_at, task.completed_at)}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── Task Creation Form ────────────────────────────────────────────────────────

function NewTaskForm({ onCreated }: { onCreated: (taskId: string) => void }) {
  const [taskType, setTaskType] = useState<TaskCategory>("agent_invoke");
  const [prompt, setPrompt] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      tasksApi.create({
        type: taskType,
        request: prompt.trim(),
        preferred_agent: selectedAgent || undefined,
      }),
    onSuccess: (data) => {
      setPrompt("");
      setError(null);
      onCreated(data.task.id);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">Task Type</h3>
        <div className="grid grid-cols-1 gap-2">
          {TASK_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTaskType(t.value)}
              className={[
                "text-left px-4 py-3 rounded-lg border transition-colors",
                taskType === t.value
                  ? "bg-primary/10 border-primary/40 text-foreground"
                  : "bg-card/50 border-border hover:bg-muted/50 text-muted-foreground",
              ].join(" ")}
            >
              <div className="text-sm font-medium">{t.label}</div>
              <div className="text-xs mt-0.5 opacity-70">{t.description}</div>
            </button>
          ))}
        </div>
      </div>

      {taskType === "agent_invoke" && (
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Agent</h3>
          <div className="grid grid-cols-2 gap-1.5">
            {AGENT_OPTIONS.map((a) => {
              const Icon = a.icon;
              const active = selectedAgent === a.value;
              return (
                <button
                  key={a.value}
                  onClick={() => setSelectedAgent(a.value)}
                  className={[
                    "flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors",
                    active
                      ? "bg-primary/10 border-primary/40 text-foreground"
                      : "bg-card/50 border-border hover:bg-muted/50 text-muted-foreground",
                  ].join(" ")}
                >
                  <Icon className={`h-4 w-4 ${a.color}`} />
                  {a.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">
          {taskType === "agent_invoke" ? "Prompt" : "Project Description"}
        </h3>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            taskType === "agent_invoke"
              ? "What do you want the agent to do? e.g. 'Debug this authentication flow and suggest fixes'"
              : "Describe the project to analyze. e.g. 'A multi-tenant SaaS CRM with Stripe billing and team management'"
          }
          rows={5}
          className="resize-none bg-muted/30 border-border focus:border-primary/50 text-sm"
        />
        {error && (
          <div className="mt-2 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      <Button
        onClick={() => createMutation.mutate()}
        disabled={!prompt.trim() || createMutation.isPending}
        className="w-full gap-2"
      >
        {createMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {createMutation.isPending ? "Starting task…" : "Run Task"}
      </Button>
    </div>
  );
}

// ─── Live Execution View ───────────────────────────────────────────────────────

function LiveExecutionView({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient();
  const [liveTask, setLiveTask] = useState<QueueTask | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);

    try {
      await streamTask(
        taskId,
        (event: TaskStreamEvent) => {
          if (event.type === "snapshot") {
            setLiveTask(event.task);
          } else if (event.type === "step") {
            setLiveTask((prev) => {
              if (!prev) return prev;
              const steps = prev.steps.map((s) =>
                s.name === event.step.name
                  ? { ...s, ...event.step }
                  : s
              );
              // Add new step if not found
              const exists = steps.some((s) => s.name === event.step.name);
              return {
                ...prev,
                steps: exists ? steps : [...steps, event.step as TaskStep],
              };
            });
          } else if (event.type === "agent") {
            setLiveTask((prev) =>
              prev
                ? {
                    ...prev,
                    agent_type: event.agentType,
                    model_id: event.modelId,
                    task_type: event.taskType,
                  }
                : prev
            );
          } else if (event.type === "progress") {
            setOutput(event.text);
          } else if (event.type === "complete") {
            setLiveTask((prev) =>
              prev
                ? {
                    ...prev,
                    status: event.status,
                    output: event.output ?? (event.error ? { error: event.error } : null),
                    completed_at: new Date().toISOString(),
                  }
                : prev
            );
            if (event.output?.content) setOutput(event.output.content);
          } else if (event.type === "done") {
            setStreaming(false);
            void queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }
        },
        ac.signal,
      );
    } catch (err) {
      if (!ac.signal.aborted) {
        console.error("[StreamTask]", err);
      }
    } finally {
      setStreaming(false);
    }
  }, [taskId, queryClient]);

  useEffect(() => {
    void startStream();
    return () => {
      abortRef.current?.abort();
    };
  }, [startStream]);

  if (!liveTask) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="text-sm">Connecting to task stream…</span>
      </div>
    );
  }

  const isFinished = ["completed", "failed", "cancelled"].includes(liveTask.status);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg bg-card border ${agentColor(liveTask.agent_type)} border-current/20`}>
          <AgentIcon agentType={liveTask.agent_type} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground leading-snug">{liveTask.label}</h3>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor(liveTask.status)}`}>
              {liveTask.status}
            </span>
            {liveTask.agent_type && (
              <span className={`text-xs font-medium ${agentColor(liveTask.agent_type)}`}>
                {liveTask.agent_type}
              </span>
            )}
            {liveTask.model_id && (
              <span className="text-xs text-muted-foreground truncate max-w-[180px]">{liveTask.model_id}</span>
            )}
            {liveTask.started_at && (
              <span className="text-xs text-muted-foreground ml-auto">
                {isFinished
                  ? fmtDuration(liveTask.started_at, liveTask.completed_at)
                  : streaming
                  ? "running…"
                  : ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="bg-card/50 border border-border rounded-lg px-4 py-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Execution Steps
        </h4>
        <div className="divide-y divide-border/50">
          {liveTask.steps.map((step, i) => (
            <StepRow key={step.name} step={step} index={i} />
          ))}
          {liveTask.steps.length === 0 && (
            <div className="py-4 text-center text-muted-foreground text-sm">
              Waiting for first step…
            </div>
          )}
        </div>
      </div>

      {/* Output */}
      <AnimatePresence>
        {(output || liveTask.output) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/50 border border-border rounded-lg p-4"
          >
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
              <GitBranch className="h-3 w-3" />
              Output
            </h4>

            {liveTask.output?.error ? (
              <div className="flex items-start gap-2 text-red-400">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <p className="text-sm">{liveTask.output.error}</p>
              </div>
            ) : output ? (
              <div className="prose prose-invert prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-foreground/90 leading-relaxed overflow-auto max-h-96 bg-muted/30 rounded p-3">
                  {output}
                </pre>
              </div>
            ) : liveTask.output?.understanding ? (
              <UnderstandingOutput understanding={liveTask.output.understanding} />
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pipeline summary */}
      {liveTask.output?.spec && (
        <PipelineSummary
          spec={liveTask.output.spec as Record<string, unknown>}
          validation={liveTask.output.validation as Record<string, unknown> | undefined}
          phasePlan={liveTask.output.phasePlan as unknown[] | undefined}
        />
      )}
    </div>
  );
}

// ─── Understanding output ──────────────────────────────────────────────────────

function UnderstandingOutput({ understanding }: { understanding: unknown }) {
  const u = understanding as Record<string, unknown>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Project Type" value={String(u?.projectType ?? "—")} />
        <Stat label="Complexity" value={String(u?.complexity ?? "—")} />
        <Stat label="Confidence" value={u?.confidence ? `${Math.round(Number(u.confidence) * 100)}%` : "—"} />
        <Stat label="Requirements" value={String(Array.isArray(u?.inferredRequirements) ? u.inferredRequirements.length : "—")} />
      </div>
      {Array.isArray(u?.ambiguities) && u.ambiguities.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-semibold mb-1">Ambiguities</p>
          <ul className="space-y-1">
            {(u.ambiguities as string[]).slice(0, 4).map((a, i) => (
              <li key={i} className="text-xs text-foreground/80 flex gap-2">
                <ChevronRight className="h-3 w-3 mt-0.5 text-muted-foreground flex-shrink-0" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Pipeline summary ──────────────────────────────────────────────────────────

function PipelineSummary({
  spec,
  validation,
  phasePlan,
}: {
  spec: Record<string, unknown>;
  validation?: Record<string, unknown>;
  phasePlan?: unknown[];
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/50 border border-border rounded-lg p-4 space-y-4"
    >
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
        <BookOpen className="h-3 w-3" />
        Architecture Blueprint
      </h4>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Features" value={String(Array.isArray(spec?.features) ? spec.features.length : 0)} />
        <Stat label="Pages" value={String(Array.isArray(spec?.pages) ? spec.pages.length : 0)} />
        <Stat label="DB Tables" value={String(Array.isArray(spec?.dbSchema) ? spec.dbSchema.length : 0)} />
        <Stat label="API Routes" value={String(Array.isArray(spec?.apiContracts) ? spec.apiContracts.length : 0)} />
        <Stat label="Components" value={String(Array.isArray(spec?.components) ? spec.components.length : 0)} />
        <Stat
          label="Validation"
          value={validation ? `${validation?.score ?? "?"}/100` : "—"}
          highlight={validation?.valid === true ? "green" : validation?.valid === false ? "red" : undefined}
        />
      </div>
      {phasePlan && (
        <div>
          <p className="text-xs text-muted-foreground font-semibold mb-2">
            Development Phases ({phasePlan.length})
          </p>
          <div className="space-y-1">
            {(phasePlan as Array<Record<string, unknown>>).map((phase, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center font-semibold flex-shrink-0 text-[10px]">
                  {i + 1}
                </span>
                <span className="text-foreground/80">{String(phase?.phaseName ?? phase?.name ?? `Phase ${i + 1}`)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "green" | "red";
}) {
  return (
    <div className="bg-muted/30 rounded-lg p-2.5">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p
        className={`text-base font-bold mt-0.5 ${
          highlight === "green"
            ? "text-emerald-400"
            : highlight === "red"
            ? "text-red-400"
            : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyDetail() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
      <div className="p-4 rounded-2xl bg-primary/10 border border-primary/20">
        <BrainCircuit className="h-10 w-10 text-primary" />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-foreground">Autonomous AI Engine</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          Create a task to invoke any AI agent, run the full architecture pipeline, or
          deeply analyze a project description. Live progress streams in real-time.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        {[
          { icon: Bot, label: "Agent Invoke", desc: "Any of 7 specialists" },
          { icon: Zap, label: "Full Pipeline", desc: "Analyze → Spec → Validate" },
          { icon: Search, label: "Understand", desc: "Requirements + ambiguities" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="bg-card/50 border border-border rounded-lg p-3 text-center">
            <Icon className="h-5 w-5 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium text-foreground">{label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AIEngine() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => tasksApi.list(50),
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => tasksApi.cancel(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const tasks = data?.items ?? [];

  const handleCreated = (id: string) => {
    setSelectedId(id);
    setShowForm(false);
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const selectedTask = tasks.find((t) => t.id === selectedId) ?? null;
  const canCancel =
    selectedTask &&
    (selectedTask.status === "pending" || selectedTask.status === "running");

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* ── Left panel: queue + new task ──────────────────────────────────── */}
      <div className="w-80 flex-shrink-0 border-r border-border flex flex-col bg-card/30">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">AI Engine</h2>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => refetch()}
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                setShowForm(true);
                setSelectedId(null);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New Task
            </Button>
          </div>
        </div>

        {/* Task queue */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {isLoading ? (
            <div className="flex justify-center pt-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center gap-2 pt-10 text-center text-muted-foreground">
              <Bot className="h-8 w-8 opacity-40" />
              <p className="text-sm">No tasks yet.</p>
              <p className="text-xs">Create one to get started.</p>
            </div>
          ) : (
            tasks.map((task) => (
              <TaskQueueItem
                key={task.id}
                task={task}
                isSelected={task.id === selectedId && !showForm}
                onClick={() => {
                  setSelectedId(task.id);
                  setShowForm(false);
                }}
              />
            ))
          )}
        </div>

        {/* Stats bar */}
        {tasks.length > 0 && (
          <div className="border-t border-border px-4 py-2 flex gap-4 text-xs text-muted-foreground">
            <span>{tasks.filter((t) => t.status === "running").length} running</span>
            <span>{tasks.filter((t) => t.status === "completed").length} done</span>
            <span>{tasks.filter((t) => t.status === "failed").length} failed</span>
          </div>
        )}
      </div>

      {/* ── Right panel: detail / form ───────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          {showForm ? (
            <motion.div
              key="form"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="h-full"
            >
              {/* Form header */}
              <div className="sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-border bg-background/95 backdrop-blur">
                <div className="p-1.5 rounded-lg bg-primary/10">
                  <Plus className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">New Task</h2>
                  <p className="text-xs text-muted-foreground">Configure and start an AI agent task</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-xs"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
              <div className="px-6 py-5 max-w-2xl mx-auto">
                <NewTaskForm onCreated={handleCreated} />
              </div>
            </motion.div>
          ) : selectedId ? (
            <motion.div
              key={selectedId}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="h-full"
            >
              {/* Detail header */}
              <div className="sticky top-0 z-10 flex items-center gap-3 px-6 py-3 border-b border-border bg-background/95 backdrop-blur">
                <div className={`p-1.5 rounded-lg bg-card border ${agentColor(selectedTask?.agent_type ?? null)} border-current/20`}>
                  <AgentIcon agentType={selectedTask?.agent_type ?? null} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-sm font-semibold text-foreground truncate">
                    {selectedTask?.label ?? selectedId}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedTask?.type?.replace("_", " ")} · started {selectedTask ? fmtTime(selectedTask.started_at) : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                      onClick={() => cancelMutation.mutate(selectedId)}
                      disabled={cancelMutation.isPending}
                    >
                      <Trash2 className="h-3 w-3" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {/* Live execution */}
              <div className="px-6 py-5 max-w-3xl mx-auto">
                <LiveExecutionView key={selectedId} taskId={selectedId} />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full"
            >
              <EmptyDetail />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
