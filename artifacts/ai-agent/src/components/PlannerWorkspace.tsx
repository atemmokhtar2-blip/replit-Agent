/**
 * PlannerWorkspace — Clean Chat UI
 *
 * Chat shows only 4 states:
 *   1. Planning…  — user message + thinking bubble
 *   2. Building… — blueprint ready, auto-executing in background
 *   3. Verifying… — checks running with live progress
 *   4. ✅ Ready   — VerificationCard with "Open Preview" button
 *
 * Execution details (stages, check results) live in the floating TaskExecutionPanel.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import React from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useRenameConversation,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { AIMessage } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AIPulse } from "./design-system/AIPulse";
import { streamToPlannerEngine, PLANNER_STAGES } from "@/lib/planner-stream";
import type { PlannerStreamEvent } from "@/lib/planner-stream";
import { streamToExecutionEngine } from "@/lib/execution-stream";
import type { ExecutionStreamEvent } from "@/lib/execution-stream";
import { repositoriesApi } from "@/lib/repo-api";
import { useTaskActions, useTaskStore, DEFAULT_EXEC_PHASES, DEFAULT_VERIFY_CHECKS } from "@/lib/task-store";
import type { ExecutionTask, VerificationCheck, HealthReport, ProductionGate } from "@/lib/task-store";
import type { StageState } from "./design-system/AgentTimeline";
import { VerificationCard, VerificationProgress } from "./design-system/VerificationCard";
import { TaskDetailsDrawer } from "./execution/TaskDetailsDrawer";
import type { TaskStatus } from "@/lib/task-store";

// ── Helpers ────────────────────────────────────────────────────────────────────

function autoTitle(content: string) {
  return content.slice(0, 60).trim() || "New conversation";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function countBlueprintSections(content: string): number {
  return (content.match(/^##\s+\d+\./gm) ?? []).length;
}

function isBlueprint(content: string, module?: string): boolean {
  return module === "planner" || /^##\s+1\./m.test(content);
}

const INITIAL_STAGES: StageState[] = PLANNER_STAGES.map((s) => ({
  id: s.id,
  name: s.name,
  action: s.action,
  status: "pending",
}));

// ── Message bubble components ──────────────────────────────────────────────────

function UserBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] sm:max-w-[65%]">
        <div className="rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground leading-relaxed shadow-sm">
          {content}
        </div>
        {timestamp && (
          <p className="mt-0.5 text-right text-[10px] text-muted-foreground/40">{formatTime(timestamp)}</p>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ children, timestamp }: { children: React.ReactNode; timestamp?: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border mt-0.5">
        <AIPulse size={15} color="#6366f1" active />
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl rounded-tl-md bg-card border border-border px-4 py-3 text-sm text-foreground leading-relaxed shadow-sm">
          {children}
        </div>
        {timestamp && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/40">{formatTime(timestamp)}</p>
        )}
      </div>
    </div>
  );
}

// ── Thinking indicator ─────────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <AssistantBubble>
      <div className="flex flex-col gap-2">
        <p className="text-foreground/80">
          Understood. I'm analyzing your project and designing the architecture.
        </p>
        <div className="flex items-center gap-[4px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
            />
          ))}
        </div>
      </div>
    </AssistantBubble>
  );
}

// ── Building bubble — shown while execution pipeline runs ─────────────────────

function BuildingBubble({ stageName }: { stageName?: string }) {
  return (
    <AssistantBubble>
      <div className="flex flex-col gap-2">
        <p className="text-foreground/80">
          Blueprint ready. Now building and verifying your project…
        </p>
        {stageName && (
          <p className="text-[11px] text-muted-foreground/50 font-mono">{stageName}</p>
        )}
        <div className="flex items-center gap-[4px]">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500/50 animate-bounce"
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
            />
          ))}
        </div>
      </div>
    </AssistantBubble>
  );
}

// ── Completion card ────────────────────────────────────────────────────────────

function CompletionBubble({
  task,
  onViewBlueprint,
}: {
  task: ExecutionTask;
  onViewBlueprint: () => void;
}) {
  const sectionCount = task.result ? countBlueprintSections(task.result.content) : 0;

  const handleCopyAll = () => {
    if (task.result) {
      navigator.clipboard.writeText(task.result.content).then(() => {
        toast.success("Blueprint copied to clipboard");
      });
    }
  };

  return (
    <AssistantBubble>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-green-400">
              <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">
            Architecture blueprint complete.
          </p>
        </div>
        <p className="text-sm text-foreground/70 leading-relaxed">
          {sectionCount > 0
            ? `Generated ${sectionCount} section${sectionCount !== 1 ? "s" : ""} covering your full project architecture.`
            : "The blueprint has been generated and is ready to view."}
          {task.result?.model && (
            <span className="text-muted-foreground/40"> via {task.result.model.split("/").pop()}</span>
          )}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onViewBlueprint}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M1 5.5h9M6.5 2l3.5 3.5L6.5 9" />
            </svg>
            View Blueprint
          </button>
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
              <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
              <path d="M2.5 7.5H1.5a1 1 0 01-1-1V1.5a1 1 0 011-1h5a1 1 0 011 1v1" />
            </svg>
            Copy All
          </button>
        </div>
      </div>
    </AssistantBubble>
  );
}

// ── History blueprint card (for past messages from DB) ────────────────────────

function HistoryBlueprintCard({
  content,
  model,
  timestamp,
  onViewDetails,
}: {
  content: string;
  model?: string;
  timestamp?: string;
  onViewDetails: () => void;
}) {
  const sectionCount = countBlueprintSections(content);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      toast.success("Blueprint copied");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <AssistantBubble timestamp={timestamp}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-green-400">
              <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-medium text-foreground">Blueprint ready</p>
          {model && <span className="text-[10px] text-muted-foreground/40">via {model.split("/").pop()}</span>}
        </div>
        {sectionCount > 0 && (
          <p className="text-xs text-muted-foreground/60">
            {sectionCount} sections · Architecture blueprint
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={onViewDetails}
            className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M1 5.5h9M6.5 2l3.5 3.5L6.5 9" />
            </svg>
            View Details
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {copied ? <span className="text-green-400">Copied</span> : "Copy All"}
          </button>
        </div>
      </div>
    </AssistantBubble>
  );
}

// ── Inline blueprint drawer for history items ─────────────────────────────────

function HistoryViewerDrawer({
  content,
  model,
  onClose,
}: {
  content: string;
  model?: string;
  onClose: () => void;
}) {
  const fakeTask: ExecutionTask = {
    id: "history-view",
    conversationId: "",
    title: "Architecture Blueprint",
    userPrompt: "",
    status: "ready" as TaskStatus,
    progress: 100,
    stages: INITIAL_STAGES.map((s) => ({ ...s, status: "complete" as const })),
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    result: { content, model: model ?? "" },
  };
  return <TaskDetailsDrawer task={fakeTask} onClose={onClose} />;
}

// ── Conversation message (casual AI reply) ────────────────────────────────────

function ConversationBubble({ content, timestamp }: { content: string; timestamp?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <AssistantBubble timestamp={timestamp}>
      <div className="group relative">
        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap pr-6">{content}</p>
        <button
          onClick={handleCopy}
          className="absolute right-0 top-0 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          {copied ? (
            <span className="text-[10px] text-green-400">Copied</span>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" />
            </svg>
          )}
        </button>
      </div>
    </AssistantBubble>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="relative">
        <AIPulse size={56} color="#6366f1" active />
      </div>
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-foreground mb-2">Ready to plan</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Describe the software you want to build. The AI agent will analyze requirements,
          generate a complete architecture blueprint, then automatically build and verify it.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
        {["SaaS application", "Telegram bot", "Mobile app", "API service"].map((example) => (
          <span
            key={example}
            className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground"
          >
            {example}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Phase type ─────────────────────────────────────────────────────────────────

type WorkspacePhase =
  | { kind: "idle" }
  | { kind: "streaming";      taskId: string; userMessage: string }
  | { kind: "done_blueprint"; taskId: string; userMessage: string }
  | { kind: "executing";      taskId: string; userMessage: string; currentStageName?: string }
  | { kind: "verifying";      taskId: string; userMessage: string; currentStageName?: string }
  | { kind: "verified";       taskId: string; userMessage: string; allPassed: boolean; checks: VerificationCheck[]; healthReport?: HealthReport; previewUrl?: string; productionGate?: ProductionGate }
  | { kind: "done_conversation"; content: string; userMessage: string }
  | { kind: "error";          message: string; userMessage: string; retryable?: boolean; taskId?: string; blueprint?: string };

// ── Main PlannerWorkspace ──────────────────────────────────────────────────────

interface PlannerWorkspaceProps {
  conversationId: string;
  messages: AIMessage[];
  isFirstMessage: boolean;
  onSuccess: (conversationId: string) => void;
  initialRepoId?: string;
}

export function PlannerWorkspace({
  conversationId,
  messages,
  isFirstMessage,
  onSuccess,
  initialRepoId,
}: PlannerWorkspaceProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<WorkspacePhase>({ kind: "idle" });
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<string>(initialRepoId ?? "");
  const [historyViewing, setHistoryViewing] = useState<{ content: string; model?: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const execAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasFirstRef = useRef(isFirstMessage);
  const priorMessageCountRef = useRef(messages.length);

  const renameMutation = useRenameConversation();
  const blueprintRef = useRef<string>("");

  const { tasks } = useTaskStore();
  const {
    createTask, stageStart, stageComplete, completeTask, failTask,
    startExecution, execPhaseStart, execPhaseComplete, execPhaseFail,
    setVerifyCheck, setVerifyFixing, setVerified, setHealthReport, setExecError, retryExecution,
  } = useTaskActions();

  const { data: reposData } = useQuery({
    queryKey: ["repositories"],
    queryFn: repositoriesApi.list,
    staleTime: 60_000,
  });
  const repositories = reposData?.items ?? [];

  // Scroll to bottom when content changes
  useEffect(() => {
    if (phase.kind !== "idle") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [phase]);

  // ── Execution pipeline (auto-triggered after blueprint done) ──────────────────

  const runExecution = useCallback(async (taskId: string, blueprint: string, convId: string) => {
    execAbortRef.current?.abort();
    const controller = new AbortController();
    execAbortRef.current = controller;

    startExecution(taskId, DEFAULT_EXEC_PHASES.map((p) => ({ ...p })));

    setPhase((prev) =>
      prev.kind === "done_blueprint"
        ? { kind: "executing", taskId: prev.taskId, userMessage: (prev as { userMessage: string }).userMessage }
        : prev
    );

    const handleExecEvent = (event: ExecutionStreamEvent) => {
      switch (event.type) {
        case "exec_stage_start":
          execPhaseStart(taskId, event.stage);
          setPhase((prev) => {
            if (prev.kind === "executing" || prev.kind === "verifying") {
              return {
                ...prev,
                kind: event.stage >= 10 ? "verifying" : "executing",
                currentStageName: event.stageName,
              } as WorkspacePhase;
            }
            return prev;
          });
          break;

        case "exec_stage_complete":
          execPhaseComplete(taskId, event.stage, event.duration ?? 0);
          break;

        case "exec_stage_fail":
          execPhaseFail(taskId, event.stage, event.error ?? "Stage failed");
          break;

        case "verify_check": {
          const statusMap: Record<string, VerificationCheck["status"]> = {
            checking: "checking",
            pass: "pass",
            fail: "fail",
            skip: "skip",
            fixing: "fixing",
            fixed: "fixed",
          };
          const st = statusMap[event.status ?? "checking"] ?? "checking";
          setVerifyCheck(taskId, {
            id: event.check ?? "",
            name: event.checkName ?? "",
            domain: event.checkDomain,
            status: st,
            detail: event.detail,
          });
          setPhase((prev) =>
            prev.kind === "executing"
              ? { ...prev, kind: "verifying" } as WorkspacePhase
              : prev
          );
          break;
        }

        case "fix_attempt":
          setVerifyFixing(taskId, event.check ?? "", event.strategy ?? "");
          break;

        case "fix_result":
          setVerifyCheck(taskId, {
            id: event.check ?? "",
            name: "",
            status: event.status === "fixed" ? "fixed" : event.status === "fixing" ? "fixing" : "fail",
            detail: event.strategy,
          });
          break;

        case "health_report":
          if (event.healthReport) {
            setHealthReport(taskId, event.healthReport);
          }
          break;

        case "production_gate":
          // store gate result on task via setVerifyCheck side-effect — gate is
          // persisted when exec_done fires; no action needed here
          break;

        case "exec_done": {
          const checks: VerificationCheck[] = (event.checks ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            domain: c.domain,
            status: c.status === "pass" ? "pass" : c.status === "skip" ? "skip" : "fail",
            detail: c.detail,
            duration: c.duration,
          }));

          const healthReport = event.healthReport ?? undefined;
          const previewUrl = event.previewUrl;
          const productionGate = event.productionGate;

          setVerified(
            taskId,
            {
              phases: DEFAULT_EXEC_PHASES.map((p) => ({ ...p, status: "complete" })),
              checks,
              healthReport,
              allPassed: event.allPassed ?? false,
              completedAt: new Date().toISOString(),
            },
            previewUrl,
            productionGate,
          );

          setPhase((prev) => {
            const userMessage = (prev as { userMessage?: string }).userMessage ?? "";
            return {
              kind: "verified",
              taskId,
              userMessage,
              allPassed: event.allPassed ?? false,
              checks,
              healthReport,
              previewUrl,
              productionGate,
            };
          });
          break;
        }

        case "exec_error":
          setExecError(taskId, event.message ?? "Execution error");
          setPhase((prev) => ({
            kind: "error",
            message: event.message ?? "Execution failed",
            userMessage: (prev as { userMessage?: string }).userMessage ?? "",
            retryable: event.retryable ?? true,
            taskId,
            blueprint: blueprintRef.current,
          }));
          break;
      }
    };

    try {
      await streamToExecutionEngine(convId, blueprint, handleExecEvent, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Execution failed";
      setExecError(taskId, msg);
      setPhase((prev) => ({
        kind: "error",
        message: msg,
        userMessage: (prev as { userMessage?: string }).userMessage ?? "",
      }));
    }
  }, [startExecution, execPhaseStart, execPhaseComplete, execPhaseFail,
      setVerifyCheck, setVerifyFixing, setVerified, setHealthReport, setExecError]);

  // ── Retry handler — re-runs execution without restarting conversation ─────────

  const handleRetryExecution = useCallback((taskId: string, blueprint: string) => {
    retryExecution(taskId);
    setPhase((prev) => ({
      kind: "executing",
      taskId,
      userMessage: (prev as { userMessage?: string }).userMessage ?? "",
    }));
    void runExecution(taskId, blueprint, conversationId);
  }, [retryExecution, runExecution, conversationId]);

  const handleRetryVerification = useCallback((taskId: string, blueprint: string) => {
    retryExecution(taskId);
    setPhase((prev) => ({
      kind: "verifying",
      taskId,
      userMessage: (prev as { userMessage?: string }).userMessage ?? "",
    }));
    void runExecution(taskId, blueprint, conversationId);
  }, [retryExecution, runExecution, conversationId]);

  const handleRetryPreview = useCallback(() => {
    toast.info("Restarting preview server…");
  }, []);

  // ── Planning pipeline ──────────────────────────────────────────────────────────

  const handleSend = useCallback(async (overrideContent?: string) => {
    const content = overrideContent !== undefined ? overrideContent : input.trim();
    if (!content || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    wasFirstRef.current = isFirstMessage;
    priorMessageCountRef.current = messages.length;

    abortRef.current?.abort();
    execAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const taskId = `${conversationId}-${Date.now()}`;
    const taskTitle = content.length > 50 ? content.slice(0, 50) + "…" : content;

    createTask({
      id: taskId,
      conversationId,
      title: taskTitle,
      userPrompt: content,
      stages: INITIAL_STAGES.map((s) => ({ ...s })),
      startedAt: new Date().toISOString(),
    });

    setPhase({ kind: "streaming", taskId, userMessage: content });

    let capturedBlueprint = "";

    const handleEvent = (event: PlannerStreamEvent) => {
      switch (event.type) {
        case "stage_start":
          stageStart(taskId, event.stage);
          break;

        case "stage_complete":
          stageComplete(taskId, event.stage);
          break;

        case "content_chunk":
        case "section_detected":
          break;

        case "done":
          capturedBlueprint = event.content;
          blueprintRef.current = event.content;
          completeTask(taskId, event.content, event.model);
          setPhase({ kind: "done_blueprint", taskId, userMessage: content });
          setIsStreaming(false);

          queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          onSuccess(conversationId);

          if (wasFirstRef.current) {
            renameMutation.mutate(
              { conversationId, data: { title: autoTitle(content) } },
              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) }
            );
          }

          // ── Auto-trigger execution pipeline ──────────────────────────────────
          void runExecution(taskId, capturedBlueprint, conversationId);
          break;

        case "conversation":
          setPhase({ kind: "done_conversation", content: event.content, userMessage: content });
          setIsStreaming(false);
          queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          onSuccess(conversationId);
          if (wasFirstRef.current) {
            renameMutation.mutate(
              { conversationId, data: { title: autoTitle(content) } },
              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) }
            );
          }
          break;

        case "error":
          failTask(taskId, event.message);
          setPhase({ kind: "error", message: event.message, userMessage: content });
          setIsStreaming(false);
          break;
      }
    };

    try {
      await streamToPlannerEngine(content, conversationId, handleEvent, controller.signal, selectedRepoId || undefined);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Connection failed";
      failTask(taskId, msg);
      setPhase({ kind: "error", message: msg, userMessage: content });
      toast.error(msg);
    } finally {
      if (!controller.signal.aborted) setIsStreaming(false);
    }
  }, [input, isStreaming, conversationId, isFirstMessage, queryClient, renameMutation, onSuccess,
      createTask, stageStart, stageComplete, completeTask, failTask, selectedRepoId, runExecution]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Render message history ──────────────────────────────────────────────────

  const renderHistory = () => {
    const limit = phase.kind === "idle" ? messages.length : priorMessageCountRef.current;
    const visible = messages.slice(0, limit);
    if (visible.length === 0) return null;
    return visible.map((msg) => {
      if (msg.role === "user") {
        return <UserBubble key={msg.id} content={msg.content} timestamp={msg.created_at} />;
      }
      if (msg.role === "assistant") {
        const metadata = msg.metadata as { module?: string; model?: string } | null;
        const model = metadata?.model;
        if (isBlueprint(msg.content, metadata?.module)) {
          return (
            <HistoryBlueprintCard
              key={msg.id}
              content={msg.content}
              model={model}
              timestamp={msg.created_at}
              onViewDetails={() => setHistoryViewing({ content: msg.content, model })}
            />
          );
        }
        return (
          <ConversationBubble key={msg.id} content={msg.content} timestamp={msg.created_at} />
        );
      }
      return null;
    });
  };

  // ── Render current phase ────────────────────────────────────────────────────

  const renderPhase = () => {
    switch (phase.kind) {
      case "streaming":
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <ThinkingBubble />
          </>
        );

      case "done_blueprint": {
        const task = tasks.find((t) => t.id === phase.taskId);
        if (!task) return null;
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <CompletionBubble
              task={task}
              onViewBlueprint={() => {
                if (task.result) setHistoryViewing({ content: task.result.content, model: task.result.model });
              }}
            />
          </>
        );
      }

      case "executing": {
        const task = tasks.find((t) => t.id === phase.taskId);
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result && (
              <CompletionBubble
                task={task}
                onViewBlueprint={() => {
                  if (task.result) setHistoryViewing({ content: task.result.content, model: task.result.model });
                }}
              />
            )}
            <BuildingBubble stageName={phase.currentStageName} />
          </>
        );
      }

      case "verifying": {
        const task = tasks.find((t) => t.id === phase.taskId);
        const checks = task?.verificationChecks ?? [];
        const phases = task?.execPhases ?? [];
        const currentPhase = phases.find((p) => p.status === "running");
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result && (
              <CompletionBubble
                task={task}
                onViewBlueprint={() => {
                  if (task.result) setHistoryViewing({ content: task.result.content, model: task.result.model });
                }}
              />
            )}
            <div className="flex gap-2.5 items-start">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border mt-0.5">
                <AIPulse size={15} color="#6366f1" active />
              </div>
              <div className="flex-1 min-w-0">
                <VerificationProgress checks={checks} phases={phases} currentPhase={currentPhase} />
              </div>
            </div>
          </>
        );
      }

      case "verified": {
        const task = tasks.find((t) => t.id === phase.taskId);
        const blueprint = blueprintRef.current || task?.result?.content || "";
        const effectivePreviewUrl = phase.previewUrl ?? task?.previewUrl;
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result && (
              <CompletionBubble
                task={task}
                onViewBlueprint={() => {
                  if (task.result) setHistoryViewing({ content: task.result.content, model: task.result.model });
                }}
              />
            )}
            <div className="flex gap-2.5 items-start">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border mt-0.5">
                <AIPulse size={15} color={phase.allPassed ? "#22c55e" : "#ef4444"} active />
              </div>
              <div className="flex-1 min-w-0">
                <VerificationCard
                  checks={phase.checks}
                  phases={task?.execPhases}
                  allPassed={phase.allPassed}
                  healthReport={phase.healthReport ?? task?.healthReport}
                  onPreview={effectivePreviewUrl
                    ? () => window.open(effectivePreviewUrl, "_blank", "noopener,noreferrer")
                    : () => toast.info("Preview URL not available yet")}
                  onRetryBuild={() => handleRetryExecution(phase.taskId, blueprint)}
                  onRetryVerification={() => handleRetryVerification(phase.taskId, blueprint)}
                  onRetryPreview={handleRetryPreview}
                />
              </div>
            </div>
          </>
        );
      }

      case "done_conversation":
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <ConversationBubble content={phase.content} />
          </>
        );

      case "error":
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <AssistantBubble>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-400">{phase.message}</p>
                </div>
                {phase.retryable && phase.taskId && (
                  <div className="flex flex-wrap gap-2 pt-1 border-t border-border/30">
                    <p className="w-full text-[10px] text-muted-foreground/40">
                      Retry without restarting the conversation:
                    </p>
                    <button
                      onClick={() => phase.taskId && phase.blueprint !== undefined && handleRetryExecution(phase.taskId, phase.blueprint || blueprintRef.current)}
                      className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                        <path d="M1.5 5a3.5 3.5 0 105.5-2.9" /><path d="M6.5 1L7 3.1l-2.1.4" />
                      </svg>
                      Retry Build
                    </button>
                    <button
                      onClick={() => phase.taskId && handleRetryVerification(phase.taskId, phase.blueprint || blueprintRef.current)}
                      className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                        <path d="M1.5 5a3.5 3.5 0 105.5-2.9" /><path d="M6.5 1L7 3.1l-2.1.4" />
                      </svg>
                      Retry Verification
                    </button>
                  </div>
                )}
              </div>
            </AssistantBubble>
          </>
        );

      case "idle":
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden">

      {/* ── Chat area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-4">

          {renderHistory()}
          {renderPhase()}

          {/* Regenerate button — idle only */}
          {phase.kind === "idle" && (() => {
            const lastUser = [...messages].reverse().find((m) => m.role === "user");
            if (!lastUser) return null;
            return (
              <div className="flex justify-center pt-1">
                <button
                  onClick={() => handleSend(lastUser.content)}
                  disabled={isStreaming}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted transition-all disabled:opacity-40"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M9.5 2A5 5 0 1 0 9.8 6.5" />
                    <polyline points="9.5,0 9.5,2.5 7,2.5" />
                  </svg>
                  Regenerate response
                </button>
              </div>
            );
          })()}

          {messages.length === 0 && phase.kind === "idle" && <EmptyState />}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Input area ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 border-t border-border bg-background/95 backdrop-blur-sm px-3 pt-3 pb-3 sm:px-4"
        style={{ paddingBottom: "max(0.75rem, var(--safe-bottom))" }}
      >
        <div className="mx-auto max-w-2xl">
          {repositories.length > 0 && (
            <div className="mb-2 flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted-foreground flex-shrink-0">
                <rect x="1" y="1" width="9" height="9" rx="1" />
                <path d="M3.5 1v9M7.5 1v9M1 4h9M1 7.5h9" />
              </svg>
              <select
                value={selectedRepoId}
                onChange={(e) => setSelectedRepoId(e.target.value)}
                disabled={isStreaming}
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
              >
                <option value="">No repository context</option>
                {repositories.map((r) => (
                  <option key={r.id} value={r.id}>{r.full_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isStreaming
                  ? "Working on it…"
                  : phase.kind === "executing" || phase.kind === "verifying"
                  ? "Building and verifying…"
                  : "Describe the software you want to build…"
              }
              className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-3 text-sm shadow-none focus-visible:ring-0"
              rows={1}
              disabled={isStreaming || phase.kind === "executing" || phase.kind === "verifying"}
            />
            <Button
              size="icon"
              className="mb-2 mr-2 h-8 w-8 flex-shrink-0 rounded-xl"
              onClick={() => handleSend()}
              disabled={!input.trim() || isStreaming || phase.kind === "executing" || phase.kind === "verifying"}
            >
              {isStreaming || phase.kind === "executing" || phase.kind === "verifying" ? (
                <AIPulse size={15} color="white" active />
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.5 1.5L6.5 7.5M12.5 1.5L8.5 12.5L6.5 7.5M12.5 1.5L1.5 5.5L6.5 7.5" />
                </svg>
              )}
            </Button>
          </div>

          <div className="mt-1.5 flex items-center justify-between px-1">
            <p className="text-[10px] text-muted-foreground/35 hidden sm:block">
              Enter to send · Shift+Enter for newline
            </p>
            {(isStreaming || phase.kind === "executing" || phase.kind === "verifying") && (
              <p className="text-[10px] text-primary/60 animate-pulse">
                {phase.kind === "executing"
                  ? "Building in background…"
                  : phase.kind === "verifying"
                  ? "Verifying…"
                  : "Working in background…"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── History Blueprint Viewer ────────────────────────────────────────── */}
      {historyViewing && (
        <HistoryViewerDrawer
          content={historyViewing.content}
          model={historyViewing.model}
          onClose={() => setHistoryViewing(null)}
        />
      )}
    </div>
  );
}
