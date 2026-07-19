/**
 * PlannerWorkspace — واجهة المحادثة الاحترافية
 *
 * • فقاعات بسيطة (مستخدم يمين / مساعد يسار)
 * • Markdown كامل مع code blocks + copy
 * • مؤشر typing ثلاثي النقاط أثناء المعالجة
 * • لا يُعرض أي معلومات تقنية داخلية للمستخدم
 * • جميع منطق الـ AI/API/Streaming محفوظ دون تغيير
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
import { MarkdownRenderer } from "./chat/MarkdownRenderer";
import { StreamingRenderer } from "./chat/StreamingRenderer";
import type { LogEntry } from "./chat/LiveLogPanel";

// ── Helpers ────────────────────────────────────────────────────────────────────

function autoTitle(content: string) {
  return content.slice(0, 60).trim() || "محادثة جديدة";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
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
      <rect x="2.5" y="2.5" width="8" height="8" rx="1.5" fill="currentColor" opacity="0.18" />
      <rect x="2.5" y="2.5" width="8" height="8" rx="1.5" />
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

function AssistantAvatar() {
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/12 border border-primary/20 mt-0.5">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-primary">
        <path d="M8 2L9.8 6.2L14 8L9.8 9.8L8 14L6.2 9.8L2 8L6.2 6.2L8 2Z" fill="currentColor" opacity="0.9" />
      </svg>
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
      <div className="max-w-[80%] sm:max-w-[70%]">
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
              dir="auto"
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
            <div className="relative group/bubble rounded-[18px] rounded-tr-[6px] bg-zinc-800 border border-zinc-700/50 px-4 py-3 text-[0.875rem] text-zinc-100 leading-[1.75] shadow-sm">
              <p className="whitespace-pre-wrap" dir="auto">{content}</p>
              {onEdit && (
                <button
                  onClick={() => { setEditValue(content); setEditing(true); }}
                  className="absolute -left-7 top-2 rounded p-1 opacity-0 group-hover/bubble:opacity-40 hover:!opacity-90 transition-opacity text-muted-foreground hover:text-foreground"
                  aria-label="تعديل الرسالة"
                >
                  <EditIcon />
                </button>
              )}
            </div>
            {timestamp && (
              <p className="mt-1.5 text-right text-[10px] text-muted-foreground/25 pr-1">
                {formatTime(timestamp)}
              </p>
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
  onCopy,
}: {
  children: React.ReactNode;
  timestamp?: string;
  onCopy?: () => void;
}) {
  return (
    <div className="flex gap-3 items-start group">
      <AssistantAvatar />
      <div className="flex-1 min-w-0 relative pt-0.5">
        {/* Copy whole message */}
        {onCopy && (
          <button
            onClick={onCopy}
            className="absolute -right-1 top-0 rounded p-1 opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity text-muted-foreground hover:text-foreground"
            aria-label="نسخ الرسالة"
          >
            <CopyIconSm />
          </button>
        )}
        <div className="text-[0.875rem] text-foreground leading-[1.75] pr-5">
          {children}
        </div>
        {timestamp && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/25">
            {formatTime(timestamp)}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Typing / Thinking indicator ────────────────────────────────────────────────

function TypingBubble({ stageName }: { stageName?: string }) {
  return (
    <div className="flex gap-3 items-start">
      <AssistantAvatar />
      <div className="flex items-center gap-[5px] pt-[10px]">
        {stageName ? (
          <>
            <span className="h-[6px] w-[6px] rounded-full bg-primary/50 animate-pulse flex-shrink-0" />
            <span className="text-[0.78rem] text-muted-foreground/45 animate-pulse select-none">
              {stageName}…
            </span>
          </>
        ) : (
          [0, 200, 400].map((delay) => (
            <span
              key={delay}
              className="h-[7px] w-[7px] rounded-full bg-foreground/20 animate-bounce"
              style={{ animationDelay: `${delay}ms`, animationDuration: "1.3s" }}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Conversation bubble (assistant reply with Markdown) ────────────────────────

function ConversationBubble({
  content,
  timestamp,
}: {
  content: string;
  timestamp?: string;
}) {
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => toast.success("تم النسخ"));
  };
  return (
    <AssistantBubble timestamp={timestamp} onCopy={handleCopy}>
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
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-500/15 border border-red-500/20">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="text-red-400">
              <line x1="4.5" y1="1" x2="4.5" y2="5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <circle cx="4.5" cy="7.5" r="0.7" fill="currentColor" />
            </svg>
          </div>
          <p className="text-[0.875rem] text-red-400/90 leading-relaxed">{message}</p>
        </div>
        {retryable && (onRetryBuild || onRetryVerification) && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/20 mt-1">
            {onRetryBuild && (
              <button
                onClick={onRetryBuild}
                className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
              >
                <RefreshIcon />
                إعادة المحاولة
              </button>
            )}
            {onRetryVerification && !onRetryBuild && (
              <button
                onClick={onRetryVerification}
                className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
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
    <div className="flex flex-col items-center justify-center gap-7 py-16 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" className="text-primary">
          <path d="M8 1.5L10 6L14.5 8L10 10L8 14.5L6 10L1.5 8L6 6L8 1.5Z" fill="currentColor" opacity="0.85" />
        </svg>
      </div>
      <div className="max-w-xs">
        <h2 className="text-base font-semibold text-foreground mb-2">ماذا تريد أن تبني؟</h2>
        <p className="text-[0.8rem] text-muted-foreground/60 leading-relaxed">
          صف فكرتك البرمجية وسيقوم المساعد بتحليلها وبناء خطة معمارية شاملة.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPrompt(p)}
            className="rounded-xl border border-border/50 bg-muted/15 px-4 py-2.5 text-[0.8rem] text-right text-muted-foreground/70 hover:text-foreground hover:border-primary/30 hover:bg-muted/30 transition-all leading-relaxed"
            dir="rtl"
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

  // ── Token batching — buffer tokens and flush every animation frame ───────────
  // Prevents 100s of setState/sec; merges all tokens arriving within one frame
  const pendingTokensRef = useRef<string>("");
  const flushRafRef = useRef<number | null>(null);

  // ── Back-to-latest scroll button ─────────────────────────────────────────────
  const [showScrollBtn, setShowScrollBtn] = useState(false);

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
    // Show "back to latest" button only when streaming and user has scrolled up
    setShowScrollBtn(!atBottom && (isStreaming || phase.kind === "executing" || phase.kind === "verifying"));
  };

  // ── Textarea auto-resize ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
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

          setVerified(taskId, {
            phases: DEFAULT_EXEC_PHASES.map((p) => ({ ...p, status: "complete" })),
            checks,
            healthReport,
            allPassed: event.allPassed ?? false,
            completedAt: new Date().toISOString(),
          }, previewUrl, productionGate);
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
    // Cancel any pending token flush
    if (flushRafRef.current !== null) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = null;
    }
    pendingTokensRef.current = "";
    setIsStreaming(false);
    setExecActive(false);
    setStreamingContent("");
    setStreamingStage(null);
    setThinkingText("");
    setThinkingModel("");
    setThinkingStreaming(false);
    setActiveModelSwitch(null);
    setShowScrollBtn(false);
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
          // Buffer token and flush on next animation frame — batches all tokens
          // arriving within one frame (~16ms) into a single setState call
          pendingTokensRef.current += event.text;
          if (flushRafRef.current === null) {
            flushRafRef.current = requestAnimationFrame(() => {
              flushRafRef.current = null;
              const text = pendingTokensRef.current;
              if (!text) return;
              pendingTokensRef.current = "";
              setStreamingContent((prev) => prev + text);
            });
          }
          break;

        case "section_detected":
          break;

        case "done": {
          capturedBlueprint = event.content;
          blueprintRef.current = event.content;
          const elapsedMs = Date.now() - plannerStartRef.current;
          completeTask(taskId, event.content, event.model);
          // Discard pending token buffer — final content comes from event.content
          if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null; }
          pendingTokensRef.current = "";
          setStreamingContent("");
          setStreamingStage(null);
          setShowScrollBtn(false);
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
          if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null; }
          pendingTokensRef.current = "";
          setStreamingContent("");
          setStreamingStage(null);
          setShowScrollBtn(false);
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
        }

        case "error":
          failTask(taskId, event.message);
          if (flushRafRef.current !== null) { cancelAnimationFrame(flushRafRef.current); flushRafRef.current = null; }
          pendingTokensRef.current = "";
          setStreamingContent("");
          setStreamingStage(null);
          setShowScrollBtn(false);
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

  // ── Auto-start after repo import ─────────────────────────────────────────────
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

  // ── Render history messages ───────────────────────────────────────────────────

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
        return (
          <ConversationBubble
            key={msg.id}
            content={msg.content}
            timestamp={msg.created_at}
          />
        );
      }
      return null;
    });
  };

  // ── Render current phase ──────────────────────────────────────────────────────

  const renderPhase = () => {
    switch (phase.kind) {
      case "streaming": {
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {streamingContent ? (
              <AssistantBubble>
                <StreamingRenderer
                  content={streamingContent}
                  isStreaming
                  className="streaming-bubble-enter"
                />
              </AssistantBubble>
            ) : (
              <TypingBubble stageName={streamingStage?.name} />
            )}
          </>
        );
      }

      case "done_blueprint": {
        const task = tasks.find((t) => t.id === phase.taskId);
        return (
          <>
            <UserBubble content={phase.userMessage} />
            {task?.result ? (
              <>
                <ConversationBubble content={task.result.content} />
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
              <ConversationBubble content={task.result.content} />
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
              <ConversationBubble content={task.result.content} />
            )}
            {/* Preview link — shown only when available */}
            {phase.previewUrl && (
              <AssistantBubble>
                <p className="text-[0.875rem] text-muted-foreground/80 leading-relaxed">
                  المشروع جاهز.{" "}
                  <a
                    href={phase.previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:text-primary/75 underline underline-offset-[3px] transition-colors"
                  >
                    افتح المعاينة ↗
                  </a>
                </p>
              </AssistantBubble>
            )}
            {/* Error on partial failure */}
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
            <ConversationBubble content={phase.content} />
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

  // ── Regenerate button (idle + has history) ────────────────────────────────────

  const regenerateButton = useMemo(() => {
    if (phase.kind !== "idle") return null;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return null;
    return (
      <div className="flex justify-center pt-2">
        <button
          onClick={() => void handleSend(lastUser.content)}
          disabled={isStreaming}
          className="flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 px-3.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/20 transition-all disabled:opacity-40"
        >
          <RefreshIcon />
          إعادة التوليد
        </button>
      </div>
    );
  }, [phase.kind, messages, isStreaming, handleSend]);

  const isBusy = isStreaming || phase.kind === "executing" || phase.kind === "verifying" || phase.kind === "done_blueprint";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-w-0 overflow-hidden">

      {/* ── Chat column ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* ── Messages area ────────────────────────────────────────────────── */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto scroll-smooth"
          >
          <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-7">
            {renderHistory()}
            {renderPhase()}
            {regenerateButton}

            {/* Empty state / waiting for repo */}
            {messages.length === 0 && phase.kind === "idle" && (
              isWaitingForRepo ? (
                <div className="flex flex-col items-center justify-center gap-5 py-16 px-4 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20">
                    <svg className="text-primary animate-spin" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  </div>
                  <div className="max-w-xs">
                    <h2 className="text-base font-semibold text-foreground mb-2">جاري تحليل المستودع…</h2>
                    <p className="text-[0.8rem] text-muted-foreground/60 leading-relaxed">
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
          </div>{/* end scrollable */}

          {/* ── Back-to-latest button ─────────────────────────────────────── */}
          {showScrollBtn && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
              <button
                className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 backdrop-blur-sm px-3.5 py-1.5 text-[11px] text-muted-foreground hover:text-foreground shadow-lg transition-all hover:border-primary/30 hover:bg-muted/30"
                onClick={() => {
                  userScrolledRef.current = false;
                  setShowScrollBtn(false);
                  messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1.5 3.5L5 7L8.5 3.5" />
                </svg>
                آخر رسالة
              </button>
            </div>
          )}
        </div>{/* end messages wrapper */}

        {/* ── Input area ───────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 px-4 pt-3 pb-4 border-t border-border/25 bg-background/60 backdrop-blur-sm"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}
        >
          <div className="mx-auto max-w-2xl">

            {/* Repository selector */}
            {repositories.length > 0 && (
              <div className="mb-2.5 flex items-center gap-2">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted-foreground/50 flex-shrink-0">
                  <rect x="1" y="1" width="9" height="9" rx="1" />
                  <path d="M3.5 1v9M7.5 1v9M1 4h9M1 7.5h9" />
                </svg>
                <select
                  value={selectedRepoId}
                  onChange={(e) => setSelectedRepoId(e.target.value)}
                  disabled={isBusy}
                  className="flex-1 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50 transition-colors"
                >
                  <option value="">بدون سياق مستودع</option>
                  {repositories.map((r) => (
                    <option key={r.id} value={r.id}>{r.full_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Input box */}
            <div className="relative flex items-end gap-2 rounded-2xl border border-border/60 bg-card/80 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10 transition-all duration-150">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isBusy ? "يعمل المساعد…" : "اكتب رسالتك…"}
                className="min-h-[50px] max-h-[200px] flex-1 resize-none border-0 bg-transparent px-4 py-3.5 text-[0.875rem] shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/35 leading-relaxed"
                rows={1}
                disabled={isBusy}
                dir="auto"
              />

              <div className="mb-2.5 mr-2.5 flex flex-shrink-0 items-center gap-1.5">
                {isBusy && (
                  <button
                    onClick={handleStop}
                    className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 bg-muted/50 text-muted-foreground hover:text-foreground hover:border-destructive/40 hover:bg-destructive/10 transition-colors"
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

            {/* Bottom hint + preview toggle */}
            <div className="mt-1.5 flex items-center justify-between px-0.5">
              <p className="text-[10px] text-muted-foreground/20 hidden sm:block select-none">
                Enter للإرسال · Shift+Enter لسطر جديد
              </p>
              {activePreviewUrl && (
                <button
                  onClick={() => setShowPreview((p) => !p)}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] transition-colors ml-auto ${
                    showPreview
                      ? "text-primary bg-primary/10 border border-primary/20"
                      : "text-muted-foreground/40 hover:text-foreground hover:bg-muted/30"
                  }`}
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

      {/* ── Preview panel (right side) ────────────────────────────────────────── */}
      {showPreview && activePreviewUrl && (
        <div className="flex-shrink-0 w-[420px] border-l border-border/40 bg-card/20 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 border-b border-border/30 px-3.5 py-2.5 flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">معاينة</span>
            <a
              href={activePreviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-[10px] text-primary/50 hover:text-primary transition-colors"
            >
              فتح ↗
            </a>
            <button
              onClick={() => setShowPreview(false)}
              className="text-muted-foreground/30 hover:text-foreground transition-colors"
              aria-label="إغلاق المعاينة"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1" x2="9" y2="9" />
                <line x1="9" y1="1" x2="1" y2="9" />
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
