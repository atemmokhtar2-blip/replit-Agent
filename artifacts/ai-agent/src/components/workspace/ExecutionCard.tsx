/**
 * ExecutionCard — the core Live Execution Card component.
 *
 * Each AI action produces one card. Cards slide in with Framer Motion,
 * update in real-time, and are expandable / collapsible.
 * Nothing is hardcoded — all content comes from live state.
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CardType =
  | "user-message"
  | "thinking"
  | "planning"
  | "blueprint"
  | "execution"
  | "verification"
  | "fix"
  | "health"
  | "complete"
  | "error"
  | "conversation";

export type CardStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

export interface VerifyCheckItem {
  id: string;
  name: string;
  domain?: string;
  status: "pending" | "checking" | "pass" | "fail" | "skip" | "fixing" | "fixed";
  detail?: string;
}

export interface LiveCard {
  id: string;
  type: CardType;
  title: string;
  subtitle?: string;
  status: CardStatus;
  progress: number;
  logs: string[];
  content?: string;
  model?: string;
  startedAt: string;
  finishedAt?: string;
  expanded: boolean;
  stageId?: number;
  execStageId?: number;
  checks?: VerifyCheckItem[];
  previewUrl?: string;
  allPassed?: boolean;
  userMessage?: string;
}

// ── Card config ───────────────────────────────────────────────────────────────

const CARD_CONFIG: Record<CardType, { color: string; borderColor: string; bgColor: string }> = {
  "user-message": { color: "text-muted-foreground", borderColor: "border-border/40", bgColor: "bg-muted/20" },
  thinking:    { color: "text-violet-400", borderColor: "border-violet-500/30", bgColor: "bg-violet-500/5" },
  planning:    { color: "text-primary",    borderColor: "border-primary/30",     bgColor: "bg-primary/5" },
  blueprint:   { color: "text-emerald-400", borderColor: "border-emerald-500/30", bgColor: "bg-emerald-500/5" },
  execution:   { color: "text-amber-400",  borderColor: "border-amber-500/30",   bgColor: "bg-amber-500/5" },
  verification: { color: "text-cyan-400", borderColor: "border-cyan-500/30",    bgColor: "bg-cyan-500/5" },
  fix:         { color: "text-orange-400", borderColor: "border-orange-500/30",  bgColor: "bg-orange-500/5" },
  health:      { color: "text-teal-400",   borderColor: "border-teal-500/30",    bgColor: "bg-teal-500/5" },
  complete:    { color: "text-emerald-400", borderColor: "border-emerald-500/30", bgColor: "bg-emerald-500/5" },
  error:       { color: "text-red-400",    borderColor: "border-red-500/30",     bgColor: "bg-red-500/5" },
  conversation: { color: "text-primary",   borderColor: "border-primary/30",     bgColor: "bg-primary/5" },
};

// ── Icons ─────────────────────────────────────────────────────────────────────

function CardIcon({ type, status, size = 14 }: { type: CardType; status: CardStatus; size?: number }) {
  const s = size;
  const cfg = CARD_CONFIG[type];

  if (status === "running") {
    return (
      <motion.div
        className={`h-2 w-2 rounded-full ${type === "thinking" ? "bg-violet-400" : type === "execution" ? "bg-amber-400" : type === "fix" ? "bg-orange-400" : "bg-primary"}`}
        animate={{ opacity: [1, 0.3, 1] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }

  if (status === "complete") {
    return (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-emerald-400">
        <polyline points="2,7 5.5,10.5 12,3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (status === "failed") {
    return (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-red-400">
        <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  // Type-based static icons
  const icons: Record<CardType, React.ReactNode> = {
    "user-message": (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className={cfg.color}>
        <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M2 12c0-2.76 2.24-5 5-5s5 2.24 5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
    thinking: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-violet-400">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 6c0-1.1.9-2 2-2s2 .9 2 2c0 .8-.5 1.5-1.2 1.8L7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7.5" cy="10" r="0.7" fill="currentColor" />
      </svg>
    ),
    planning: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-primary">
        <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <line x1="4" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="4" y1="7.5" x2="10" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="4" y1="10" x2="7" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    blueprint: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-emerald-400">
        <path d="M8 1.5H3a1 1 0 00-1 1v9a1 1 0 001 1h8a1 1 0 001-1V6.5L8 1.5z" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 1.5V6.5H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        <line x1="4.5" y1="8.5" x2="9.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="4.5" y1="10.5" x2="7" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
    execution: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-amber-400">
        <path d="M7.5 1.5L2 8h5l-1 4.5 6-7H7L7.5 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    verification: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-cyan-400">
        <path d="M7 1.5L2 3.5v4.5c0 2.5 2.2 4.8 5 5.5 2.8-.7 5-3 5-5.5V3.5L7 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
    fix: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-orange-400">
        <path d="M9 2.5A3.5 3.5 0 005.5 7c0 .4.06.77.17 1.12L2 11.8 2.2 12 3 12.8l3.88-3.67A3.5 3.5 0 109 2.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
    health: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-teal-400">
        <path d="M1 7h2.5l1.5-3 2 6 1.5-4.5L10 7h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
    complete: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-emerald-400">
        <path d="M7 1L8.8 5.4L13 7L8.8 8.6L7 13L5.2 8.6L1 7L5.2 5.4L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    ),
    error: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-red-400">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3" />
        <line x1="7" y1="4.5" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="9.5" r="0.7" fill="currentColor" />
      </svg>
    ),
    conversation: (
      <svg width={s} height={s} viewBox="0 0 14 14" fill="none" className="text-primary">
        <path d="M2 2.5h10a1 1 0 011 1v5a1 1 0 01-1 1H8.5l-2 2-2-2H2a1 1 0 01-1-1v-5a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
  };

  return <>{icons[type]}</>;
}

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CardStatus }) {
  const config = {
    pending:   { label: "Pending",    cls: "bg-muted/40 text-muted-foreground/60" },
    running:   { label: "Running",    cls: "bg-primary/15 text-primary" },
    complete:  { label: "Complete",   cls: "bg-emerald-500/15 text-emerald-400" },
    failed:    { label: "Failed",     cls: "bg-red-500/15 text-red-400" },
    cancelled: { label: "Cancelled",  cls: "bg-muted/40 text-muted-foreground/60" },
  }[status];

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${config.cls}`}>
      {config.label}
    </span>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function ProgressBar({ progress, status }: { progress: number; status: CardStatus }) {
  if (status === "pending") return null;

  return (
    <div className="h-0.5 w-full rounded-full bg-border/30 overflow-hidden">
      {status === "running" && progress <= 0 ? (
        <motion.div
          className="h-full w-1/3 rounded-full bg-primary/60"
          animate={{ x: ["0%", "200%", "0%"] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : (
        <motion.div
          className={`h-full rounded-full ${status === "failed" ? "bg-red-500/60" : status === "complete" ? "bg-emerald-500/60" : "bg-primary/60"}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(progress, 100)}%` }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        />
      )}
    </div>
  );
}

// ── Duration display ───────────────────────────────────────────────────────────

function useLiveDuration(startedAt: string, finishedAt?: string): string {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (finishedAt) {
      const dur = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
      setElapsed(dur);
      return;
    }
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [startedAt, finishedAt]);

  if (elapsed < 1000) return `${elapsed}ms`;
  if (elapsed < 60000) return `${(elapsed / 1000).toFixed(1)}s`;
  return `${Math.floor(elapsed / 60000)}m ${Math.round((elapsed % 60000) / 1000)}s`;
}

// ── Log stream ─────────────────────────────────────────────────────────────────

function LogStream({ logs, isRunning }: { logs: string[]; isRunning: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs.length]);

  if (logs.length === 0 && !isRunning) return null;

  return (
    <div className="rounded-lg border border-border/20 bg-black/20 overflow-hidden">
      <div className="max-h-40 overflow-y-auto px-3 py-2 space-y-0.5 font-mono text-[11px]">
        <AnimatePresence initial={false}>
          {logs.map((log, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className={`leading-relaxed ${log.startsWith("ERROR") || log.startsWith("✗") ? "text-red-400/80" : log.startsWith("WARN") ? "text-amber-400/80" : log.startsWith("✓") ? "text-emerald-400/80" : "text-muted-foreground/60"}`}
            >
              <span className="text-muted-foreground/30 mr-2 select-none">›</span>
              {log}
            </motion.div>
          ))}
        </AnimatePresence>
        {isRunning && (
          <motion.div
            className="text-muted-foreground/30 flex items-center gap-1"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          >
            <span className="select-none">›</span>
            <span className="inline-block w-2 h-2.5 bg-primary/50 rounded-sm" />
          </motion.div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ── Verification checklist ────────────────────────────────────────────────────

function CheckList({ checks }: { checks: VerifyCheckItem[] }) {
  const statusConfig = {
    pending:  { icon: "○", cls: "text-muted-foreground/40" },
    checking: { icon: "◌", cls: "text-primary animate-pulse" },
    pass:     { icon: "✓", cls: "text-emerald-400" },
    fail:     { icon: "✗", cls: "text-red-400" },
    skip:     { icon: "—", cls: "text-muted-foreground/30" },
    fixing:   { icon: "⟳", cls: "text-orange-400 animate-spin" },
    fixed:    { icon: "✓", cls: "text-teal-400" },
  };

  const grouped: Record<string, VerifyCheckItem[]> = {};
  for (const c of checks) {
    const d = c.domain ?? "other";
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(c);
  }

  return (
    <div className="space-y-2">
      {Object.entries(grouped).map(([domain, items]) => (
        <div key={domain}>
          <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40 mb-1">{domain}</div>
          <div className="space-y-0.5">
            <AnimatePresence initial={false}>
              {items.map((check) => {
                const cfg = statusConfig[check.status] ?? statusConfig.pending;
                return (
                  <motion.div
                    key={check.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-start gap-2"
                  >
                    <span className={`mt-px text-[11px] font-mono flex-shrink-0 w-3 text-center ${cfg.cls}`}>{cfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] text-foreground/70 leading-snug">{check.name}</span>
                      {check.detail && check.status === "fail" && (
                        <div className="text-[10px] text-red-400/70 mt-0.5 truncate">{check.detail}</div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Blueprint preview ─────────────────────────────────────────────────────────

function BlueprintPreview({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);
  const sections = content.match(/^##\s+\d+\.\s+.+$/gm) ?? [];

  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/50">{sections.length} sections generated</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="3" y="3" width="6" height="6" rx="1" />
            <path d="M2 7H1.5A.5.5 0 011 6.5V1.5A.5.5 0 011.5 1h5A.5.5 0 017 1.5V2" />
          </svg>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {sections.length > 0 && (
        <div className="space-y-0.5">
          {sections.slice(0, 6).map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="text-primary/30 font-mono w-3 text-right">{i + 1}</span>
              <span className="text-muted-foreground/60 truncate">{s.replace(/^##\s+\d+\.\s+/, "")}</span>
            </div>
          ))}
          {sections.length > 6 && (
            <div className="text-[10px] text-muted-foreground/30 pl-5">+{sections.length - 6} more sections</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Streaming content preview ─────────────────────────────────────────────────

function StreamingContent({ content, isRunning }: { content: string; isRunning: boolean }) {
  if (!content && !isRunning) return null;
  const preview = content.slice(-300);

  return (
    <div className="rounded-lg border border-border/20 bg-black/10 px-3 py-2 max-h-28 overflow-hidden relative">
      <p className="text-[11px] text-muted-foreground/60 leading-relaxed whitespace-pre-wrap font-mono">{preview}</p>
      {isRunning && (
        <span className="inline-block w-1 h-3 bg-primary/60 animate-pulse align-text-bottom ml-0.5" />
      )}
      <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-card/80 to-transparent" />
    </div>
  );
}

// ── Main ExecutionCard ────────────────────────────────────────────────────────

interface ExecutionCardProps {
  card: LiveCard;
  onToggleExpand: (id: string) => void;
}

export function ExecutionCard({ card, onToggleExpand }: ExecutionCardProps) {
  const { id, type, title, subtitle, status, progress, logs, content, startedAt, finishedAt, expanded, checks, allPassed, previewUrl } = card;
  const duration = useLiveDuration(startedAt, finishedAt);
  const cfg = CARD_CONFIG[type];
  const isRunning = status === "running";

  if (type === "user-message") {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="flex justify-end"
      >
        <div className="max-w-[75%] rounded-xl border border-border/40 bg-muted/30 px-4 py-2.5">
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={`rounded-xl border ${cfg.borderColor} ${cfg.bgColor} overflow-hidden`}
    >
      {/* Running accent line */}
      {isRunning && (
        <motion.div
          className={`h-0.5 w-full ${type === "thinking" ? "bg-violet-500/50" : type === "execution" ? "bg-amber-500/50" : type === "fix" ? "bg-orange-500/50" : type === "error" ? "bg-red-500/50" : "bg-primary/50"}`}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}

      {/* Card header */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer hover:bg-white/3 transition-colors select-none"
        onClick={() => onToggleExpand(id)}
      >
        {/* Icon */}
        <div className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md ${cfg.bgColor} border ${cfg.borderColor}`}>
          <CardIcon type={type} status={status} size={12} />
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">{title}</span>
            {subtitle && (
              <span className="text-[10px] text-muted-foreground/40 truncate hidden sm:inline">{subtitle}</span>
            )}
          </div>
        </div>

        {/* Status + Duration */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/40 font-mono tabular-nums">{duration}</span>
          <StatusBadge status={status} />
          <motion.svg
            width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            className="text-muted-foreground/40"
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <polyline points="1,3 5,7 9,3" />
          </motion.svg>
        </div>
      </div>

      {/* Progress bar */}
      <div className="px-3.5 pb-1">
        <ProgressBar progress={progress} status={status} />
      </div>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-border/20">
              {/* Streaming content for planning/thinking */}
              {(type === "planning" || type === "thinking") && content && (
                <StreamingContent content={content} isRunning={isRunning} />
              )}

              {/* Blueprint sections */}
              {type === "blueprint" && content && (
                <BlueprintPreview content={content} />
              )}

              {/* Conversation content */}
              {type === "conversation" && content && (
                <div className="text-sm text-muted-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {content}
                </div>
              )}

              {/* Verification checks */}
              {(type === "verification" || type === "fix") && checks && checks.length > 0 && (
                <CheckList checks={checks} />
              )}

              {/* Complete/error summary */}
              {type === "complete" && (
                <div className="flex items-center gap-3 flex-wrap">
                  <div className={`flex items-center gap-1.5 text-xs ${allPassed ? "text-emerald-400" : "text-amber-400"}`}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      {allPassed
                        ? <polyline points="2,6 5,9 10,3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        : <path d="M6 2v5M6 9.5v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      }
                    </svg>
                    {allPassed ? "All checks passed" : "Some checks failed"}
                  </div>
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/15 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                        <path d="M1 5.5h8M5.5 2l3.5 3.5L5.5 9" />
                      </svg>
                      Open Preview
                    </a>
                  )}
                </div>
              )}

              {type === "error" && content && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400/80 font-mono">
                  {content}
                </div>
              )}

              {/* Logs */}
              {logs.length > 0 && (
                <LogStream logs={logs} isRunning={isRunning} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
