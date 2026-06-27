/**
 * LiveLogPanel — collapsible panel showing live execution logs during
 * the build/verify pipeline. Each entry streams in with a timestamp.
 */
import { useEffect, useRef, useState } from "react";

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warn" | "error" | "stage";
  message: string;
}

interface LiveLogPanelProps {
  logs: LogEntry[];
  isActive: boolean;
  currentStage?: string;
}

const LEVEL_STYLES: Record<LogEntry["level"], { dot: string; text: string; prefix: string }> = {
  stage:   { dot: "bg-violet-400",  text: "text-violet-300",     prefix: "▶" },
  success: { dot: "bg-green-400",   text: "text-green-300",      prefix: "✓" },
  info:    { dot: "bg-blue-400",    text: "text-zinc-300",        prefix: "·" },
  warn:    { dot: "bg-yellow-400",  text: "text-yellow-300",      prefix: "!" },
  error:   { dot: "bg-red-400",     text: "text-red-300",         prefix: "✕" },
};

function formatLogTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function LiveLogPanel({ logs, isActive, currentStage }: LiveLogPanelProps) {
  const [open, setOpen] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Auto-scroll unless user has scrolled up
  useEffect(() => {
    if (!userScrolled && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, userScrolled]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setUserScrolled(!atBottom);
  };

  if (!isActive && logs.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-t border-border/50 bg-zinc-950/80">
      {/* Header */}
      <button
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        {isActive && (
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
          </span>
        )}
        {!isActive && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />}
        <span className="flex-1 text-xs font-mono font-medium text-zinc-300">
          {isActive
            ? currentStage
              ? `Running: ${currentStage}`
              : "Execution pipeline…"
            : "Build complete"}
        </span>
        <span className="text-[10px] text-zinc-500 tabular-nums">{logs.length} events</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round"
          className={`text-zinc-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="1,3 5,7 9,3" />
        </svg>
      </button>

      {/* Log list */}
      {open && (
        <div
          ref={containerRef}
          onScroll={handleScroll}
          className="max-h-44 overflow-y-auto px-4 pb-3 font-mono"
        >
          {logs.length === 0 ? (
            <div className="py-3 text-[11px] text-zinc-600 animate-pulse">Waiting for events…</div>
          ) : (
            <div className="flex flex-col gap-0.5 pt-1">
              {logs.map((entry) => {
                const style = LEVEL_STYLES[entry.level];
                return (
                  <div key={entry.id} className="flex items-baseline gap-2 text-[11px] leading-5">
                    <span className="flex-shrink-0 text-zinc-600 tabular-nums text-[10px]">
                      {formatLogTime(entry.timestamp)}
                    </span>
                    <span className={`flex-shrink-0 w-3 text-center ${style.text} opacity-70`}>
                      {style.prefix}
                    </span>
                    <span className={`min-w-0 break-all ${style.text}`}>{entry.message}</span>
                  </div>
                );
              })}
              {isActive && (
                <div className="flex items-center gap-1.5 pt-1 text-[11px] text-zinc-600">
                  <span className="h-1 w-1 rounded-full bg-violet-500 animate-pulse" />
                  <span className="animate-pulse">processing…</span>
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
