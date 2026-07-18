/**
 * Execution Pipeline Streaming Client
 *
 * Reads the SSE stream from POST /api/v1/ai/execute/stream.
 * Mirrors the planner-stream.ts pattern.
 *
 * Event catalog:
 *   exec_stage_start/complete/fail  — 12-stage pipeline progress
 *   verify_check                    — individual check status (checking/pass/fail/skip)
 *   fix_attempt / fix_result        — self-healing loop events
 *   health_report                   — project health score + domain breakdown
 *   exec_done                       — pipeline complete with final checks + report
 *   exec_error                      — unrecoverable error (retryable flag)
 */

export type ExecVerifyStatus =
  | "pass" | "fail" | "skip" | "checking" | "fixing" | "fixed" | "unfixable";

export interface VerificationCheckResult {
  id: string;
  name: string;
  domain: string;
  status: "pass" | "fail" | "skip";
  detail: string;
  duration: number;
  fixAttempts: number;
}

export type HealthDomainStatus = "pass" | "warn" | "fail" | "skip";

export interface DomainScore {
  domain: string;
  label: string;
  score: number;
  status: HealthDomainStatus;
  checksTotal: number;
  checksPassed: number;
}

export interface HealthReport {
  overallScore: number;
  productionReady: boolean;
  buildStatus: "pass" | "fail" | "warn";
  domains: DomainScore[];
  totalChecks: number;
  passedChecks: number;
  skippedChecks: number;
  failedChecks: number;
  fixesApplied: number;
  generatedAt: string;
}

export interface ProductionGate {
  buildSuccessful:            boolean;
  runtimeHealthy:             boolean;
  previewResponding:          boolean;
  routesVerified:             boolean;
  apiVerified:                boolean;
  databaseHealthy:            boolean;
  assetsLoaded:               boolean;
  noCriticalErrors:           boolean;
  productionValidationPassed: boolean;
  allGatesPassed:             boolean;
}

export type ExecutionStreamEvent =
  | { type: "exec_stage_start";    stage: number; stageName: string; stageLabel: string }
  | { type: "exec_stage_complete"; stage: number; duration: number }
  | { type: "exec_stage_fail";     stage: number; error: string; duration?: number }
  | { type: "verify_check";        check: string; checkName: string; checkDomain?: string; status: ExecVerifyStatus; detail?: string }
  | { type: "fix_attempt";         check: string; checkName?: string; checkDomain?: string; strategy: string; iteration?: number }
  | { type: "fix_result";          check: string; status: "fixed" | "unfixable" | "fixing"; strategy: string; iteration?: number }
  | { type: "health_report";       healthReport: HealthReport }
  | { type: "production_gate";     productionGate: ProductionGate }
  | { type: "exec_done";           checks: VerificationCheckResult[]; healthReport?: HealthReport; allPassed: boolean; previewUrl?: string; productionGate?: ProductionGate }
  | { type: "exec_error";          message: string; retryable?: boolean };

export const EXEC_STAGE_LABELS: Record<number, { name: string; label: string }> = {
  1:  { name: "Planning",            label: "Planning"   },
  2:  { name: "Generating Files",    label: "Generating" },
  3:  { name: "Installing",          label: "Installing" },
  4:  { name: "Building",            label: "Building"   },
  5:  { name: "Linting",             label: "Linting"    },
  6:  { name: "Type Checking",       label: "Checking"   },
  7:  { name: "Testing",             label: "Testing"    },
  8:  { name: "Starting Server",     label: "Starting"   },
  9:  { name: "Building Production", label: "Bundling"   },
  10: { name: "Verifying",           label: "Verifying"  },
  11: { name: "Routing",             label: "Routing"    },
  12: { name: "APIs",               label: "APIs"       },
  13: { name: "Health Check",        label: "Health"     },
  14: { name: "Endpoint Verify",     label: "Endpoints"  },
  15: { name: "Auto Debug",          label: "Debugging"  },
  16: { name: "Auto Fix & Rebuild",  label: "Repairing"  },
  17: { name: "Final Verification",  label: "Finalizing" },
};

export const DOMAIN_META: Record<string, { label: string; icon: string; color: string }> = {
  build:         { label: "Build",          icon: "⚙",  color: "amber"  },
  typescript:    { label: "TypeScript",     icon: "TS", color: "blue"   },
  frontend:      { label: "Frontend",       icon: "⬡",  color: "violet" },
  backend:       { label: "Backend",        icon: "⬙",  color: "indigo" },
  database:      { label: "Database",       icon: "⊕",  color: "cyan"   },
  security:      { label: "Security",       icon: "⊗",  color: "rose"   },
  performance:   { label: "Performance",    icon: "⚡",  color: "yellow" },
  accessibility: { label: "Accessibility",  icon: "⊙",  color: "teal"   },
  routing:       { label: "Routing",        icon: "⇌",  color: "sky"    },
};

export async function streamToExecutionEngine(
  conversationId: string,
  blueprint: string,
  onEvent: (event: ExecutionStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { getAccessToken } = await import("./token-manager");
  const token = await getAccessToken();

  const response = await fetch("/api/v1/ai/execute/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversation_id: conversationId, blueprint }),
    signal,
  });

  if (!response.ok) {
    let errorMsg = `Execution request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) errorMsg = body.error;
    } catch { /* ignore */ }
    throw new Error(errorMsg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const event = JSON.parse(data) as ExecutionStreamEvent;
          onEvent(event);
        } catch { /* malformed — skip */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
