/**
 * ProjectHealthReport
 *
 * Renders the full health report after all verification checks complete.
 *
 * Shows:
 *   - Overall health % score with animated ring gauge
 *   - Production Readiness status
 *   - Domain breakdown: Build, TypeScript, Frontend, Backend, Database,
 *     Security, Performance, Accessibility, Routing
 *   - Pass / warn / fail indicators per domain
 */

import type { HealthReport, DomainScore } from "@/lib/task-store";

// ── Score ring ─────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 80 }: { score: number; size?: number }) {
  const radius = (size - 10) / 2;
  const circ = 2 * Math.PI * radius;
  const filled = circ * (score / 100);
  const color =
    score >= 80 ? "rgb(34 197 94)"
    : score >= 60 ? "rgb(234 179 8)"
    : "rgb(239 68 68)";
  const glow =
    score >= 80 ? "rgb(34 197 94 / 0.3)"
    : score >= 60 ? "rgb(234 179 8 / 0.3)"
    : "rgb(239 68 68 / 0.3)";

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="rgb(var(--muted) / 0.3)" strokeWidth={6}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circ}`}
          style={{
            filter: `drop-shadow(0 0 4px ${glow})`,
            transition: "stroke-dasharray 1s ease",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-bold leading-none" style={{ color }}>{score}</span>
        <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider">score</span>
      </div>
    </div>
  );
}

// ── Domain status colors ───────────────────────────────────────────────────────

function domainColor(status: DomainScore["status"]) {
  switch (status) {
    case "pass": return { bar: "rgb(34 197 94)", bg: "rgb(34 197 94 / 0.12)", text: "rgb(74 222 128)" };
    case "warn": return { bar: "rgb(234 179 8)",  bg: "rgb(234 179 8 / 0.12)",  text: "rgb(250 204 21)" };
    case "fail": return { bar: "rgb(239 68 68)",  bg: "rgb(239 68 68 / 0.12)",  text: "rgb(248 113 113)" };
    case "skip": return { bar: "rgb(var(--muted))", bg: "rgb(var(--muted) / 0.12)", text: "rgb(var(--muted-foreground) / 0.5)" };
  }
}

const DOMAIN_ICONS: Record<string, string> = {
  build:         "⚙",
  typescript:    "TS",
  frontend:      "◈",
  backend:       "◇",
  database:      "⊕",
  security:      "⊗",
  performance:   "⚡",
  accessibility: "⊙",
  routing:       "⇌",
};

// ── Domain row ─────────────────────────────────────────────────────────────────

function DomainRow({ domain, index }: { domain: DomainScore; index: number }) {
  const colors = domainColor(domain.status);
  const icon = DOMAIN_ICONS[domain.domain] ?? "●";

  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-all"
      style={{
        background: colors.bg,
        animationDelay: `${index * 50}ms`,
      }}
    >
      {/* Icon */}
      <div
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[10px] font-bold"
        style={{ background: `${colors.bar}18`, color: colors.text }}
      >
        {icon}
      </div>

      {/* Label */}
      <span className="flex-1 text-xs font-medium text-foreground/80 truncate">{domain.label}</span>

      {/* Score bar */}
      <div className="flex items-center gap-1.5">
        <div className="w-16 h-1 rounded-full bg-muted/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${domain.score}%`, background: colors.bar }}
          />
        </div>
        <span className="text-[10px] font-mono w-7 text-right" style={{ color: colors.text }}>
          {domain.status === "skip" ? "—" : `${domain.score}%`}
        </span>
      </div>

      {/* Status badge */}
      <span
        className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
        style={{ background: `${colors.bar}20`, color: colors.text }}
      >
        {domain.status}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface ProjectHealthReportProps {
  report: HealthReport;
}

export function ProjectHealthReport({ report }: ProjectHealthReportProps) {
  const isReady = report.productionReady;

  return (
    <div className="flex flex-col gap-3">
      {/* Header row: score + summary */}
      <div className="flex items-center gap-4 px-1">
        <ScoreRing score={report.overallScore} />

        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full"
              style={{
                background: isReady ? "rgb(34 197 94 / 0.15)" : "rgb(239 68 68 / 0.15)",
                color: isReady ? "rgb(74 222 128)" : "rgb(248 113 113)",
              }}
            >
              {isReady ? "Production Ready" : "Not Ready"}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50 font-mono">
            <span className="text-green-400">{report.passedChecks} passed</span>
            {report.failedChecks > 0 && (
              <span className="text-red-400">{report.failedChecks} failed</span>
            )}
            {report.skippedChecks > 0 && (
              <span>{report.skippedChecks} skipped</span>
            )}
            {report.fixesApplied > 0 && (
              <span className="text-violet-400">{report.fixesApplied} auto-fixed</span>
            )}
          </div>

          <div className="text-[9px] text-muted-foreground/30 font-mono">
            Build: <span className={
              report.buildStatus === "pass" ? "text-green-400" :
              report.buildStatus === "warn" ? "text-yellow-400" : "text-red-400"
            }>{report.buildStatus}</span>
            &nbsp;·&nbsp;
            {new Date(report.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </div>
      </div>

      {/* Domain breakdown */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/30 px-1 mb-0.5">
          Domain Scores
        </p>
        {report.domains.map((domain, i) => (
          <DomainRow key={domain.domain} domain={domain} index={i} />
        ))}
      </div>
    </div>
  );
}
