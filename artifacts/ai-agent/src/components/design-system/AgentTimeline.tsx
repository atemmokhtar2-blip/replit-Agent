import { AIPulse } from "./AIPulse";
import { NeuralGrid } from "./NeuralGrid";
import { DataCore } from "./DataCore";
import { FlowEngine } from "./FlowEngine";
import { Guardian } from "./Guardian";
import { LaunchSequence } from "./LaunchSequence";
import { BlueprintCore } from "./BlueprintCore";

export type StageStatus = "pending" | "running" | "complete";

export interface StageState {
  id: number;
  name: string;
  action?: string;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
}

interface AgentTimelineProps {
  stages: StageState[];
  compact?: boolean;
}

const PRIMARY = "#6366f1";
const DIM = "#64748b";

function StageIcon({ stageId, status }: { stageId: number; status: StageStatus }) {
  const active = status === "running";
  const sz = 32;

  switch (stageId) {
    case 1: return <AIPulse size={sz} color={status !== "pending" ? PRIMARY : DIM} active={active} />;
    case 2: return <NeuralGrid width={sz} height={sz} color={status !== "pending" ? PRIMARY : DIM} active={active} />;
    case 3: return <FlowEngine width={sz} height={sz} color={status !== "pending" ? PRIMARY : DIM} active={active} />;
    case 4: return <DataCore size={sz} color={status !== "pending" ? PRIMARY : DIM} active={active} />;
    case 5: return <FlowEngine width={sz} height={sz} color={status !== "pending" ? "#06b6d4" : DIM} active={active} />;
    case 6: return <Guardian size={sz} color={status !== "pending" ? "#10b981" : DIM} active={active} />;
    case 7: return <LaunchSequence size={sz} color={status !== "pending" ? "#f59e0b" : DIM} active={active} progress={status === "complete" ? 1 : status === "running" ? 0.6 : 0} />;
    case 8: return <BlueprintCore size={sz} color={status === "complete" ? "#22c55e" : status === "running" ? PRIMARY : DIM} active={active} complete={status === "complete"} />;
    default: return <AIPulse size={sz} color={DIM} active={false} />;
  }
}

function StatusDot({ status }: { status: StageStatus }) {
  if (status === "complete") {
    return (
      <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/20 ring-1 ring-green-500/50">
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="text-green-400">
          <polyline points="1.5,4 3,5.5 6.5,2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="relative flex h-4 w-4 items-center justify-center">
        <span className="absolute h-full w-full animate-ping rounded-full bg-primary/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
      </div>
    );
  }
  return <div className="h-4 w-4 rounded-full border border-border bg-muted/40" />;
}

function ScanningDots() {
  return (
    <span className="inline-flex items-center gap-[3px] ml-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="agent-dot inline-block w-[3px] h-[3px] rounded-full bg-primary/70"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function AgentTimeline({ stages, compact = false }: AgentTimelineProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1 overflow-x-auto py-2 px-1">
        {stages.map((stage, i) => (
          <div key={stage.id} className="flex items-center gap-1">
            <div className="flex flex-col items-center gap-0.5">
              <StatusDot status={stage.status} />
              <span
                className={`text-[9px] font-medium truncate max-w-[52px] text-center leading-tight transition-colors duration-300 ${
                  stage.status === "running"
                    ? "text-primary"
                    : stage.status === "complete"
                    ? "text-foreground/60"
                    : "text-muted-foreground/40"
                }`}
              >
                {stage.status === "running" && stage.action
                  ? stage.action
                  : stage.name.split(" ")[0]}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div
                className={`h-px w-4 flex-shrink-0 transition-colors duration-500 ${
                  stage.status === "complete" ? "bg-green-500/40" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 py-2">
      {stages.map((stage, i) => {
        const isLast = i === stages.length - 1;
        return (
          <div key={stage.id} className="flex gap-3">
            {/* Left column: connector line + icon */}
            <div className="flex flex-col items-center">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                <StageIcon stageId={stage.id} status={stage.status} />
              </div>
              {!isLast && (
                <div
                  className={`w-px flex-1 min-h-[16px] mt-0.5 transition-colors duration-500 ${
                    stage.status === "complete" ? "bg-green-500/30" : "bg-border/40"
                  }`}
                />
              )}
            </div>

            {/* Right column: stage info */}
            <div className="flex flex-col pb-4">
              <div className="flex items-center gap-2 mt-1">
                <StatusDot status={stage.status} />
                <span
                  className={`text-xs font-medium transition-colors duration-300 ${
                    stage.status === "running"
                      ? "text-primary"
                      : stage.status === "complete"
                      ? "text-foreground/70"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {stage.name}
                </span>
              </div>

              {/* Running state: action verb + scanning dots */}
              {stage.status === "running" && (
                <div className="ml-6 mt-0.5 flex items-center gap-1">
                  <span className="text-[10px] text-primary/70 font-medium tracking-wide">
                    {stage.action ?? "Processing"}
                  </span>
                  <ScanningDots />
                </div>
              )}

              {/* Complete state: timestamp */}
              {stage.status === "complete" && (
                <div className="ml-6 mt-0.5 flex items-center gap-1.5">
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                    className="text-green-400/60 flex-shrink-0"
                  >
                    <circle cx="4" cy="4" r="3.5" stroke="currentColor" strokeWidth="0.8" />
                    <path d="M4 2.5V4L5 5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
                  </svg>
                  <span className="text-[10px] text-muted-foreground/40 tabular-nums">
                    {stage.completedAt
                      ? formatTimestamp(stage.completedAt)
                      : "Complete"}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
