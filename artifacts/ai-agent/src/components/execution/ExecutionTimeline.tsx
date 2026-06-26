/**
 * ExecutionTimeline
 * Compact stage-by-stage timeline for the task drawer.
 * Independent from AgentTimeline — uses a simpler, denser layout.
 */

import type { StageState } from "@/components/design-system/AgentTimeline";

function formatDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ExecutionTimelineProps {
  stages: StageState[];
}

export function ExecutionTimeline({ stages }: ExecutionTimelineProps) {
  return (
    <div className="flex flex-col">
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        return (
          <div key={stage.id} className="flex gap-3">
            {/* Left column: dot + line */}
            <div className="flex flex-col items-center w-5 flex-shrink-0">
              <div className="mt-0.5">
                {stage.status === "complete" ? (
                  <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/20 ring-1 ring-green-500/40">
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-green-400">
                      <polyline points="1.5,4 3,5.5 6.5,2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : stage.status === "running" ? (
                  <div className="relative flex h-4 w-4 items-center justify-center">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-primary/20" />
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  </div>
                ) : (
                  <div className="h-4 w-4 rounded-full border border-border bg-muted/30" />
                )}
              </div>
              {!isLast && (
                <div
                  className={`w-px flex-1 min-h-[20px] mt-0.5 transition-colors duration-500 ${
                    stage.status === "complete" ? "bg-green-500/25" : "bg-border/40"
                  }`}
                />
              )}
            </div>

            {/* Right column */}
            <div className="pb-3 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-medium transition-colors ${
                    stage.status === "running"
                      ? "text-primary"
                      : stage.status === "complete"
                      ? "text-foreground/70"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {stage.name}
                </span>
                {stage.status === "running" && stage.action && (
                  <span className="text-[10px] text-primary/60">{stage.action}…</span>
                )}
                {stage.status === "complete" && stage.startedAt && stage.completedAt && (
                  <span className="ml-auto text-[10px] text-muted-foreground/40 tabular-nums flex-shrink-0">
                    {formatDuration(stage.startedAt, stage.completedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
