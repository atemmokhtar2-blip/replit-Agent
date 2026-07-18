/**
 * PlannerWorkspace — Clean Chat Interface
 *
 * Features:
 *  • Live streaming tokens with full Markdown rendering
 *  • Stop generation button
 *  • Edit previous prompt
 *  • Code blocks with syntax highlighting + copy
 *  • Auto-scroll with scroll-lock detection
 *  • Clean ChatGPT-style bubbles (user right / assistant left)
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import React from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useRenameConversation,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { AIMessage } from "@workspace/api-client-react";
import { toast } from "sonner";
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
import { TaskDetailsDrawer } from "./execution/TaskDetailsDrawer";
import type { TaskStatus } from "@/lib/task-store";
import { MarkdownRenderer } from "./chat/MarkdownRenderer";
import type { LogEntry } from "./chat/LiveLogPanel";

// ── Helpers ────────────────────────────────────────────────────────────────────

function autoTitle(content: string) {
  return content.slice(0, 60).trim() || "New conversation";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
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

let _logCounter = 0;
function makeLogId() { return `log-${++_logCounter}`; }
function makeLog(level: LogEntry["level"], message: string): LogEntry {
  return { id: makeLogId(), timestamp: new Date().toISOString(), level, message };
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="9" height="9" rx="1" fill="currentColor" opacity="0.15" />
      <rect x="2" y="2" width="9" height="9" rx="1" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 1.5L6.5 7.5M12.5 1.5L8.5 12.5L6.5 7.5M12.5 1.5L1.5 5.5L6.5 7.5" />
    </svg>
  );
}

function CopyIconSm() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" />
      <path d="M2.5 7.5H1.5a1 1 0 01-1-1V1.5a1 1 0 011-1h5a1 1 0 011 1v1" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 1.5l2 2-6 6H1.5v-2l6-6z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M9.5 2A5 5 0 1 0 9.8 6.5" />
      <polyline points="9.5,0 9.5,2.5 7,2.5" />
    </svg>
  );
}

// ── Message footer (model · timing) ───────────────────────────────────────────

function MessageFooter({
  model,
  elapsedMs,
  timestamp,
}: {
  model?: string;
  elapsedMs?: number;
  timestamp?: string;
}) {
  const parts: React.ReactNode[] = [];

  if (timestamp) parts.push(<span key="ts">{formatTime(timestamp)}</span>);
  if (model) {
    const shortModel = model.split("/").pop() ?? model;
    parts.push(
      <span key="model" className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
        {shortModel}
      </span>
    );
  }
  if (elapsedMs != null) parts.push(<span key="elapsed">{formatElapsed(elapsedMs)}</span>);

  if (parts.length === 0) return null;

  return (
    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/35 flex-wrap">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="opacity-30">·</span>}
          {p}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── User bubble ────────────────────────────────────────────────────────────────

function UserBubble({
  content,
  timestamp,
  onEdit,
}: {
  content: string;
  timestamp?: string;
  onEdit?: (newContent: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) textareaRef.current?.focus(); }, [editing]);

  const submitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== content && onEdit) onEdit(trimmed);
    setEditing(false);
  };

  return (
    <div className="flex justify-end group">
      <div className="max-w-[80%] sm:max-w-[68%]">
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              ref={textareaRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === "Escape") { setEditing(false); setEditValue(content); }
              }}
              className="w-full resize-none rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground leading-relaxed focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 min-h-[60px]"
              rows={3}
            />
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={() => { setEditing(false); setEditValue(content); }}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                إلغاء
              </button>
              <button
                onClick={submitEdit}
                className="rounded-lg bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                إرسال
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative rounded-2xl bg-zinc-800 border border-zinc-700/60 px-4 py-3 text-sm text-zinc-100 leading-relaxed shadow-sm">
              <p className="whitespace-pre-wrap pr-5">{content}</p>
              {onEdit && (
                <button
                  onClick={() => { setEditValue(content); setEditing(true); }}
                  className="absolute right-2.5 top-2.5 rounded p-0.5 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-zinc-400 hover:text-zinc-200"
                  aria-label="تعديل الرسالة"
                >
                  <EditIcon />
                </button>
              )}
            </div>
            {timestamp && (
              <p className="mt-1 text-right text-[10px] text-muted-foreground/30">{formatTime(timestamp)}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Assistant bubble ───────────────────────────────────────────────────────────

function AssistantBubble({
  children,
  timestamp,
  model,
  elapsedMs,
  onCopy,
}: {
  children: React.ReactNode;
  timestamp?: string;
  model?: string;
  elapsedMs?: number;
  onCopy?: () => void;
}) {
  return (
    <div className="flex gap-3 items-start group">
      {/* Avatar dot */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 mt-0.5 shrink-0">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-primary">
          <path d="M8 2L9.8 6.2L14 8L9.8 9.8L8 14L6.2 9.8L2 8L6.2 6.2L8 2Z" fill="currentColor" opacity="0.9" />
        </svg>
      </div>

      <div className="flex-1 min-w-0 relative pt-0.5">
        {onCopy && (
          <button
            onClick={onCopy}
            className="absolute right-0 top-0 rounded p-1 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
            aria-label="نسخ"
          >
            <CopyIconSm />
          </button>
        )}
        <div className="text-sm text-foreground leading-relaxed pr-6">
          {children}
        </div>
        <MessageFooter model={model} elapsedMs={elapsedMs} timestamp={timestamp} />
      </div>
    </div>
  );
}

// ── Typing indicator ───────────────────────────────────────────────────────────

function TypingBubble() {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/20 mt-0.5">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-primary">
          <path d="M8 2L9.8 6.2L14 8L9.8 9.8L8 14L6.2 9.8L2 8L6.2 6.2L8 2Z" fill="currentColor" opacity="0.9" />
        </svg>
      </div>
      <div className="flex items-center gap-1.5 pt-[9px]">
        <span
          className="h-2 w-2 rounded-full bg-foreground/25 animate-bounce"
          style={{ animationDelay: "0ms", animationDuration: "1.2s" }}
        />
        <span
          className="h-2 w-2 rounded-full bg-foreground/25 animate-bounce"
          style={{ animationDelay: "200ms", animationDuration: "1.2s" }}
        />
        <span
          className="h-2 w-2 rounded-full bg-foreground/25 animate-bounce"
          style={{ animationDelay: "400ms", animationDuration: "1.2s" }}
        />
      </div>
    </div>
  );
}

// ── Conversation bubble (plain assistant reply) ────────────────────────────────

function ConversationBubble({
  content,
  timestamp,
  model,
  elapsedMs,
}: {
  content: string;
  timestamp?: string;
  model?: string;
  elapsedMs?: number;
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => toast.success("تم النسخ"));
  };
  return (
    <AssistantBubble timestamp={timestamp} model={model} elapsedMs={elapsedMs} onCopy={handleCopy}>
      <MarkdownRenderer content={content} />
    </AssistantBubble>
  );
}

// ── Error bubble ───────────────────────────────────────────────────────────────

function ErrorBubble({
  message,
  retryable,
  onRetryBuild,
  onRetryVerification,
}: {
  message: string;
  retryable?: boolean;
  onRetryBuild?: () => void;
  onRetryVerification?: () => void;
}) {
  return (
    <AssistantBubble>
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-red-400">
              <line x1="4.5" y1="1" x2="4.5" y2="5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="4.5" cy="7.5" r="0.6" fill="currentColor" />
            </svg>
          </div>
          <p className="text-sm text-red-400 leading-relaxed">{message}</p>
        </div>
        {retryable && (onRetryBuild || onRetryVerification) && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/30">
            {onRetryBuild && (
              <button
                onClick={onRetryBuild}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
              >
                <RefreshIcon />
                إعادة المحاولة
              </button>
            )}
            {onRetryVerification && !onRetryBuild && (
              <button
                onClick={onRetryVerification}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
              >
                <RefreshIcon />
                إعادة التحقق
              </button>
            )}
          </div>
        )}
      </div>
    </AssistantBubble>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

const EXAMPLE_PROMPTS = [
  "ساعدني في بناء تطبيق SaaS لإدارة المشاريع مع الفرق والفواتير",
  "أنشئ بوت تيليغرام لتنبيهات أسعار العملات المشفرة",
  "صمم REST API لسوق إلكتروني مع البائعين والمشترين",
  "ابنِ تطبيق دردشة فوري مع غرف ورسائل مباشرة",
];

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" className="text-primary">
          <path d="M8 1.5L10 6L14.5 8L10 10L8 14.5L6 10L1.5 8L6 6L8 1.5Z" fill="currentColor" opacity="0.85" />
        </svg>
      </div>
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-foreground mb-1.5">ماذا تريد أن تبني؟</h2>
        <p className="text-sm text-muted-foreground/70 leading-relaxed">
          صف فكرتك البرمجية وسيقوم المساعد بتوليد خطة معمارية شاملة لمشروعك.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-1.5 w-full max-w-sm">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPrompt(p)}
            className="rounded-xl border border-border/60 bg-muted/20 px-4 py-2.5 text-xs text-right text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/40 transition-all leading-relaxed"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Phase type ─────────────────────────────────────────────────────────────────

type WorkspacePhase =
  | { kind: "idle" }
  | { kind: "streaming";      taskId: string; userMessage: string }
  | { kind: "done_blueprint"; taskId: string; userMessage: string; elapsedMs?: number }
  | { kind: "executing";      taskId: string; userMessage: string; currentStageName?: string }
  | { kind: "verifying";      taskId: string; userMessage: string; currentStageName?: string }
  | { kind: "verified";       taskId: string; userMessage: string; allPassed: boolean; checks: VerificationCheck[]; healthReport?: HealthReport; previewUrl?: string; productionGate?: ProductionGate }
  | { kind: "done_conversation"; content: string; userMessage: string; model?: string; elapsedMs?: number }
  | { kind: "error"; message: string; userMessage: string; retryable?: boolean; taskId?: string; blueprint?: string };

// ── Main PlannerWorkspace ──────────────────────────────────────────────────────

interface PlannerWorkspaceProps {
  conversationId: string;
  messages: AIMessage[];
  isFirstMessage: boolean;
  onSuccess: (conversationId: string) => void;
  initialRepoId?: string;
  autoStartMessage?: string;
  isWaitingForRepo?: boolean;
}

export function PlannerWorkspace({
  conversationId,
  messages,
  isFirstMessage,
  onSuccess,
  initialRepoId,
  autoStartMessage,
  isWaitingForRepo,
}: PlannerWorkspaceProps) {
  const queryClient = useQueryClient();

  // ── Input state ─────────────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<WorkspacePhase>({ kind: "idle" });
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Streaming content ────────────────────────────────────────────────────────
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingStage, setStreamingStage] = useState<{ name: string; id: number } | null>(null);

  // ── Thinking / reasoning state (kept for logic, not displayed) ───────────────
  const [thinkingText, setThinkingText] = useState("");
  const [thinkingModel, setThinkingModel] = useState("");
  const [thinkingStreaming, setThinkingStreaming] = useState(false);

  // ── Model switch (kept for logic, not displayed) ─────────────────────────────
  const [activeModelSwitch, setActiveModelSwitch] = useState<{ toModel: string; taskType: string } | null>(null);

  // ── Repository selector ─────────────────────────────────────────────────────
  const [selectedRepoId, setSelectedRepoId] = useState<string>(initialRepoId ?? "");

  // ── Preview panel ────────────────────────────────────────────────────────────
  const [showPreview, setShowPreview] = useState(false);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  // ── Execution logs (internal only, not displayed) ────────────────────────────
  const [execLogs, setExecLogs] = useState<LogEntry[]>([]);
  const [execActive, setExecActive] = useState(false);
  const [execCurrentStage, setExecCurrentStage] = useState<string | undefined>();

  // ── Timing ──────────────────────────────────────────────────────────────────
  const plannerStartRef = useRef<number>(0);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const execAbortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);
  const wasFirstRef = useRef(isFirstMessage);
  const priorMessageCountRef = useRef(messages.length);
  const blueprintRef = useRef<string>("");

  const renameMutation = useRenameConversation();

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

  // ── Document title ───────────────────────────────────────────────────────────

  useEffect(() => {
    const base = "AI Agent";
    document.title = isStreaming ? `يعمل… — ${base}` : base;
    return () => { document.title = base; };
  }, [isStreaming]);

  // ── Track previewUrl ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase.kind === "verified" && phase.previewUrl) {
      setActivePreviewUrl(phase.previewUrl);
      setShowPreview(true);
    }
  }, [phase]);

  // ── Auto-scroll ─────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback((smooth = true) => {
    if (!userScrolledRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "instant" });
    }
  }, []);

  useEffect(() => {
    if (phase.kind !== "idle") scrollToBottom();
  }, [phase, scrollToBottom]);

  useEffect(() => {
    if (streamingContent) scrollToBottom();
  }, [streamingContent, scrollToBottom]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledRef.current = !atBottom;
  };

  // ── Textarea auto-resize ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // ── Log helper (internal) ────────────────────────────────────────────────────

  const addLog = useCallback((level: LogEntry["level"], message: string) => {
    setExecLogs((prev) => [...prev, makeLog(level, message)]);
  }, []);

  // ── Execution pipeline ───────────────────────────────────────────────────────

  const runExecution = useCallback(async (taskId: string, blueprint: string, convId: string) => {
    execAbortRef.current?.abort();
    const controller = new AbortController();
    execAbortRef.current = controller;

    startExecution(taskId, DEFAULT_EXEC_PHASES.map((p) => ({ ...p })));
    setExecActive(true);
    setExecLogs([]);
    addLog("stage", "Execution pipeline started");

    setPhase((prev) =>
      prev.kind === "done_blueprint"
        ? { kind: "executing", taskId: prev.taskId, userMessage: (prev as { userMessage: string }).userMessage }
        : prev
    );

    const handleExecEvent = (event: ExecutionStreamEvent) => {
      switch (event.type) {
        case "exec_stage_start":
          execPhaseStart(taskId, event.stage);
          setExecCurrentStage(event.stageName);
          addLog("stage", `Stage ${event.stage}: ${event.stageName}`);
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
          addLog("success", `Stage ${event.stage} completed in ${(event.duration / 1000).toFixed(1)}s`);
          break;

        case "exec_stage_fail":
          execPhaseFail(taskId, event.stage, event.error ?? "Stage failed");
          addLog("error", `Stage ${event.stage} failed: ${event.error ?? "unknown"}`);
          break;

        case "verify_check": {
          const statusMap: Record<string, VerificationCheck["status"]> = {
            checking: "checking", pass: "pass", fail: "fail", skip: "skip", fixing: "fixing", fixed: "fixed",
          };
          const st = statusMap[event.status ?? "checking"] ?? "checking";
          setVerifyCheck(taskId, {
            id: event.check ?? "",
            name: event.checkName ?? "",
            domain: event.checkDomain,
            status: st,
            detail: event.detail,
          });
          if (event.status === "pass") addLog("success", `✓ ${event.checkName}`);
          else if (event.status === "fail") addLog("error", `✕ ${event.checkName}: ${event.detail ?? ""}`);
          else if (event.status === "checking") addLog("info", `Checking ${event.checkName}…`);
          setPhase((prev) =>
            prev.kind === "executing"
              ? { ...prev, kind: "verifying" } as WorkspacePhase
              : prev
          );
          break;
        }

        case "fix_attempt":
          setVerifyFixing(taskId, event.check ?? "", event.strategy ?? "");
          addLog("warn", `Fixing ${event.check}: ${event.strategy}`);
          break;

        case "fix_result":
          setVerifyCheck(taskId, {
            id: event.check ?? "",
            name: "",
            status: event.status === "fixed" ? "fixed" : event.status === "fixing" ? "fixing" : "fail",
            detail: event.strategy,
          });
          if (event.status === "fixed") addLog("success", `Fixed: ${event.check}`);
          break;

        case "health_report":
          if (event.healthReport) setHealthReport(taskId, event.healthReport);
          addLog("info", `Health report: ${event.healthReport?.overallScore ?? 0}% overall`);
          break;

        case "production_gate":
          break;

        case "exec_done": {
          const checks: VerificationCheck[] = (event.checks ?? []).map((c) => ({
            id: c.id, name: c.name, domain: c.domain,
            status: c.status === "pass" ? "pass" : c.status === "skip" ? "skip" : "fail",
            detail: c.detail, duration: c.duration,
          }));
          const healthReport = event.healthReport ?? undefined;
          const previewUrl = event.previewUrl;
          const productionGate = event.productionGate;

          setVerified(taskId, { phases: DEFAULT_EXEC_PHASES.map((p) => ({ ...p, status: "complete" })), checks, healthReport, allPassed: event.allPassed ?? false, completedAt: new Date().toISOString() }, previewUrl, productionGate);
          setExecActive(false);
          setExecCurrentStage(undefined);
          addLog("success", event.allPassed ? "All checks passed!" : `Done with ${checks.filter((c) => c.status === "fail").length} issue(s)`);

          setPhase((prev) => {
            const userMessage = (prev as { userMessage?: string }).userMessage ?? "";
            return { kind: "verified", taskId, userMessage, allPassed: event.allPassed ?? false, checks, healthReport, previewUrl, productionGate };
          });
          break;
        }

        case "exec_error":
          setExecError(taskId, event.message ?? "Execution error");
          setExecActive(false);
          setExecCurrentStage(undefined);
          addLog("error", event.message ?? "Execution failed");
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
      setExecActive(false);
      addLog("error", `Execution error: ${msg}`);
      setPhase((prev) => ({
        kind: "error",
        message: msg,
        userMessage: (prev as { userMessage?: string }).userMessage ?? "",
        retryable: true,
        taskId,
        blueprint: blueprintRef.current,
      }));
    }
  }, [startExecution, execPhaseStart, execPhaseComplete, execPhaseFail, setVerifyCheck, setVerifyFixing, setVerified, setHealthReport, setExecError, addLog]);

  // ── Retry handlers ───────────────────────────────────────────────────────────

  const handleRetryExecution = useCallback((taskId: string, blueprint: string) => {
    retryExecution(taskId);
    setPhase((prev) => ({ kind: "executing", taskId, userMessage: (prev as { userMessage?: string }).userMessage ?? "" }));
    void runExecution(taskId, blueprint, conversationId);
  }, [retryExecution, runExecution, conversationId]);

  const handleRetryVerification = useCallback((taskId: string, blueprint: string) => {
    retryExecution(taskId);
    setPhase((prev) => ({ kind: "verifying", taskId, userMessage: (prev as { userMessage?: string }).userMessage ?? "" }));
    void runExecution(taskId, blueprint, conversationId);
  }, [retryExecution, runExecution, conversationId]);

  // ── Stop generation ──────────────────────────────────────────────────────────

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    execAbortRef.current?.abort();
    setIsStreaming(false);
    setExecActive(false);
    setStreamingContent("");
    setStreamingStage(null);
    setThinkingText("");
    setThinkingModel("");
    setThinkingStreaming(false);
    setActiveModelSwitch(null);
    setPhase({ kind: "idle" });
    toast.info("توقف التوليد");
  }, []);

  // ── Planning pipeline ────────────────────────────────────────────────────────

  const handleSend = useCallback(async (overrideContent?: string) => {
    const content = overrideContent !== undefined ? overrideContent : input.trim();
    if (!content || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingStage(null);
    setThinkingText("");
    setThinkingModel("");
    setThinkingStreaming(false);
    setActiveModelSwitch(null);
    userScrolledRef.current = false;
    wasFirstRef.current = isFirstMessage;
    priorMessageCountRef.current = messages.length;
    plannerStartRef.current = Date.now();

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
        case "thinking_start":
          setThinkingModel(event.model);
          setThinkingStreaming(true);
          break;

        case "thinking_chunk":
          setThinkingText((prev) => prev + event.text);
          break;

        case "thinking_complete":
          setThinkingStreaming(false);
          break;

        case "model_switch":
          setActiveModelSwitch({ toModel: event.toModel, taskType: event.taskType });
          break;

        case "stage_start": {
          stageStart(taskId, event.stage);
          const stageMeta = PLANNER_STAGES.find((s) => s.id === event.stage);
          if (stageMeta) setStreamingStage({ name: stageMeta.name, id: event.stage });
          break;
        }
        case "stage_complete":
          stageComplete(taskId, event.stage);
          break;

        case "content_chunk":
          setStreamingContent((prev) => prev + event.text);
          break;

        case "section_detected":
          break;

        case "done": {
          capturedBlueprint = event.content;
          blueprintRef.current = event.content;
          const elapsedMs = Date.now() - plannerStartRef.current;
          completeTask(taskId, event.content, event.model);
          setStreamingContent("");
          setStreamingStage(null);
          setPhase({ kind: "done_blueprint", taskId, userMessage: content, elapsedMs });
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

          void runExecution(taskId, capturedBlueprint, conversationId);
          break;
        }

        case "conversation": {
          const elapsedMs = Date.now() - plannerStartRef.current;
          setStreamingContent("");
          setStreamingStage(null);
          setPhase({ kind: "done_conversation", content: event.content, userMessage: content, elapsedMs });
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
        }

        case "error":
          failTask(taskId, event.message);
          setStreamingContent("");
          setStreamingStage(null);
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
      setStreamingContent("");
      setStreamingStage(null);
      setPhase({ kind: "error", message: msg, userMessage: content });
      toast.error(msg);
    } finally {
      if (!controller.signal.aborted) setIsStreaming(false);
    }
  }, [input, isStreaming, conversationId, isFirstMessage, queryClient, renameMutation, onSuccess,
    createTask, stageStart, stageComplete, completeTask, failTask, selectedRepoId, runExecution]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  // ── Auto-start after repo import ──────────────────────────────────────────────
  const handleSendRef = useRef(handleSend);
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  const autoStartSentRef = useRef(false);
  useEffect(() => {
    if (!autoStartMessage || autoStartSentRef.current) return;
    autoStartSentRef.current = true;
    const timer = setTimeout(() => {
      if (!isStreaming && messages.length === 0) {
        void handleSendRef.current(autoStartMessage);
      }
    }, 600);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartMessage]);

  // ── Render history messages ──────────────────────────────────────────────────

  const renderHistory = () => {
    const limit = phase.kind === "idle" ? messages.length : priorMessageCountRef.current;
    const visible = messages.slice(0, limit);
    if (visible.length === 0) return null;

    return visible.map((msg, idx) => {
      if (msg.role === "user") {
        const isLastUser = visible.slice(idx + 1).every((m) => m.role !== "user");
        return (
          <UserBubble
            key={msg.id}
            content={msg.content}
            timestamp={msg.created_at}
            onEdit={isLastUser && phase.kind === "idle" ? (newContent) => void handleSend(newContent) : undefined}
          />
        );
      }
      if (msg.role === "assistant") {
        const metadata = msg.metadata as { module?: string; model?: string } | null;
        const model = metadata?.model;
        // Blueprint or conversation — both rendered as clean markdown
        return (
          <ConversationBubble
            key={msg.id}
            content={msg.content}
            timestamp={msg.created_at}
            model={model}
          />
        );
      }
      return null;
    });
  };

  // ── Render current phase ─────────────────────────────────────────────────────

  const renderPhase = () => {
    switch (phase.kind) {
      case "streaming": {
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {streamingContent ? (
              <AssistantBubble>
                <MarkdownRenderer content={streamingContent} />
                {/* Cursor blink */}
                <span className="inline-block w-0.5 h-4 bg-foreground/40 ml-0.5 animate-pulse align-text-bottom" />
              </AssistantBubble>
            ) : (
              <TypingBubble />
            )}
          </>
        );
      }

      case "done_blueprint": {
        // Blueprint is done; execution pipeline is launching
        const task = tasks.find((t) => t.id === phase.taskId);
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result ? (
              <>
                <ConversationBubble
                  content={task.result.content}
                  model={task.result.model}
                  elapsedMs={phase.elapsedMs}
                />
                <TypingBubble />
              </>
            ) : (
              <TypingBubble />
            )}
          </>
        );
      }

      case "executing":
      case "verifying": {
        const task = tasks.find((t) => t.id === phase.taskId);
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result && (
              <ConversationBubble
                content={task.result.content}
                model={task.result.model}
              />
            )}
            <TypingBubble />
          </>
        );
      }

      case "verified": {
        const task = tasks.find((t) => t.id === phase.taskId);
        const blueprint = blueprintRef.current || task?.result?.content || "";
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result && (
              <ConversationBubble
                content={task.result.content}
                model={task.result.model}
              />
            )}
            {/* Show preview link if available */}
            {phase.previewUrl && (
              <AssistantBubble>
                <p className="text-sm text-muted-foreground/80 leading-relaxed">
                  المشروع جاهز.{" "}
                  <a
                    href={phase.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
                  >
                    افتح المعاينة ↗
                  </a>
                </p>
              </AssistantBubble>
            )}
            {/* Retry on failure */}
            {!phase.allPassed && (
              <ErrorBubble
                message="اكتملت العملية مع بعض التنبيهات."
                retryable
                onRetryBuild={() => handleRetryExecution(phase.taskId, blueprint)}
                onRetryVerification={() => handleRetryVerification(phase.taskId, blueprint)}
              />
            )}
          </>
        );
      }

      case "done_conversation":
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <ConversationBubble
              content={phase.content}
              model={phase.model}
              elapsedMs={phase.elapsedMs}
            />
          </>
        );

      case "error":
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <ErrorBubble
              message={phase.message}
              retryable={phase.retryable}
              onRetryBuild={phase.taskId ? () => handleRetryExecution(phase.taskId!, phase.blueprint || blueprintRef.current) : undefined}
              onRetryVerification={phase.taskId ? () => handleRetryVerification(phase.taskId!, phase.blueprint || blueprintRef.current) : undefined}
            />
          </>
        );

      case "idle":
      default:
        return null;
    }
  };

  // ── Regenerate button (idle + has history) ───────────────────────────────────

  const regenerateButton = useMemo(() => {
    if (phase.kind !== "idle") return null;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return null;
    return (
      <div className="flex justify-center pt-1">
        <button
          onClick={() => void handleSend(lastUser.content)}
          disabled={isStreaming}
          className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted transition-all disabled:opacity-40"
        >
          <RefreshIcon />
          إعادة التوليد
        </button>
      </div>
    );
  }, [phase.kind, messages, isStreaming, handleSend]);

  const isBusy = isStreaming || phase.kind === "executing" || phase.kind === "verifying" || phase.kind === "done_blueprint";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 overflow-hidden">

      {/* ── Chat column ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* ── Messages ──────────────────────────────────────────────────────── */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-6">
            {renderHistory()}
            {renderPhase()}
            {regenerateButton}
            {messages.length === 0 && phase.kind === "idle" && (
              isWaitingForRepo ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                    <svg className="text-primary animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  </div>
                  <div className="max-w-sm">
                    <h2 className="text-base font-semibold text-foreground mb-1.5">جاري تحليل المستودع…</h2>
                    <p className="text-sm text-muted-foreground/70 leading-relaxed">
                      يتم استنساخ المشروع وفهم بنيته. قد يستغرق ذلك 30–60 ثانية.
                    </p>
                  </div>
                </div>
              ) : (
                <EmptyState onPrompt={(p) => { setInput(p); textareaRef.current?.focus(); }} />
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* ── Input area ──────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 px-4 pt-3 pb-4 border-t border-border/30 bg-background/50 backdrop-blur-sm"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}
        >
          <div className="mx-auto max-w-2xl">
            {/* Repository selector */}
            {repositories.length > 0 && (
              <div className="mb-2 flex items-center gap-2">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted-foreground flex-shrink-0">
                  <rect x="1" y="1" width="9" height="9" rx="1" />
                  <path d="M3.5 1v9M7.5 1v9M1 4h9M1 7.5h9" />
                </svg>
                <select
                  value={selectedRepoId}
                  onChange={(e) => setSelectedRepoId(e.target.value)}
                  disabled={isBusy}
                  className="flex-1 rounded-lg border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">بدون سياق مستودع</option>
                  {repositories.map((r) => (
                    <option key={r.id} value={r.id}>{r.full_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Input box */}
            <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-card/80 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all duration-150">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isBusy ? "يعمل المساعد…" : "اكتب رسالتك…"}
                className="min-h-[48px] max-h-[180px] flex-1 resize-none border-0 bg-transparent px-4 py-3.5 pr-2 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40 leading-relaxed"
                rows={1}
                disabled={isBusy}
                dir="auto"
              />

              <div className="mb-2.5 mr-2.5 flex flex-shrink-0 items-center gap-1.5">
                {isBusy && (
                  <button
                    onClick={handleStop}
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground hover:text-foreground hover:border-destructive/40 hover:bg-destructive/10 transition-colors"
                    aria-label="إيقاف التوليد"
                    title="إيقاف"
                  >
                    <StopIcon />
                  </button>
                )}

                <button
                  onClick={() => void handleSend()}
                  disabled={!input.trim() || isBusy}
                  className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  aria-label="إرسال"
                >
                  {isBusy ? (
                    <AIPulse size={13} color="white" active />
                  ) : (
                    <SendIcon />
                  )}
                </button>
              </div>
            </div>

            {/* Hint line */}
            <div className="mt-1.5 flex items-center justify-between px-0.5">
              <p className="text-[10px] text-muted-foreground/25 hidden sm:block">
                Enter للإرسال · Shift+Enter لسطر جديد
              </p>
              {activePreviewUrl && (
                <button
                  onClick={() => setShowPreview((p) => !p)}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] transition-colors ml-auto ${showPreview ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/40"}`}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1" y="1.5" width="8" height="7" rx="1" />
                    <line x1="1" y1="3.5" x2="9" y2="3.5" />
                  </svg>
                  معاينة
                </button>
              )}
            </div>
          </div>
        </div>

      </div>{/* end chat column */}

      {/* ── Right: Inline preview panel ───────────────────────────────────────── */}
      {showPreview && activePreviewUrl && (
        <div className="flex-shrink-0 w-[420px] border-l border-border/50 bg-card/20 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 border-b border-border/40 px-3 py-2.5 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">معاينة</span>
            <a
              href={activePreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[10px] text-primary/60 hover:text-primary transition-colors"
            >
              فتح ↗
            </a>
            <button
              onClick={() => setShowPreview(false)}
              className="text-muted-foreground/40 hover:text-foreground transition-colors"
              aria-label="إغلاق المعاينة"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-hidden bg-white">
            <iframe
              src={activePreviewUrl}
              className="w-full h-full border-0"
              title="معاينة المشروع"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}
    </div>
  );
}
