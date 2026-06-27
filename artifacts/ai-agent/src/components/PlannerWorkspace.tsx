/**
 * PlannerWorkspace — Premium Chat Interface
 *
 * Features:
 *  • Live streaming tokens with markdown rendering
 *  • Stop generation button
 *  • Message footer (model · elapsed · tokens)
 *  • Edit previous prompt
 *  • Live execution log panel
 *  • Generated files panel with download ZIP
 *  • Syntax-highlighted code blocks with copy
 *  • Auto-scroll with scroll-lock detection
 *  • Animated stage progress inline in chat
 *  • Full verification card
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
import { MarkdownRenderer } from "./chat/MarkdownRenderer";
import { LiveLogPanel } from "./chat/LiveLogPanel";
import type { LogEntry } from "./chat/LiveLogPanel";
import { GeneratedFilesPanel } from "./chat/GeneratedFilesPanel";

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

function FilesIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.5 2a1 1 0 011-1h4.5l2 2H11.5a1 1 0 011 1v7a1 1 0 01-1 1H2.5a1 1 0 01-1-1V2z" />
    </svg>
  );
}

// ── Message footer (model badge + timing) ──────────────────────────────────────

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

  if (timestamp) {
    parts.push(<span key="ts">{formatTime(timestamp)}</span>);
  }
  if (model) {
    const shortModel = model.split("/").pop() ?? model;
    parts.push(
      <span key="model" className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
        {shortModel}
      </span>
    );
  }
  if (elapsedMs != null) {
    parts.push(<span key="elapsed">{formatElapsed(elapsedMs)}</span>);
  }

  if (parts.length === 0) return null;

  return (
    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/40 flex-wrap">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="opacity-40">·</span>}
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
      <div className="max-w-[78%] sm:max-w-[68%]">
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
              className="w-full resize-none rounded-2xl rounded-tr-md border border-primary/40 bg-primary/5 px-4 py-2.5 text-sm text-foreground leading-relaxed focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[60px]"
              rows={3}
            />
            <div className="flex gap-1.5 justify-end">
              <button
                onClick={() => { setEditing(false); setEditValue(content); }}
                className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitEdit}
                className="rounded-lg bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative rounded-2xl rounded-tr-md bg-primary px-4 py-2.5 text-sm text-primary-foreground leading-relaxed shadow-sm">
              <p className="whitespace-pre-wrap pr-5">{content}</p>
              {onEdit && (
                <button
                  onClick={() => { setEditValue(content); setEditing(true); }}
                  className="absolute right-2 top-2 rounded p-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-primary-foreground/70 hover:text-primary-foreground"
                  aria-label="Edit message"
                >
                  <EditIcon />
                </button>
              )}
            </div>
            {timestamp && (
              <p className="mt-0.5 text-right text-[10px] text-muted-foreground/40">{formatTime(timestamp)}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Assistant bubble wrapper ───────────────────────────────────────────────────

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
    <div className="flex gap-2.5 items-start group">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border mt-0.5">
        <AIPulse size={15} color="#6366f1" active />
      </div>
      <div className="flex-1 min-w-0">
        <div className="rounded-2xl rounded-tl-md bg-card border border-border px-4 py-3 text-sm text-foreground leading-relaxed shadow-sm relative">
          {onCopy && (
            <button
              onClick={onCopy}
              className="absolute right-2 top-2 rounded p-1 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
              aria-label="Copy message"
            >
              <CopyIconSm />
            </button>
          )}
          {children}
        </div>
        <MessageFooter model={model} elapsedMs={elapsedMs} timestamp={timestamp} />
      </div>
    </div>
  );
}

// ── Activity indicator — single pulsing line showing latest status ─────────────

function ActivityBubble({
  label,
  sublabel,
  color = "primary",
}: {
  label: string;
  sublabel?: string;
  color?: "primary" | "violet";
}) {
  const dotColor = color === "violet" ? "bg-violet-500" : "bg-primary";
  const textColor = color === "violet" ? "text-violet-300/80" : "text-primary/80";

  return (
    <div className="flex gap-2.5 items-center">
      {/* Small avatar dot instead of full bubble */}
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted/30 border border-border/40 mt-0.5">
        <span className={`h-2 w-2 rounded-full ${dotColor} animate-pulse`} />
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {/* Arrow */}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          className={`flex-shrink-0 ${textColor}`}>
          <path d="M1 5h8M6 2l3 3-3 3" />
        </svg>
        {/* Latest status — updates in place */}
        <span className={`text-sm font-medium ${textColor} truncate`}>{label}</span>
        {sublabel && (
          <span className="text-[11px] text-muted-foreground/40 truncate hidden sm:inline">{sublabel}</span>
        )}
      </div>
    </div>
  );
}

// ── Completion bubble ──────────────────────────────────────────────────────────

function CompletionBubble({
  task,
  onViewBlueprint,
  elapsedMs,
}: {
  task: ExecutionTask;
  onViewBlueprint: () => void;
  elapsedMs?: number;
}) {
  const sectionCount = task.result ? countBlueprintSections(task.result.content) : 0;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!task.result) return;
    navigator.clipboard.writeText(task.result.content).then(() => {
      setCopied(true);
      toast.success("Blueprint copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <AssistantBubble
      model={task.result?.model}
      elapsedMs={elapsedMs}
      onCopy={task.result ? handleCopy : undefined}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-green-400">
              <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-foreground">Architecture blueprint ready</p>
        </div>
        {sectionCount > 0 && (
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            Generated {sectionCount} section{sectionCount !== 1 ? "s" : ""} covering the full project architecture.
            {task.result?.model && (
              <span className="text-muted-foreground/40"> · via {task.result.model.split("/").pop()}</span>
            )}
          </p>
        )}
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
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <CopyIconSm />
            {copied ? "Copied!" : "Copy All"}
          </button>
        </div>
      </div>
    </AssistantBubble>
  );
}

// ── History blueprint card ─────────────────────────────────────────────────────

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
    <AssistantBubble timestamp={timestamp} model={model} onCopy={handleCopy}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 flex-shrink-0">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-green-400">
              <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-foreground">Blueprint ready</p>
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
            {copied ? <span className="text-green-400">Copied!</span> : "Copy All"}
          </button>
        </div>
      </div>
    </AssistantBubble>
  );
}

// ── History blueprint viewer drawer ───────────────────────────────────────────

function HistoryViewerDrawer({ content, model, onClose }: { content: string; model?: string; onClose: () => void }) {
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

// ── Conversation bubble (plain AI response with markdown) ─────────────────────

function ConversationBubble({ content, timestamp, model }: { content: string; timestamp?: string; model?: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => toast.success("Copied to clipboard"));
  };
  return (
    <AssistantBubble timestamp={timestamp} model={model} onCopy={handleCopy}>
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
            <p className="w-full text-[10px] text-muted-foreground/40">Retry without restarting:</p>
            {onRetryBuild && (
              <button
                onClick={onRetryBuild}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
              >
                <RefreshIcon />
                Retry Build
              </button>
            )}
            {onRetryVerification && (
              <button
                onClick={onRetryVerification}
                className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted/20 transition-colors"
              >
                <RefreshIcon />
                Retry Verification
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
  "Build a SaaS project management app with teams and billing",
  "Create a Telegram bot for crypto price alerts",
  "Design a REST API for a marketplace with sellers and buyers",
  "Build a real-time chat app with rooms and direct messages",
];

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="relative">
        <AIPulse size={56} color="#6366f1" active />
      </div>
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-foreground mb-2">Start building</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Describe the software you want to build. The AI agent will generate a complete architecture blueprint, then build and verify it automatically.
        </p>
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs mt-1">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onPrompt(p)}
            className="rounded-xl border border-border bg-card/50 px-4 py-2.5 text-xs text-left text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/30 transition-all"
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
}

export function PlannerWorkspace({
  conversationId,
  messages,
  isFirstMessage,
  onSuccess,
  initialRepoId,
}: PlannerWorkspaceProps) {
  const queryClient = useQueryClient();

  // ── Input state ─────────────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<WorkspacePhase>({ kind: "idle" });
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Streaming content (accumulates content_chunk events) ────────────────────
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingStage, setStreamingStage] = useState<{ name: string; id: number } | null>(null);

  // ── Repository selector ─────────────────────────────────────────────────────
  const [selectedRepoId, setSelectedRepoId] = useState<string>(initialRepoId ?? "");

  // ── Drawer / panels ─────────────────────────────────────────────────────────
  const [historyViewing, setHistoryViewing] = useState<{ content: string; model?: string } | null>(null);
  const [showFiles, setShowFiles] = useState(false);

  // ── Live execution logs ─────────────────────────────────────────────────────
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

  // ── Add log helper ───────────────────────────────────────────────────────────

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
          addLog("success", event.allPassed ? "All checks passed — production ready!" : `Completed with ${checks.filter((c) => c.status === "fail").length} issue(s)`);

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
    setPhase({ kind: "idle" });
    toast.info("Generation stopped");
  }, []);

  // ── Planning pipeline ────────────────────────────────────────────────────────

  const handleSend = useCallback(async (overrideContent?: string) => {
    const content = overrideContent !== undefined ? overrideContent : input.trim();
    if (!content || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    setStreamingContent("");
    setStreamingStage(null);
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
        return <ConversationBubble key={msg.id} content={msg.content} timestamp={msg.created_at} model={model} />;
      }
      return null;
    });
  };

  // ── Render current phase ─────────────────────────────────────────────────────

  const renderPhase = () => {
    switch (phase.kind) {
      case "streaming": {
        const currentStageName = streamingStage?.name;
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <ActivityBubble
              label={currentStageName ?? "Planning your architecture…"}
              sublabel={`${streamingStage?.id ?? 0} / ${PLANNER_STAGES.length}`}
            />
          </>
        );
      }

      case "done_blueprint": {
        const task = tasks.find((t) => t.id === phase.taskId);
        if (!task) return null;
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <CompletionBubble
              task={task}
              elapsedMs={phase.elapsedMs}
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
            <ActivityBubble
              label={phase.currentStageName ?? "Building your project…"}
              color="violet"
            />
          </>
        );
      }

      case "verifying": {
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
            <ActivityBubble
              label={phase.currentStageName ?? "Verifying your project…"}
              color="violet"
            />
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
                  onRetryPreview={() => toast.info("Restarting preview server…")}
                />
                {/* View generated files button */}
                <button
                  onClick={() => setShowFiles(true)}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted/20 transition-colors"
                >
                  <FilesIcon />
                  View Generated Files
                </button>
              </div>
            </div>
          </>
        );
      }

      case "done_conversation":
        return (
          <>
            <UserBubble content={phase.userMessage} />
            <ConversationBubble content={phase.content} model={phase.model} />
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
          Regenerate response
        </button>
      </div>
    );
  }, [phase.kind, messages, isStreaming, handleSend]);

  // ── Input area busy state ────────────────────────────────────────────────────

  const isBusy = isStreaming || phase.kind === "executing" || phase.kind === "verifying";
  const inputPlaceholder = isBusy
    ? "Working on it…"
    : "Describe the software you want to build…";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden">

      {/* ── Messages ─────────────────────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-2xl px-4 py-6 flex flex-col gap-4">
          {renderHistory()}
          {renderPhase()}
          {regenerateButton}
          {messages.length === 0 && phase.kind === "idle" && (
            <EmptyState onPrompt={(p) => { setInput(p); textareaRef.current?.focus(); }} />
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Live log panel ───────────────────────────────────────────────────── */}
      {(execActive || execLogs.length > 0) && (
        <LiveLogPanel
          logs={execLogs}
          isActive={execActive}
          currentStage={execCurrentStage}
        />
      )}

      {/* ── Input area ───────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 border-t border-border bg-background/95 backdrop-blur-sm px-3 pt-3 pb-3 sm:px-4"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}
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
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
              >
                <option value="">No repository context</option>
                {repositories.map((r) => (
                  <option key={r.id} value={r.id}>{r.full_name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Input box */}
          <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-card shadow-sm focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={inputPlaceholder}
              className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-3 pr-1 text-sm shadow-none focus-visible:ring-0"
              rows={1}
              disabled={isBusy}
            />

            <div className="mb-2 mr-2 flex flex-shrink-0 items-center gap-1.5">
              {/* Stop button — shown while busy */}
              {isBusy && (
                <button
                  onClick={handleStop}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-muted text-foreground/70 hover:text-foreground hover:border-destructive/40 hover:bg-destructive/10 transition-colors"
                  aria-label="Stop generation"
                  title="Stop generation"
                >
                  <StopIcon />
                </button>
              )}

              {/* Send button */}
              <Button
                size="icon"
                className="h-8 w-8 flex-shrink-0 rounded-xl"
                onClick={() => void handleSend()}
                disabled={!input.trim() || isBusy}
              >
                {isBusy ? (
                  <AIPulse size={15} color="white" active />
                ) : (
                  <SendIcon />
                )}
              </Button>
            </div>
          </div>

          {/* Status line */}
          <div className="mt-1.5 flex items-center justify-between px-1">
            <p className="text-[10px] text-muted-foreground/35 hidden sm:block">
              Enter to send · Shift+Enter for newline
            </p>
            <div className="flex items-center gap-3">
              {(execActive || (phase.kind === "executing" || phase.kind === "verifying")) && execLogs.length > 0 && (
                <span className="text-[10px] text-violet-400/70 animate-pulse">
                  {execCurrentStage ?? "Building…"}
                </span>
              )}
              {isStreaming && (
                <span className="text-[10px] text-primary/60 animate-pulse">
                  {streamingStage?.name ?? "Planning…"}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── History blueprint viewer ──────────────────────────────────────────── */}
      {historyViewing && (
        <HistoryViewerDrawer
          content={historyViewing.content}
          model={historyViewing.model}
          onClose={() => setHistoryViewing(null)}
        />
      )}

      {/* ── Generated files panel ─────────────────────────────────────────────── */}
      {showFiles && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setShowFiles(false)}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-border bg-background shadow-2xl">
            <GeneratedFilesPanel
              conversationId={conversationId}
              onClose={() => setShowFiles(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
