/**
 * TaskExecutionPanel
 *
 * Floating panel (bottom-right) that shows all background execution tasks.
 * Independent from the chat — mounts globally and reads from the task store.
 * Supports: minimize, multiple tasks, history view, task drawer.
 */

import { useState, useMemo } from "react";
import { useTaskStore } from "@/lib/task-store";
import { TaskCard } from "./TaskCard";
import { TaskDetailsDrawer } from "./TaskDetailsDrawer";
import type { ExecutionTask } from "@/lib/task-store";

type PanelTab = "active" | "history";

export function TaskExecutionPanel() {
  const { tasks } = useTaskStore();
  const [minimized, setMinimized] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("active");
  const [inspecting, setInspecting] = useState<ExecutionTask | null>(null);

  const visible = tasks.filter((t) => !t.dismissed);
  const activeTasks = visible.filter(
    (t) => t.status === "planning" || t.status === "working" || t.status === "building"
  );
  const completedTasks = visible.filter(
    (t) => t.status === "ready" || t.status === "error" || t.status === "cancelled"
  );

  const displayedActive = useMemo(() => activeTasks.slice(0, 5), [activeTasks]);
  const displayedHistory = useMemo(() => completedTasks.slice(0, 20), [completedTasks]);

  // Don't render at all if nothing to show
  if (visible.length === 0) return null;

  const hasActive = activeTasks.length > 0;

  return (
    <>
      {/* Floating panel */}
      <div
        className="fixed bottom-4 right-4 z-40 flex flex-col"
        style={{ width: minimized ? "auto" : "320px" }}
      >
        {/* Header */}
        <button
          onClick={() => setMinimized((v) => !v)}
          className={`flex items-center gap-2 rounded-xl border border-border/70 bg-card/95 backdrop-blur-md shadow-lg px-3 py-2 transition-all hover:bg-card ${
            !minimized ? "rounded-b-none border-b-0" : ""
          }`}
          aria-label={minimized ? "Expand task panel" : "Minimize task panel"}
        >
          {/* Animated indicator */}
          <div className="relative flex h-4 w-4 items-center justify-center flex-shrink-0">
            {hasActive ? (
              <>
                <span className="absolute h-full w-full animate-ping rounded-full bg-primary/20" />
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              </>
            ) : (
              <span className="h-2.5 w-2.5 rounded-full bg-green-500/80" />
            )}
          </div>

          <span className="text-xs font-semibold text-foreground flex-1 text-left">
            {hasActive
              ? `${activeTasks.length} task${activeTasks.length > 1 ? "s" : ""} running`
              : "Tasks complete"}
          </span>

          {/* Badge counts */}
          <div className="flex items-center gap-1">
            {activeTasks.length > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                {activeTasks.length}
              </span>
            )}
            {completedTasks.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                {completedTasks.length}
              </span>
            )}
          </div>

          {/* Chevron */}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round"
            className={`flex-shrink-0 text-muted-foreground transition-transform duration-200 ${minimized ? "rotate-180" : ""}`}
          >
            <polyline points="2,8 6,4 10,8" />
          </svg>
        </button>

        {/* Body */}
        {!minimized && (
          <div className="rounded-b-xl border border-border/70 border-t-0 bg-card/95 backdrop-blur-md shadow-lg overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b border-border/50 bg-muted/20 px-3">
              <button
                onClick={() => setActiveTab("active")}
                className={`px-2 py-2 text-[11px] font-medium transition-colors relative ${
                  activeTab === "active" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Running
                {activeTasks.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary/15 px-1 text-[9px] text-primary">
                    {activeTasks.length}
                  </span>
                )}
                {activeTab === "active" && (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-primary" />
                )}
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-2 py-2 text-[11px] font-medium transition-colors relative ${
                  activeTab === "history" ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Completed
                {completedTasks.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1 text-[9px] text-muted-foreground">
                    {completedTasks.length}
                  </span>
                )}
                {activeTab === "history" && (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-primary" />
                )}
              </button>
            </div>

            {/* Task list */}
            <div className="max-h-[60vh] overflow-y-auto p-2 flex flex-col gap-2">
              {activeTab === "active" && (
                <>
                  {displayedActive.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="text-2xl mb-1">✓</div>
                      <p className="text-xs text-muted-foreground">No active tasks</p>
                    </div>
                  ) : (
                    displayedActive.map((t) => (
                      <TaskCard key={t.id} task={t} onInspect={setInspecting} />
                    ))
                  )}
                </>
              )}

              {activeTab === "history" && (
                <>
                  {displayedHistory.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <div className="text-2xl mb-1">📋</div>
                      <p className="text-xs text-muted-foreground">No completed tasks yet</p>
                    </div>
                  ) : (
                    displayedHistory.map((t) => (
                      <TaskCard key={t.id} task={t} onInspect={setInspecting} />
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Task details drawer */}
      <TaskDetailsDrawer task={inspecting} onClose={() => setInspecting(null)} />
    </>
  );
}
