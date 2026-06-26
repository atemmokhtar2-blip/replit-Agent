/**
 * VerificationCard — Project Ready Card
 *
 * Shown in chat after all 17 verification checks complete.
 * Strict completion policy: never shows "Ready" until allPassed=true.
 *
 * Contains:
 *   - Status header (✅ Project Ready / ✗ Verification Incomplete)
 *   - 17-check grid grouped by domain
 *   - ProjectHealthReport (score gauge + domain breakdown)
 *   - Retry buttons: Retry Build · Retry Verification · Retry Preview
 *   - Open Preview button (only when allPassed=true)
 */

import { useState } from "react";
import type { VerificationCheck, ExecPhase, HealthReport } from "@/lib/task-store";
import { ProjectHealthReport } from "./ProjectHealthReport";

// ── Icons ──────────────────────────────────────────────────────────────────────

function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
      <polyline
        points="1.5,5 3.5,7.5 8.5,2.5"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function CrossIcon({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" fill="none">
      <line x1="1.5" y1="1.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7.5" y1="1.5" x2="1.5" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SkipIcon({ size = 9 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 9 9" fill="none">
      <line x1="2" y1="4.5" x2="7" y2="4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 5a3.5 3.5 0 105.5-2.9" />
      <path d="M6.5 1L7 3.1l-2.1.4" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M4.5 2H2.5A1 1 0 001.5 3v6A1 1 0 002.5 10h6a1 1 0 001-1V7" />
      <path d="M6.5 1.5h3v3" />
      <line x1="9.5" y1="1.5" x2="5" y2="6" />
    </svg>
  );
}

// ── Check row ──────────────────────────────────────────────────────────────────

interface CheckRowProps {
  check: VerificationCheck;
  index: number;
}

function CheckRow({ check, index }: CheckRowProps) {
  const isPassed  = check.status === "pass" || check.status === "fixed";
  const isFailed  = check.status === "fail";
  const isSkipped = check.status === "skip";
  const isActive  = check.status === "checking" || check.status === "fixing";

  return (
    <div
      className="verify-check-row flex items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-all"
      style={{
        animationDelay: `${index * 45}ms`,
        borderColor: isPassed
          ? "rgb(34 197 94 / 0.2)"
          : isFailed
          ? "rgb(239 68 68 / 0.2)"
          : isActive
          ? "rgb(var(--primary) / 0.2)"
          : "rgb(var(--border) / 0.4)",
        background: isPassed
          ? "rgb(34 197 94 / 0.03)"
          : isFailed
          ? "rgb(239 68 68 / 0.03)"
          : "transparent",
      }}
    >
      <div
        className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full"
        style={{
          background: isPassed
            ? "rgb(34 197 94 / 0.18)"
            : isFailed
            ? "rgb(239 68 68 / 0.18)"
            : isActive
            ? "rgb(var(--primary) / 0.18)"
            : "rgb(var(--muted) / 0.5)",
          color: isPassed
            ? "rgb(74 222 128)"
            : isFailed
            ? "rgb(248 113 113)"
            : "rgb(var(--muted-foreground) / 0.5)",
        }}
      >
        {isPassed ? <CheckIcon size={8} /> : isFailed ? <CrossIcon size={7} /> : isActive ? (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        ) : <SkipIcon size={7} />}
      </div>

      <span className="flex-1 text-[11px] font-medium text-foreground/75 truncate">{check.name}</span>

      {check.domain && (
        <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wide hidden sm:block">
          {check.domain}
        </span>
      )}

      {check.detail && (
        <span className="text-[9px] text-muted-foreground/40 font-mono truncate max-w-[90px]">
          {check.detail.slice(0, 28)}
        </span>
      )}

      <span
        className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded flex-shrink-0"
        style={{
          background: isPassed
            ? "rgb(34 197 94 / 0.1)"
            : isFailed
            ? "rgb(239 68 68 / 0.1)"
            : "rgb(var(--muted) / 0.4)",
          color: isPassed
            ? "rgb(74 222 128)"
            : isFailed
            ? "rgb(248 113 113)"
            : "rgb(var(--muted-foreground) / 0.4)",
        }}
      >
        {isSkipped ? "skip" : isActive ? "…" : isPassed ? "✔" : "✗"}
      </span>
    </div>
  );
}

// ── Phase bar ──────────────────────────────────────────────────────────────────

function PhaseBar({ phases }: { phases: ExecPhase[] }) {
  const completed = phases.filter((p) => p.status === "complete").length;
  const total = phases.length;
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 bg-muted/10">
      <div className="flex flex-1 gap-0.5 overflow-hidden rounded-full">
        {phases.map((p) => (
          <div
            key={p.id}
            className="flex-1 h-1 rounded-full transition-all duration-300"
            style={{
              background:
                p.status === "complete" ? "rgb(34 197 94 / 0.7)" :
                p.status === "running"  ? "rgb(var(--primary) / 0.8)" :
                p.status === "failed"   ? "rgb(239 68 68 / 0.5)" :
                "rgb(var(--muted) / 0.25)",
            }}
          />
        ))}
      </div>
      <span className="text-[9px] font-mono text-muted-foreground/40 flex-shrink-0">
        {completed}/{total}
      </span>
      <span className="text-[9px] font-mono text-muted-foreground/30">{pct}%</span>
    </div>
  );
}

// ── Retry buttons ──────────────────────────────────────────────────────────────

interface RetryButtonsProps {
  onRetryBuild?:         () => void;
  onRetryVerification?:  () => void;
  onRetryPreview?:       () => void;
  retrying?: "build" | "verify" | "preview" | null;
}

function RetryButtons({ onRetryBuild, onRetryVerification, onRetryPreview, retrying }: RetryButtonsProps) {
  const btn = (
    label: string,
    key: "build" | "verify" | "preview",
    onClick?: () => void,
  ) => (
    <button
      key={key}
      onClick={onClick}
      disabled={retrying === key}
      className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all hover:bg-muted/30 disabled:opacity-50"
      style={{ borderColor: "rgb(var(--border) / 0.6)", color: "rgb(var(--muted-foreground) / 0.8)" }}
    >
      {retrying === key ? (
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
      ) : (
        <RetryIcon />
      )}
      {retrying === key ? `Retrying ${label}…` : `Retry ${label}`}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-2 px-3 pb-3 pt-1 border-t border-border/30">
      <p className="w-full text-[10px] text-muted-foreground/40 mb-0.5">
        Retry individual layers without restarting the conversation:
      </p>
      {btn("Build",        "build",  onRetryBuild)}
      {btn("Verification", "verify", onRetryVerification)}
      {btn("Preview",      "preview",onRetryPreview)}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export interface VerificationCardProps {
  checks: VerificationCheck[];
  phases?: ExecPhase[];
  allPassed: boolean;
  healthReport?: HealthReport;
  onPreview?: () => void;
  onRetryBuild?: () => void;
  onRetryVerification?: () => void;
  onRetryPreview?: () => void;
}

export function VerificationCard({
  checks,
  phases,
  allPassed,
  healthReport,
  onPreview,
  onRetryBuild,
  onRetryVerification,
  onRetryPreview,
}: VerificationCardProps) {
  const [previewOpened, setPreviewOpened] = useState(false);
  const [retrying, setRetrying] = useState<"build" | "verify" | "preview" | null>(null);
  const [reportExpanded, setReportExpanded] = useState(allPassed);

  const passCount  = checks.filter((c) => c.status === "pass" || c.status === "fixed").length;
  const failCount  = checks.filter((c) => c.status === "fail").length;
  const skipCount  = checks.filter((c) => c.status === "skip").length;

  const handlePreview = () => {
    setPreviewOpened(true);
    onPreview?.();
  };

  const makeRetry = (key: "build" | "verify" | "preview", fn?: () => void) => () => {
    if (!fn) return;
    setRetrying(key);
    fn();
    setTimeout(() => setRetrying(null), 8000);
  };

  return (
    <div
      className="verification-card-enter rounded-xl border overflow-hidden shadow-lg"
      style={{
        borderColor: allPassed ? "rgb(34 197 94 / 0.35)" : "rgb(239 68 68 / 0.35)",
        background: "var(--card)",
      }}
    >
      {/* Top glow stripe */}
      <div
        className="h-0.5"
        style={{
          background: allPassed
            ? "linear-gradient(to right, transparent, rgb(34 197 94 / 0.8), transparent)"
            : "linear-gradient(to right, transparent, rgb(239 68 68 / 0.8), transparent)",
        }}
      />

      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-border/40"
        style={{ background: allPassed ? "rgb(34 197 94 / 0.05)" : "rgb(239 68 68 / 0.05)" }}
      >
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full"
          style={{
            background: allPassed ? "rgb(34 197 94 / 0.2)" : "rgb(239 68 68 / 0.2)",
            boxShadow: allPassed ? "0 0 12px rgb(34 197 94 / 0.3)" : "0 0 12px rgb(239 68 68 / 0.3)",
          }}
        >
          {allPassed ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "rgb(74 222 128)" }}>
              <polyline points="2,7 5,10.5 12,3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: "rgb(248 113 113)" }}>
              <line x1="2.5" y1="2.5" x2="11.5" y2="11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="11.5" y1="2.5" x2="2.5" y2="11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {allPassed ? "Project Ready" : "Verification Incomplete"}
          </p>
          <p className="text-[11px] text-muted-foreground/55 mt-0.5">
            {passCount} passed · {skipCount} skipped{failCount > 0 ? ` · ${failCount} failed` : ""}
            {healthReport && (
              <span className="ml-1.5 font-mono">
                · Health: <span className={
                  healthReport.overallScore >= 80 ? "text-green-400" :
                  healthReport.overallScore >= 60 ? "text-yellow-400" : "text-red-400"
                }>{healthReport.overallScore}%</span>
              </span>
            )}
          </p>
        </div>

        {allPassed && (
          <span
            className="text-[10px] font-bold px-2 py-1 rounded-full flex-shrink-0"
            style={{ background: "rgb(34 197 94 / 0.15)", color: "rgb(74 222 128)" }}
          >
            ✅ READY
          </span>
        )}
      </div>

      {/* Phase bar */}
      {phases && phases.length > 0 && <PhaseBar phases={phases} />}

      {/* Check grid — 2 columns for 17 checks */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2.5">
        {checks.map((check, i) => (
          <CheckRow key={check.id} check={check} index={i} />
        ))}
      </div>

      {/* Health report (collapsible) */}
      {healthReport && (
        <div className="border-t border-border/30">
          <button
            onClick={() => setReportExpanded((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-muted-foreground/60 hover:text-foreground/70 transition-colors hover:bg-muted/10"
          >
            <span className="flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                <rect x="1" y="1" width="9" height="9" rx="1.5" />
                <line x1="3" y1="4" x2="8" y2="4" />
                <line x1="3" y1="6" x2="6" y2="6" />
              </svg>
              Project Health Report
            </span>
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
              style={{ transform: reportExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}
            >
              <polyline points="2,4 5,7 8,4" />
            </svg>
          </button>

          {reportExpanded && (
            <div className="px-2.5 pb-3">
              <ProjectHealthReport report={healthReport} />
            </div>
          )}
        </div>
      )}

      {/* Retry buttons — shown when not all passed */}
      {!allPassed && (
        <RetryButtons
          onRetryBuild={onRetryBuild}
          onRetryVerification={onRetryVerification}
          onRetryPreview={onRetryPreview}
          retrying={retrying}
        />
      )}

      {/* Preview button — only when all passed */}
      {allPassed && (
        <div className="px-3 pb-3 pt-1">
          <button
            onClick={handlePreview}
            disabled={previewOpened}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all"
            style={{
              background: previewOpened
                ? "rgb(34 197 94 / 0.1)"
                : "linear-gradient(135deg, rgb(34 197 94 / 0.85), rgb(16 185 129 / 0.85))",
              color: previewOpened ? "rgb(74 222 128)" : "#000",
              boxShadow: previewOpened ? "none" : "0 2px 12px rgb(34 197 94 / 0.25)",
            }}
          >
            {previewOpened ? (
              <>
                <CheckIcon size={12} />
                Preview Open
              </>
            ) : (
              <>
                <ExternalIcon />
                Open Preview
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── In-progress card (shown during verification) ──────────────────────────────

interface VerificationProgressProps {
  checks: VerificationCheck[];
  phases: ExecPhase[];
  currentPhase?: ExecPhase;
}

export function VerificationProgress({ checks, phases, currentPhase }: VerificationProgressProps) {
  const settledChecks = checks.filter(
    (c) => c.status === "pass" || c.status === "fail" || c.status === "skip" || c.status === "fixed"
  );
  const checkingItem = checks.find((c) => c.status === "checking");
  const isFixing = checks.some((c) => c.status === "fixing");

  return (
    <div className="rounded-xl border border-primary/20 overflow-hidden bg-card/60">
      <div className="h-0.5 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

      {/* Header */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/40 bg-primary/5">
        <div className="relative flex h-4 w-4 items-center justify-center flex-shrink-0">
          <span className="absolute h-full w-full animate-ping rounded-full bg-primary/20" />
          <span className="h-2 w-2 rounded-full bg-primary" />
        </div>
        <span className="text-xs font-semibold text-foreground truncate">
          {isFixing
            ? "Auto-fixing issues…"
            : checkingItem
            ? `Verifying ${checkingItem.name}…`
            : currentPhase
            ? currentPhase.name
            : "Verifying project…"}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/40 flex-shrink-0">
          {settledChecks.length}/{checks.length}
        </span>
      </div>

      {/* Phase strip */}
      {phases.length > 0 && (
        <div className="flex gap-0.5 px-3 py-1.5 border-b border-border/30">
          {phases.map((p) => (
            <div
              key={p.id}
              className="flex-1 h-0.5 rounded-full transition-all duration-300"
              style={{
                background:
                  p.status === "complete" ? "rgb(34 197 94 / 0.7)" :
                  p.status === "running"  ? "rgb(var(--primary) / 0.8)" :
                  p.status === "failed"   ? "rgb(239 68 68 / 0.5)" :
                  "rgb(var(--muted) / 0.3)",
              }}
            />
          ))}
        </div>
      )}

      {/* Check list — settled checks only */}
      {settledChecks.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2">
          {checks.slice(0, settledChecks.length + 1).map((check, i) => (
            <CheckRow key={check.id} check={check} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
