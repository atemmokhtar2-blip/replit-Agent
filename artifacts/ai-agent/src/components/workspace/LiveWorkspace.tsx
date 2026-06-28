/**
 * LiveWorkspace — The Living AI Workspace
 *
 * Replaces PlannerWorkspace with a dynamic execution feed.
 * Every AI action generates a Live Execution Card.
 * Cards appear one by one, update in real-time, and stream live.
 *
 * Layout:
 *   Left  — Project file tree (files extracted from execution)
 *   Center — Execution feed + conversation input
 *   Right  — Preview panel (appears when previewUrl is available)
 */

import { useState, useRef, useEffect, useCallback } from "react";
import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  useRenameConversation,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { AIMessage } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { streamToPlannerEngine, PLANNER_STAGES } from "@/lib/planner-stream";
import type { PlannerStreamEvent } from "@/lib/planner-stream";
import { streamToExecutionEngine } from "@/lib/execution-stream";
import type { ExecutionStreamEvent } from "@/lib/execution-stream";
import { repositoriesApi } from "@/lib/repo-api";
import {
  useTaskActions,
  useTaskStore,
  DEFAULT_EXEC_PHASES,
} from "@/lib/task-store";
import { ExecutionCard } from "./ExecutionCard";
import type { LiveCard, VerifyCheckItem } from "./ExecutionCard";

// ── Helpers ────────────────────────────────────────────────────────────────────

let _cardCounter = 0;
function newId(prefix: string) {
  return `${prefix}-${++_cardCounter}-${Date.now()}`;
}

function autoTitle(content: string) {
  return content.slice(0, 60).trim() || "New conversation";
}

function now() {
  return new Date().toISOString();
}

// Stage-contextual log messages to make the feed feel alive
const STAGE_LOGS: Record<number, string[]> = {
  1: ["Reading your request...", "Identifying project requirements...", "Classifying request type..."],
  2: ["Mapping feature requirements...", "Identifying technical constraints...", "Analyzing project scope..."],
  3: ["Structuring system architecture...", "Selecting technology stack...", "Designing component hierarchy..."],
  4: ["Planning project structure...", "Organizing file layout...", "Defining module boundaries..."],
  5: ["Designing database schema...", "Mapping API endpoints...", "Defining data models..."],
  6: ["Reviewing security requirements...", "Planning authentication flow...", "Auditing data access patterns..."],
  7: ["Finalizing technical decisions...", "Preparing deployment strategy...", "Reviewing production requirements..."],
  8: ["Sealing blueprint...", "Validating architecture...", "Blueprint complete."],
};

const EXEC_STAGE_LOGS: Record<number, string[]> = {
  1:  ["Analyzing blueprint...", "Identifying required files...", "Planning file generation..."],
  2:  ["Generating project skeleton...", "Writing source files...", "Creating configuration files..."],
  3:  ["Resolving npm dependencies...", "Installing packages...", "Linking workspace modules..."],
  4:  ["Compiling TypeScript...", "Bundling assets...", "Checking for build errors..."],
  5:  ["Running ESLint...", "Checking code style...", "Applying auto-fixes..."],
  6:  ["Running tsc --noEmit...", "Verifying type signatures...", "Checking generic constraints..."],
  7:  ["Running test suite...", "Executing unit tests...", "Checking test coverage..."],
  8:  ["Starting development server...", "Binding to port...", "Waiting for server ready..."],
  9:  ["Building production bundle...", "Tree-shaking unused code...", "Optimizing asset sizes..."],
  10: ["Sending health probe...", "Checking HTTP responses...", "Verifying API endpoints..."],
  11: ["Verifying route handlers...", "Testing navigation paths...", "Checking 404 handling..."],
  12: ["Testing API contracts...", "Verifying response shapes...", "Checking error handling..."],
  13: ["Running health checks...", "Scoring component health...", "Computing domain scores..."],
  14: ["Probing all endpoints...", "Verifying response times...", "Checking error rates..."],
  15: ["Analyzing failures...", "Identifying root causes...", "Planning fixes..."],
  16: ["Applying fixes...", "Rebuilding affected modules...", "Re-running failed checks..."],
  17: ["Running final verification...", "Checking all systems...", "Finalizing deployment status..."],
};

// ── File tree types ───────────────────────────────────────────────────────────

interface ProjectFile {
  path: string;
  status: "created" | "modified" | "deleted";
}

function extractFilesFromContent(content: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  const seen = new Set<string>();
  // Match common file patterns in code blocks
  const patterns = [
    /```[\w]*\s*\n?\/\/(.*?\.(?:ts|tsx|js|jsx|py|css|html|json|yaml|yml|md|env|sh))/gm,
    /(?:^|\n)(?:\/\/|#)\s*([\w./\-]+\.(?:ts|tsx|js|jsx|py|css|html|json|yaml|yml|md))/gm,
    /`((?:src|lib|app|pages|components|api|server|client|public)\/[\w./\-]+\.[\w]+)`/gm,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      const path = m[1]?.trim();
      if (path && !seen.has(path) && path.length < 80) {
        seen.add(path);
        files.push({ path, status: "created" });
      }
    }
  }
  return files.slice(0, 30);
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 1.5L6.5 7.5M12.5 1.5L8.5 12.5L6.5 7.5M12.5 1.5L1.5 5.5L6.5 7.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" opacity="0.2" />
      <rect x="2" y="2" width="8" height="8" rx="1" />
    </svg>
  );
}

function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop() ?? "";
  const colorMap: Record<string, string> = {
    ts: "text-blue-400", tsx: "text-cyan-400", js: "text-amber-400", jsx: "text-amber-400",
    css: "text-violet-400", html: "text-orange-400", json: "text-yellow-400",
    md: "text-muted-foreground/60", py: "text-green-400", yaml: "text-teal-400", yml: "text-teal-400",
  };
  const color = colorMap[ext] ?? "text-muted-foreground/50";
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={color}>
      <path d="M6 1H2.5A.5.5 0 002 1.5v7a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V4L6 1z" stroke="currentColor" strokeWidth="1.2" />
      <polyline points="6,1 6,4 9,4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── Project file tree ─────────────────────────────────────────────────────────

function ProjectFileTree({ files }: { files: ProjectFile[] }) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center">
        <div className="h-8 w-8 rounded-lg border border-border/30 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted-foreground/30">
            <rect x="2" y="1.5" width="12" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <line x1="5" y1="8.5" x2="11" y2="8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <line x1="5" y1="11" x2="8" y2="11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-[10px] text-muted-foreground/30 leading-relaxed">Files will appear<br />as the AI builds</p>
      </div>
    );
  }

  return (
    <div className="p-2 space-y-px">
      <AnimatePresence initial={false}>
        {files.map((f) => (
          <motion.div
            key={f.path}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/30 transition-colors group cursor-default"
          >
            <FileIcon path={f.path} />
            <span className="flex-1 min-w-0 text-[11px] text-muted-foreground/70 truncate leading-snug group-hover:text-foreground/80 transition-colors">
              {f.path.split("/").pop()}
            </span>
            <span className={`text-[8px] font-semibold uppercase flex-shrink-0 ${
              f.status === "created" ? "text-emerald-400/60" :
              f.status === "modified" ? "text-amber-400/60" :
              "text-red-400/60"
            }`}>
              {f.status === "created" ? "+" : f.status === "modified" ? "~" : "-"}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

const PROMPT_SUGGESTIONS = [
  "Build a restaurant website with menu, reservations, and contact",
  "Create a task management app with real-time collaboration",
  "Design an e-commerce store with cart and checkout",
  "Build a blog platform with markdown and comments",
  "Create a REST API with authentication and database",
  "Build a real-time chat application with rooms",
];

function EmptyState({ onPrompt }: { onPrompt: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16 px-6 text-center">
      <div>
        <div className="flex items-center justify-center gap-2 mb-3">
          <motion.div
            className="h-10 w-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center"
            animate={{ scale: [1, 1.05, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-primary">
              <path d="M10 2L12.5 8L18 10L12.5 12L10 18L7.5 12L2 10L7.5 8L10 2Z" fill="currentColor" opacity="0.9" />
            </svg>
          </motion.div>
        </div>
        <h2 className="text-base font-semibold text-foreground mb-1.5">Living AI Workspace</h2>
        <p className="text-sm text-muted-foreground/60 max-w-xs leading-relaxed">
          Describe software you want to build. Watch the AI work in real-time across a live execution feed.
        </p>
      </div>
      <div className="w-full max-w-md grid grid-cols-1 gap-1.5">
        {PROMPT_SUGGESTIONS.map((p, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06, duration: 0.2 }}
            onClick={() => onPrompt(p)}
            className="text-left rounded-lg border border-border/40 px-3 py-2 text-xs text-muted-foreground/60 hover:text-foreground hover:border-primary/30 hover:bg-primary/5 transition-all duration-150"
          >
            {p}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// ── History card (compact, collapsed by default) ───────────────────────────────

function HistoryCard({ msg }: { msg: AIMessage }) {
  const [open, setOpen] = useState(false);
  const isUser = msg.role === "user";
  const preview = msg.content.slice(0, 120);
  const hasMore = msg.content.length > 120;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] rounded-xl border border-border/40 bg-muted/30 px-4 py-2.5">
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  const meta = msg.metadata as { module?: string; model?: string } | null;
  const isBlueprint = meta?.module === "planner" || /^##\s+1\./m.test(msg.content);

  return (
    <motion.div
      layout
      className="rounded-xl border border-border/30 bg-card/40 overflow-hidden"
    >
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setOpen((p) => !p)}
      >
        <div className={`h-5 w-5 flex-shrink-0 rounded-md flex items-center justify-center ${isBlueprint ? "bg-emerald-500/10 border border-emerald-500/20" : "bg-primary/10 border border-primary/20"}`}>
          <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className={isBlueprint ? "text-emerald-400" : "text-primary"}>
            {isBlueprint
              ? <path d="M8 1.5H3a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1V6.5L8 1.5z" stroke="currentColor" strokeWidth="1.3" />
              : <path d="M7 1L8.8 5.4L13 7L8.8 8.6L7 13L5.2 8.6L1 7L5.2 5.4L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            }
          </svg>
        </div>
        <span className="flex-1 text-xs text-muted-foreground/70 truncate">
          {isBlueprint ? "Blueprint" : "Response"} · {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
        {meta?.model && (
          <span className="text-[9px] text-muted-foreground/30 hidden sm:inline">{meta.model.split("/").pop()}</span>
        )}
        <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className={`text-muted-foreground/30 transition-transform duration-150 ${open ? "rotate-180" : ""}`}>
          <polyline points="1,3 4.5,6.5 8,3" />
        </svg>
      </button>
      {open && (
        <div className="px-3.5 pb-3 border-t border-border/20">
          <p className="text-xs text-muted-foreground/60 leading-relaxed whitespace-pre-wrap pt-2">
            {hasMore && !open ? preview + "…" : msg.content}
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ── Live status bar ────────────────────────────────────────────────────────────

function LiveStatusBar({ label, sublabel }: { label: string; sublabel?: string }) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl border border-primary/20 bg-primary/5">
      <motion.div
        className="h-2 w-2 rounded-full bg-primary flex-shrink-0"
        animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="text-xs text-primary/80 font-medium">{label}</span>
      {sublabel && (
        <span className="text-[10px] text-muted-foreground/40 hidden sm:inline">{sublabel}</span>
      )}
    </div>
  );
}

// ── Main LiveWorkspace ────────────────────────────────────────────────────────

interface LiveWorkspaceProps {
  conversationId: string;
  messages: AIMessage[];
  onSuccess: (conversationId: string) => void;
  isFirstMessage: boolean;
  isWaitingForRepo?: boolean;
  autoStartMessage?: string | null;
  initialRepoId?: string;
}

export function LiveWorkspace({
  conversationId,
  messages,
  onSuccess,
  isFirstMessage,
  isWaitingForRepo,
  autoStartMessage,
  initialRepoId,
}: LiveWorkspaceProps) {
  const queryClient = useQueryClient();
  const renameMutation = useRenameConversation();

  // ── Repo state ────────────────────────────────────────────────────────────────
  const [selectedRepoId, setSelectedRepoId] = useState(initialRepoId ?? "");
  const { data: reposData } = useQuery({
    queryKey: ["repositories"],
    queryFn: () => repositoriesApi.list(),
    staleTime: 60_000,
  });
  const repositories = (reposData as Array<{ id: string; full_name: string }> | undefined) ?? [];
  const { tasks } = useTaskStore();
  const {
    createTask, stageStart, stageComplete, completeTask, failTask,
    startExecution, execPhaseStart, execPhaseComplete, execPhaseFail,
    setVerifyCheck, setVerifyFixing, setVerified, setHealthReport, setExecError,
    retryExecution,
  } = useTaskActions();

  // ── Card state ───────────────────────────────────────────────────────────────
  const [cards, setCards] = useState<LiveCard[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [execActive, setExecActive] = useState(false);
  const [projectFiles, setProjectFiles] = useState<ProjectFile[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showFileTree, setShowFileTree] = useState(true);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [verifyCardId, setVerifyCardId] = useState<string | null>(null);
  const verifyCardIdRef = useRef<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<{
    provider: string;
    providerDisplay: string;
    keyName?: string;
    keyIndex?: number;
    totalKeys?: number;
    model?: string;
  } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs
  const abortRef = useRef<AbortController | null>(null);
  const execAbortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledRef = useRef(false);
  const wasFirstRef = useRef(isFirstMessage);
  const plannerStartRef = useRef(0);
  const blueprintRef = useRef("");
  const taskIdRef = useRef("");
  const handleSendRef = useRef<(override?: string) => void>(() => {});

  // ── Elapsed timer ─────────────────────────────────────────────────────────────
  const startElapsedTimer = useCallback(() => {
    setElapsedMs(0);
    if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
    const t0 = Date.now();
    elapsedIntervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - t0);
    }, 500);
  }, []);

  const stopElapsedTimer = useCallback(() => {
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  useEffect(() => () => { if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current); }, []);

  // ── Auto-scroll ───────────────────────────────────────────────────────────────
  const scrollToBottom = useCallback((force = false) => {
    if (!force && userScrolledRef.current) return;
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [cards.length, scrollToBottom]);

  const handleFeedScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledRef.current = !atBottom;
  }, []);

  // ── Card management ───────────────────────────────────────────────────────────

  const addCard = useCallback((card: LiveCard) => {
    setCards((prev) => [...prev, card]);
    setActiveCardId(card.id);
  }, []);

  const updateCard = useCallback((id: string, updates: Partial<LiveCard>) => {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, ...updates } : c));
  }, []);

  const appendLog = useCallback((id: string, log: string) => {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, logs: [...c.logs, log] } : c));
  }, []);

  const appendContent = useCallback((id: string, text: string) => {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, content: (c.content ?? "") + text } : c));
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, expanded: !c.expanded } : c));
  }, []);

  const upsertVerifyCheck = useCallback((check: VerifyCheckItem) => {
    setCards((prev) => prev.map((c) => {
      if (c.id !== verifyCardIdRef.current) return c;
      const existing = c.checks ?? [];
      const idx = existing.findIndex((ch) => ch.id === check.id);
      const checks = idx >= 0
        ? existing.map((ch) => ch.id === check.id ? { ...ch, ...check } : ch)
        : [...existing, check];
      const passed = checks.filter((ch) => ch.status === "pass" || ch.status === "fixed").length;
      return { ...c, checks, progress: Math.round((passed / checks.length) * 100) };
    }));
  }, [verifyCardId]);

  // ── Add files from blueprint content ─────────────────────────────────────────
  const addFilesFromContent = useCallback((content: string) => {
    const found = extractFilesFromContent(content);
    if (found.length > 0) {
      setProjectFiles((prev) => {
        const existing = new Set(prev.map((f) => f.path));
        const newOnes = found.filter((f) => !existing.has(f.path));
        return [...prev, ...newOnes];
      });
    }
  }, []);

  // ── Execution pipeline ────────────────────────────────────────────────────────

  const runExecution = useCallback(async (taskId: string, blueprint: string, convId: string) => {
    setExecActive(true);
    const controller = new AbortController();
    execAbortRef.current = controller;
    startExecution(taskId, DEFAULT_EXEC_PHASES.map((p) => ({ ...p })));

    let currentExecCard = "";

    const handleExecEvent = (event: ExecutionStreamEvent) => {
      switch (event.type) {
        case "exec_stage_start": {
          const cardId = `exec-${event.stage}-${taskId}`;
          currentExecCard = cardId;
          const stageLogs = EXEC_STAGE_LOGS[event.stage] ?? [`Starting ${event.stageName}...`];
          addCard({
            id: cardId,
            type: "execution",
            title: event.stageName,
            subtitle: event.stageLabel,
            status: "running",
            progress: -1,
            logs: [stageLogs[0]],
            startedAt: now(),
            expanded: false,
            execStageId: event.stage,
          });
          // Stream subsequent logs with delay
          stageLogs.slice(1).forEach((log, i) => {
            setTimeout(() => appendLog(cardId, log), (i + 1) * 800);
          });
          execPhaseStart(taskId, event.stage);
          break;
        }

        case "exec_stage_complete": {
          const cardId = `exec-${event.stage}-${taskId}`;
          updateCard(cardId, { status: "complete", progress: 100, finishedAt: now() });
          execPhaseComplete(taskId, event.stage, event.duration);
          // Add completion log
          setTimeout(() => appendLog(cardId, `✓ Completed in ${(event.duration / 1000).toFixed(1)}s`), 100);
          break;
        }

        case "exec_stage_fail": {
          const cardId = `exec-${event.stage}-${taskId}`;
          updateCard(cardId, { status: "failed", finishedAt: now() });
          appendLog(cardId, `✗ Failed: ${event.error}`);
          execPhaseFail(taskId, event.stage, event.error);
          break;
        }

        case "verify_check": {
          // Create verification card on first check
          if (!verifyCardIdRef.current) {
            const vId = `verify-${taskId}`;
            verifyCardIdRef.current = vId;
            setVerifyCardId(vId);
            addCard({
              id: vId,
              type: "verification",
              title: "Verification Suite",
              status: "running",
              progress: 0,
              logs: ["Running 18-point verification suite..."],
              startedAt: now(),
              expanded: true,
              checks: [],
            });
          }
          const vId = `verify-${taskId}`;
          upsertVerifyCheck({
            id: event.check,
            name: event.checkName,
            domain: event.checkDomain,
            status: event.status === "checking" ? "checking"
              : event.status === "pass" ? "pass"
              : event.status === "fail" ? "fail"
              : event.status === "skip" ? "skip"
              : event.status === "fixing" ? "fixing"
              : event.status === "fixed" ? "fixed"
              : "pending",
            detail: event.detail,
          });
          setVerifyCheck(taskId, {
            id: event.check,
            name: event.checkName,
            domain: event.checkDomain,
            status: event.status as "pending" | "checking" | "pass" | "fail" | "skip" | "fixing" | "fixed",
            detail: event.detail,
          });
          break;
        }

        case "fix_attempt": {
          const vId = `verify-${taskId}`;
          appendLog(vId, `Fixing ${event.checkName ?? event.check}: ${event.strategy}`);
          setVerifyFixing(taskId, event.check, event.strategy);
          // Update check status
          upsertVerifyCheck({
            id: event.check,
            name: event.checkName ?? event.check,
            domain: event.checkDomain,
            status: "fixing",
            detail: event.strategy,
          });
          break;
        }

        case "fix_result": {
          const vId = `verify-${taskId}`;
          const fixed = event.status === "fixed";
          appendLog(vId, fixed ? `✓ Fixed: ${event.check}` : `✗ Could not fix: ${event.check}`);
          upsertVerifyCheck({
            id: event.check,
            name: event.check,
            status: event.status === "fixed" ? "fixed" : "fail",
            detail: event.strategy,
          });
          break;
        }

        case "health_report": {
          const vId = `verify-${taskId}`;
          appendLog(vId, `Health score: ${event.healthReport.overallScore}/100 (${event.healthReport.passedChecks}/${event.healthReport.totalChecks} checks passed)`);
          setHealthReport(taskId, event.healthReport);
          break;
        }

        case "production_gate":
          break;

        case "exec_done": {
          const vId = `verify-${taskId}`;
          const url = event.previewUrl;
          if (url) setPreviewUrl(url);

          updateCard(vId, {
            status: event.allPassed ? "complete" : "failed",
            finishedAt: now(),
            progress: event.allPassed ? 100 : 80,
            allPassed: event.allPassed,
            previewUrl: url,
          });

          // Final complete/error card
          const doneId = `done-${taskId}`;
          addCard({
            id: doneId,
            type: event.allPassed ? "complete" : "error",
            title: event.allPassed ? "Project Ready" : "Build Completed with Issues",
            status: event.allPassed ? "complete" : "failed",
            progress: 100,
            logs: event.allPassed
              ? ["All systems verified.", url ? `Preview: ${url}` : "Build complete."]
              : ["Some checks failed. Review verification details above."],
            startedAt: now(),
            finishedAt: now(),
            expanded: true,
            allPassed: event.allPassed,
            previewUrl: url,
          });

          if (url) setShowPreview(true);
          setExecActive(false);

          const result = {
            phases: DEFAULT_EXEC_PHASES,
            checks: event.checks.map((c) => ({
              id: c.id,
              name: c.name,
              domain: c.domain,
              status: c.status as "pending" | "checking" | "pass" | "fail" | "skip" | "fixing" | "fixed",
              detail: c.detail,
            })),
            healthReport: event.healthReport,
            allPassed: event.allPassed,
            completedAt: now(),
          };
          setVerified(taskId, result, url, event.productionGate);
          scrollToBottom(true);
          break;
        }

        case "exec_error": {
          const errId = `exec-error-${taskId}`;
          addCard({
            id: errId,
            type: "error",
            title: "Execution Failed",
            status: "failed",
            progress: 0,
            logs: [event.message],
            content: event.message,
            startedAt: now(),
            finishedAt: now(),
            expanded: true,
          });
          setExecError(taskId, event.message);
          setExecActive(false);
          break;
        }
      }
    };

    try {
      await streamToExecutionEngine(convId, blueprint, handleExecEvent, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Execution failed";
      setExecError(taskId, msg);
      setExecActive(false);
    }
  }, [
    addCard, updateCard, appendLog, upsertVerifyCheck, verifyCardId,
    startExecution, execPhaseStart, execPhaseComplete, execPhaseFail,
    setVerifyCheck, setVerifyFixing, setVerified, setHealthReport, setExecError,
    scrollToBottom,
  ]);

  // ── Send handler ──────────────────────────────────────────────────────────────

  const handleSend = useCallback(async (overrideContent?: string) => {
    const content = overrideContent !== undefined ? overrideContent : input.trim();
    if (!content || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    userScrolledRef.current = false;
    wasFirstRef.current = isFirstMessage;
    plannerStartRef.current = Date.now();

    // Reset runtime state for new session
    setCards([]);
    verifyCardIdRef.current = null;
    setVerifyCardId(null);
    setPreviewUrl(null);
    setShowPreview(false);
    blueprintRef.current = "";
    setProviderStatus(null);
    startElapsedTimer();

    abortRef.current?.abort();
    execAbortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const taskId = `${conversationId}-${Date.now()}`;
    taskIdRef.current = taskId;
    const taskTitle = content.length > 50 ? content.slice(0, 50) + "…" : content;

    // Create task in store
    createTask({
      id: taskId,
      conversationId,
      title: taskTitle,
      userPrompt: content,
      stages: PLANNER_STAGES.map((s) => ({ id: s.id, name: s.name, action: s.action, status: "pending" as const })),
      startedAt: now(),
    });

    // User message card
    addCard({
      id: `user-${taskId}`,
      type: "user-message",
      title: "User",
      status: "complete",
      progress: 100,
      logs: [],
      content,
      startedAt: now(),
      finishedAt: now(),
      expanded: false,
    });

    let activeStageCard = "";
    let capturedBlueprint = "";

    const handleEvent = (event: PlannerStreamEvent) => {
      switch (event.type) {
        case "thinking_start": {
          const tId = `think-${taskId}`;
          activeStageCard = tId;
          addCard({
            id: tId,
            type: "thinking",
            title: "Reasoning through the problem",
            subtitle: event.model.split("/").pop(),
            status: "running",
            progress: -1,
            logs: ["Analyzing request...", "Generating reasoning chain..."],
            startedAt: now(),
            expanded: true,
            model: event.model,
          });
          break;
        }

        case "thinking_chunk":
          appendContent(`think-${taskId}`, event.text);
          break;

        case "thinking_complete":
          updateCard(`think-${taskId}`, { status: "complete", finishedAt: now(), expanded: false });
          break;

        case "model_switch":
          if (activeStageCard) {
            appendLog(activeStageCard, `Switching to ${event.toModel.split("/").pop()} for ${event.taskType}...`);
          }
          break;

        case "stage_start": {
          const stageMeta = PLANNER_STAGES.find((s) => s.id === event.stage);
          const sId = `plan-${event.stage}-${taskId}`;
          activeStageCard = sId;
          const initialLogs = STAGE_LOGS[event.stage] ?? [`Starting ${stageMeta?.name ?? event.name}...`];
          addCard({
            id: sId,
            type: "planning",
            title: stageMeta?.name ?? event.name,
            subtitle: stageMeta?.action,
            status: "running",
            progress: Math.round(((event.stage - 1) / PLANNER_STAGES.length) * 100),
            logs: [initialLogs[0]],
            startedAt: now(),
            expanded: false,
            stageId: event.stage,
          });
          // Stream stage-contextual logs
          initialLogs.slice(1).forEach((log, i) => {
            setTimeout(() => appendLog(sId, log), (i + 1) * 1200);
          });
          stageStart(taskId, event.stage);
          break;
        }

        case "content_chunk":
          appendContent(activeStageCard, event.text);
          break;

        case "stage_complete": {
          const sId = `plan-${event.stage}-${taskId}`;
          updateCard(sId, {
            status: "complete",
            finishedAt: now(),
            progress: Math.round((event.stage / PLANNER_STAGES.length) * 100),
          });
          stageComplete(taskId, event.stage);
          break;
        }

        case "section_detected":
          break;

        case "done": {
          capturedBlueprint = event.content;
          blueprintRef.current = event.content;
          const elapsedMs = Date.now() - plannerStartRef.current;

          // Close last stage card
          if (activeStageCard) {
            updateCard(activeStageCard, { status: "complete", finishedAt: now(), progress: 100 });
          }

          // Add blueprint card
          addFilesFromContent(event.content);
          addCard({
            id: `blueprint-${taskId}`,
            type: "blueprint",
            title: "Architecture Blueprint",
            subtitle: `via ${event.model.split("/").pop() ?? event.model}`,
            status: "complete",
            progress: 100,
            logs: [`Generated in ${(elapsedMs / 1000).toFixed(1)}s`, `Model: ${event.model.split("/").pop()}`],
            content: event.content,
            model: event.model,
            startedAt: now(),
            finishedAt: now(),
            expanded: true,
          });

          completeTask(taskId, event.content, event.model);
          setIsStreaming(false);
          stopElapsedTimer();

          queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          onSuccess(conversationId);

          if (wasFirstRef.current) {
            renameMutation.mutate(
              { conversationId, data: { title: autoTitle(content) } },
              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) }
            );
          }

          // Start execution pipeline
          void runExecution(taskId, capturedBlueprint, conversationId);
          break;
        }

        case "conversation": {
          const elapsedMs = Date.now() - plannerStartRef.current;
          addCard({
            id: `conv-${taskId}`,
            type: "conversation",
            title: "Response",
            status: "complete",
            progress: 100,
            logs: [`Completed in ${(elapsedMs / 1000).toFixed(1)}s`],
            content: event.content,
            startedAt: now(),
            finishedAt: now(),
            expanded: true,
          });
          setIsStreaming(false);
          stopElapsedTimer();
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

        case "error": {
          addCard({
            id: `err-${taskId}`,
            type: "error",
            title: "Error",
            status: "failed",
            progress: 0,
            logs: [event.message],
            content: event.message,
            startedAt: now(),
            finishedAt: now(),
            expanded: true,
          });
          failTask(taskId, event.message);
          setIsStreaming(false);
          stopElapsedTimer();
          break;
        }

        case "provider_status": {
          const ev = event.event;
          setProviderStatus({
            provider: event.provider,
            providerDisplay: event.providerDisplay,
            keyName: event.keyName,
            keyIndex: event.keyIndex,
            totalKeys: event.totalKeys,
            model: event.model,
          });
          // Surface key rotation / provider switch events as log lines in the active card
          if (activeStageCard) {
            let logMsg: string | null = null;
            if (ev === "provider_switch") {
              logMsg = `Switching to ${event.providerDisplay}…`;
            } else if (ev === "key_switch") {
              logMsg = `Rotating to next key (${event.keyName ?? ""})…`;
            } else if (ev === "key_fail") {
              logMsg = `Key failed [${event.reason ?? "error"}] — trying next…`;
            }
            if (logMsg) appendLog(activeStageCard, logMsg);
          }
          break;
        }

        default:
          break;
      }
    };

    try {
      await streamToPlannerEngine(content, conversationId, handleEvent, controller.signal, selectedRepoId || undefined);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Connection failed";
      addCard({
        id: `err-${taskId}`,
        type: "error",
        title: "Connection Failed",
        status: "failed",
        progress: 0,
        logs: [msg],
        content: msg,
        startedAt: now(),
        finishedAt: now(),
        expanded: true,
      });
      failTask(taskId, msg);
      toast.error(msg);
    } finally {
      if (!controller.signal.aborted) {
        setIsStreaming(false);
        stopElapsedTimer();
      }
    }
  }, [
    input, isStreaming, conversationId, isFirstMessage, selectedRepoId,
    queryClient, renameMutation, onSuccess,
    addCard, updateCard, appendLog, appendContent, addFilesFromContent,
    createTask, stageStart, stageComplete, completeTask, failTask,
    runExecution, startElapsedTimer, stopElapsedTimer,
  ]);

  // Keep ref current
  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  // ── Auto-start ────────────────────────────────────────────────────────────────
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

  // ── Stop ──────────────────────────────────────────────────────────────────────
  const handleStop = () => {
    abortRef.current?.abort();
    execAbortRef.current?.abort();
    setIsStreaming(false);
    setExecActive(false);
    stopElapsedTimer();
    setProviderStatus(null);
    toast.info("Stopped");
  };

  const isBusy = isStreaming || execActive;

  // ── Keyboard ──────────────────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  // ── Count running / complete cards ─────────────────────────────────────────
  const runningCard = cards.find((c) => c.status === "running");

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden bg-background">

      {/* ── Left: Project file tree ─────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {showFileTree && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 220, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="flex-shrink-0 border-r border-border/50 bg-card/30 flex flex-col overflow-hidden"
          >
            <div className="flex-shrink-0 border-b border-border/40 px-3 py-2.5 flex items-center gap-2">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-muted-foreground/50">
                <rect x="1" y="1" width="9" height="9" rx="1" />
                <line x1="3.5" y1="1" x2="3.5" y2="10" />
              </svg>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Project Files</span>
              {projectFiles.length > 0 && (
                <span className="ml-auto text-[9px] text-primary/50">{projectFiles.length}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              <ProjectFileTree files={projectFiles} />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Center: Execution feed + input ──────────────────────────────────── */}
      <div className="flex flex-1 min-w-0 flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex-shrink-0 border-b border-border/40 bg-card/20 px-3 py-1.5 flex items-center gap-2">
          {/* File tree toggle */}
          <button
            onClick={() => setShowFileTree((p) => !p)}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${showFileTree ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/40"}`}
            title="Toggle file tree"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <rect x="1" y="1" width="10" height="10" rx="1" />
              <line x1="4" y1="1" x2="4" y2="11" />
            </svg>
          </button>

          {/* Status — compact execution header */}
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              {isBusy ? (
                <motion.div
                  key="running"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-2 min-w-0"
                >
                  <motion.div
                    className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                  {providerStatus ? (
                    <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                      <span className="text-[11px] font-medium text-primary/80 flex-shrink-0">
                        {providerStatus.providerDisplay}
                      </span>
                      {providerStatus.model && (
                        <span className="text-[10px] text-muted-foreground/50 truncate hidden sm:inline">
                          · {providerStatus.model.split("/").pop()}
                        </span>
                      )}
                      {providerStatus.totalKeys && providerStatus.totalKeys > 1 && (
                        <span className="text-[9px] text-muted-foreground/35 flex-shrink-0 hidden md:inline">
                          key {providerStatus.keyIndex}/{providerStatus.totalKeys}
                        </span>
                      )}
                    </div>
                  ) : runningCard ? (
                    <span className="text-[11px] text-primary/70 truncate">{runningCard.title}</span>
                  ) : null}
                  {elapsedMs > 1000 && (
                    <span className="text-[9px] text-muted-foreground/30 flex-shrink-0 tabular-nums hidden sm:inline">
                      {(elapsedMs / 1000).toFixed(0)}s
                    </span>
                  )}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* Card count */}
          {cards.length > 0 && (
            <span className="text-[10px] text-muted-foreground/40">{cards.filter((c) => c.status === "complete").length}/{cards.length} done</span>
          )}

          {/* Preview toggle */}
          {previewUrl && (
            <button
              onClick={() => setShowPreview((p) => !p)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors ${showPreview ? "text-primary bg-primary/10" : "text-muted-foreground/50 hover:text-foreground hover:bg-muted/40"}`}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="1" y="1.5" width="8" height="7" rx="1" />
                <line x1="1" y1="3.5" x2="9" y2="3.5" />
              </svg>
              Preview
            </button>
          )}
        </div>

        {/* Feed */}
        <div
          ref={feedRef}
          onScroll={handleFeedScroll}
          className="flex-1 overflow-y-auto"
        >
          <div className="mx-auto max-w-2xl px-4 py-6 space-y-3">

            {/* History messages */}
            {messages.length > 0 && cards.length === 0 && (
              <div className="space-y-2.5">
                {messages.map((msg) => (
                  <HistoryCard key={msg.id} msg={msg} />
                ))}
                <div className="border-t border-border/20 pt-3">
                  <p className="text-[10px] text-muted-foreground/30 text-center">— New session —</p>
                </div>
              </div>
            )}

            {/* Empty state */}
            {messages.length === 0 && cards.length === 0 && !isBusy && (
              isWaitingForRepo ? (
                <div className="flex flex-col items-center justify-center gap-4 py-16 px-4 text-center">
                  <motion.div
                    className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  >
                    <svg className="text-primary" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  </motion.div>
                  <h2 className="text-base font-semibold text-foreground">Analyzing repository…</h2>
                  <p className="text-sm text-muted-foreground/60">Cloning and understanding the project structure. This usually takes 30–60 seconds.</p>
                </div>
              ) : (
                <EmptyState onPrompt={(p) => { setInput(p); textareaRef.current?.focus(); }} />
              )
            )}

            {/* Live execution cards */}
            <AnimatePresence initial={false} mode="popLayout">
              {cards.map((card) => (
                <ExecutionCard
                  key={card.id}
                  card={card}
                  onToggleExpand={toggleExpand}
                />
              ))}
            </AnimatePresence>

            <div ref={feedEndRef} className="h-2" />
          </div>
        </div>

        {/* ── Input ───────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-4 pt-2 pb-4 border-t border-border/40 bg-card/20"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 1rem))" }}>
          <div className="mx-auto max-w-2xl space-y-2">
            {/* Repository selector */}
            {repositories.length > 0 && (
              <div className="flex items-center gap-2">
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-muted-foreground/40 flex-shrink-0">
                  <rect x="1" y="1" width="9" height="9" rx="1" />
                  <path d="M3.5 1v9M7.5 1v9M1 4h9M1 7.5h9" />
                </svg>
                <select
                  value={selectedRepoId}
                  onChange={(e) => setSelectedRepoId(e.target.value)}
                  disabled={isBusy}
                  className="flex-1 rounded-lg border border-border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
                >
                  <option value="">No repository context</option>
                  {repositories.map((r) => (
                    <option key={r.id} value={r.id}>{r.full_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Input box */}
            <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card/80 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all duration-150">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isBusy ? "Working on it…" : "Describe the software you want to build…"}
                className="min-h-[46px] max-h-[160px] flex-1 resize-none border-0 bg-transparent px-4 py-3 pr-2 text-sm shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/35"
                rows={1}
                disabled={isBusy}
              />
              <div className="mb-2.5 mr-2.5 flex items-center gap-1.5 flex-shrink-0">
                {isBusy ? (
                  <button
                    onClick={handleStop}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive transition-colors"
                    aria-label="Stop"
                  >
                    <StopIcon />
                  </button>
                ) : (
                  <button
                    onClick={() => void handleSend()}
                    disabled={!input.trim()}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label="Send"
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── Right: Preview panel ─────────────────────────────────────────────── */}
      <AnimatePresence initial={false}>
        {showPreview && previewUrl && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 380, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="flex-shrink-0 border-l border-border/50 bg-card/20 flex flex-col overflow-hidden"
          >
            <div className="flex-shrink-0 border-b border-border/40 px-3 py-2.5 flex items-center gap-2">
              <motion.div
                className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                animate={{ opacity: [1, 0.4, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Preview</span>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-[10px] text-primary/60 hover:text-primary transition-colors"
              >
                Open ↗
              </a>
              <button
                onClick={() => setShowPreview(false)}
                className="text-muted-foreground/40 hover:text-foreground transition-colors"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="1" y1="1" x2="9" y2="9" /><line x1="9" y1="1" x2="1" y2="9" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden bg-white/5">
              <iframe
                src={previewUrl}
                className="w-full h-full border-0"
                title="Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock allow-top-navigation-by-user-activation"
                referrerPolicy="no-referrer"
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
