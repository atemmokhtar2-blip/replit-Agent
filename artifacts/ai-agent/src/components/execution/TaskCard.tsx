/**
 * TaskCard
 *
 * Individual floating card showing a single background task.
 * Clicking it opens the TaskDetailsDrawer.
 */

import React from "react";
import { ExecutionStatusBadge } from "./ExecutionStatusBadge";
import { ExecutionProgress } from "./ExecutionProgress";
import type { ExecutionTask } from "@/lib/task-store";
import { useTaskActions } from "@/lib/task-store";

interface TaskCardProps {
  task: ExecutionTask;
  onInspect: (task: ExecutionTask) => void;
}

function formatElapsed(start: string, end?: string): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

const STATUS_ICONS: Record<string, React.ReactElement> = {
  ready: (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-green-400">
        <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  ),
  error: (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-red-400">
        <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  ),
  cancelled: (
    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted/50">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-muted-foreground/50">
        <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </div>
  ),
};

export function TaskCard({ task, onInspect }: TaskCardProps) {
  const { dismissTask } = useTaskActions();
  const isActive = task.status === "planning" || task.status === "working" || task.status === "building";
  const isDone = task.status === "ready" || task.status === "error" || task.status === "cancelled";
  const runningStage = task.stages.find((s) => s.status === "running");

  return (
    <div
      className={`group relative rounded-xl border bg-card/95 backdrop-blur-sm shadow-lg overflow-hidden transition-all duration-200 hover:shadow-xl ${
        isActive
          ? "border-primary/30 ring-1 ring-primary/10"
          : task.status === "error"
          ? "border-red-500/30"
          : "border-border/60"
      }`}
    >
      {/* Active glow line */}
      {isActive && (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent opacity-60" />
      )}

      {/* Card body */}
      <button
        className="w-full text-left p-3"
        onClick={() => onInspect(task)}
        aria-label={`Inspect task: ${task.title}`}
      >
        {/* Top row: icon + title + dismiss */}
        <div className="flex items-start gap-2 mb-2">
          <div className="flex-shrink-0 mt-0.5">
            {STATUS_ICONS[task.status] ?? (
              <div className="relative flex h-5 w-5 items-center justify-center">
                <span className="absolute h-full w-full animate-ping rounded-full bg-primary/15" />
                <span className="h-3 w-3 rounded-full bg-primary/80" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-foreground leading-tight truncate">{task.title}</p>
            {runningStage ? (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
                {runningStage.action ?? runningStage.name}…
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                {formatElapsed(task.startedAt, task.completedAt)}
              </p>
            )}
          </div>
          {isDone && (
            <button
              onClick={(e) => { e.stopPropagation(); dismissTask(task.id); }}
              className="flex-shrink-0 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
              aria-label="Dismiss"
            >
              <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1" x2="8" y2="8" />
                <line x1="8" y1="1" x2="1" y2="8" />
              </svg>
            </button>
          )}
        </div>

        {/* Progress bar */}
        <ExecutionProgress value={task.progress} status={task.status} showLabel />

        {/* Bottom row: status + stages count */}
        <div className="flex items-center justify-between mt-2">
          <ExecutionStatusBadge status={task.status} />
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">
            {task.stages.filter((s) => s.status === "complete").length}/{task.stages.length} stages
          </span>
        </div>
      </button>

      {/* Inspect button at bottom (visible on hover) */}
      <div className="border-t border-border/40 bg-muted/20 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onInspect(task)}
          className="flex w-full items-center justify-center gap-1.5 py-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
            <circle cx="5" cy="4.5" r="3" />
            <line x1="5" y1="8" x2="5" y2="9.5" />
          </svg>
          Click to inspect
        </button>
      </div>
    </div>
  );
}
