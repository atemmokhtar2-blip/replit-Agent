import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModelEntry {
  id: string;
  name: string;
  provider_slug: string;
  model_id: string;
  task_affinity: string[];
  priority: number;
  fallback_priority: number;
  enabled: boolean;
  status: "available" | "degraded" | "offline" | "unknown";
  is_free: boolean;
  max_tokens: number;
  tags: string[];
  health: {
    uptime_pct: number;
    success_rate: number;
    avg_response_ms: number;
    total_requests: number;
    active_requests: number;
  };
}

interface AgentSummary {
  agent_type: string;
  name: string;
  description: string;
  supported_task_types: string[];
  preferred_models: { id: string; name: string; model_id: string; is_free: boolean; status: string }[];
}

interface HealthReport {
  registry_entry_id: string;
  name: string;
  provider_slug: string;
  status: string;
  uptime_pct: number;
  success_rate: number;
  error_rate: number;
  avg_response_ms: number;
  total_requests: number;
  active_requests: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}

interface ExecutionRecord {
  id: string;
  agent_type: string;
  task_type: string;
  provider_slug: string;
  model_id: string;
  status: string;
  latency_ms: number | null;
  retries: number;
  failovers: number;
  request_summary: string | null;
  routing_rationale: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...authHeader(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; dot: string; label: string }> = {
    available: { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400", label: "Live" },
    degraded:  { color: "bg-yellow-500/10  text-yellow-400  border-yellow-500/20",  dot: "bg-yellow-400",  label: "Degraded" },
    offline:   { color: "bg-red-500/10     text-red-400     border-red-500/20",     dot: "bg-red-400",     label: "Offline" },
    unknown:   { color: "bg-muted/60 text-muted-foreground border-border",           dot: "bg-muted-foreground", label: "Unknown" },
    completed: { color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400", label: "Done" },
    failed:    { color: "bg-red-500/10     text-red-400     border-red-500/20",     dot: "bg-red-400",     label: "Failed" },
    running:   { color: "bg-blue-500/10    text-blue-400    border-blue-500/20",    dot: "bg-blue-400",    label: "Running" },
    pending:   { color: "bg-muted/60 text-muted-foreground border-border",           dot: "bg-muted-foreground", label: "Pending" },
  };
  const s = map[status] ?? map["unknown"]!;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${s.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── Agent type icon colors ───────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  planner:    "from-violet-500 to-purple-600",
  builder:    "from-blue-500   to-cyan-600",
  research:   "from-emerald-500 to-teal-600",
  debug:      "from-orange-500 to-red-600",
  deployment: "from-indigo-500 to-blue-600",
  database:   "from-cyan-500   to-blue-600",
  security:   "from-rose-500   to-pink-600",
};

const AGENT_ICONS: Record<string, string> = {
  planner:    "⚙️",
  builder:    "🔨",
  research:   "🔍",
  debug:      "🐛",
  deployment: "🚀",
  database:   "🗄️",
  security:   "🔐",
};

// ─── Tab type ─────────────────────────────────────────────────────────────────

type Tab = "overview" | "models" | "agents" | "health" | "executions";

// ─── Main component ───────────────────────────────────────────────────────────

export default function ControlCenter() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const qc = useQueryClient();

  const { data: modelsData, isLoading: modelsLoading } = useQuery({
    queryKey: ["ai-router-models"],
    queryFn: () => apiFetch<{ items: ModelEntry[]; total: number }>("/v1/ai/router/models"),
    refetchInterval: 30_000,
  });

  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ["ai-agents"],
    queryFn: () => apiFetch<{ items: AgentSummary[]; total: number }>("/v1/agents"),
    refetchInterval: 60_000,
  });

  const { data: healthData } = useQuery({
    queryKey: ["ai-health"],
    queryFn: () => apiFetch<{ items: HealthReport[]; total: number; summary: Record<string, number> }>("/v1/ai/router/health"),
    refetchInterval: 15_000,
  });

  const { data: execData } = useQuery({
    queryKey: ["ai-executions"],
    queryFn: () => apiFetch<{ items: ExecutionRecord[]; total: number }>("/v1/ai/router/executions?per_page=20"),
    refetchInterval: 10_000,
  });

  const toggleModel = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      apiFetch(`/v1/ai/router/models/${id}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-router-models"] }),
  });

  const models = modelsData?.items ?? [];
  const agents = agentsData?.items ?? [];
  const health = healthData?.items ?? [];
  const executions = execData?.items ?? [];
  const healthSummary = healthData?.summary ?? {};

  const activeModels = models.filter((m) => m.enabled).length;
  const totalRequests = health.reduce((s, h) => s + h.total_requests, 0);
  const avgSuccessRate = health.length > 0
    ? health.reduce((s, h) => s + h.success_rate, 0) / health.length
    : 100;

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview",   label: "Overview" },
    { id: "models",     label: "Models" },
    { id: "agents",     label: "Agents" },
    { id: "health",     label: "Health" },
    { id: "executions", label: "Executions" },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border px-6 py-5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">AI Control Center</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Router intelligence · Model registry · Health monitoring · Execution timeline</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {activeModels}/{models.length} models active
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 mt-5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === t.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >

            {/* ── Overview ── */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { label: "Active Models",   value: activeModels,                      sub: `of ${models.length} total` },
                    { label: "Agents Online",   value: agents.length,                     sub: "specialized agents" },
                    { label: "Avg Success",     value: `${avgSuccessRate.toFixed(1)}%`,   sub: "across all models" },
                    { label: "Total Requests",  value: totalRequests.toLocaleString(),     sub: "since server start" },
                  ].map((stat) => (
                    <div key={stat.label} className="seven-card rounded-xl p-4">
                      <p className="text-sm text-muted-foreground">{stat.label}</p>
                      <p className="text-2xl font-bold text-foreground mt-1">{stat.value}</p>
                      <p className="text-xs text-muted-foreground/70 mt-0.5">{stat.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Health summary */}
                {Object.keys(healthSummary).length > 0 && (
                  <div className="seven-card rounded-xl p-5">
                    <h3 className="text-sm font-medium text-muted-foreground mb-3">Model Health Summary</h3>
                    <div className="flex gap-4 flex-wrap">
                      {Object.entries(healthSummary).map(([status, count]) => (
                        <div key={status} className="flex items-center gap-2">
                          <StatusBadge status={status} />
                          <span className="text-muted-foreground text-sm font-mono">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent executions */}
                {executions.length > 0 && (
                  <div className="seven-card rounded-xl p-5">
                    <h3 className="text-sm font-medium text-muted-foreground mb-3">Recent Executions</h3>
                    <div className="space-y-2">
                      {executions.slice(0, 5).map((e) => (
                        <div key={e.id} className="flex items-center gap-3 text-sm">
                          <StatusBadge status={e.status} />
                          <span className="text-foreground/80 font-medium w-20 shrink-0">{e.agent_type}</span>
                          <span className="text-muted-foreground w-20 shrink-0">{e.task_type}</span>
                          <span className="text-muted-foreground/60 truncate flex-1">{e.request_summary ?? "—"}</span>
                          {e.latency_ms != null && (
                            <span className="text-muted-foreground font-mono text-xs shrink-0">{e.latency_ms}ms</span>
                          )}
                          {e.failovers > 0 && (
                            <span className="text-yellow-500 text-xs shrink-0">{e.failovers}↷</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Models ── */}
            {activeTab === "models" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm text-muted-foreground">{models.length} models in registry</p>
                  <p className="text-xs text-muted-foreground/60">Toggle to enable/disable routing</p>
                </div>
                {modelsLoading ? (
                  <div className="text-muted-foreground text-sm py-8 text-center">Loading models…</div>
                ) : (
                  models.map((model) => (
                    <div key={model.id} className={`seven-card rounded-xl p-4 transition-opacity ${model.enabled ? "opacity-100" : "opacity-60"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="shrink-0">
                            <StatusBadge status={model.status} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground/90 truncate">{model.name}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">{model.model_id}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 shrink-0 ml-4">
                          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground">
                            <span title="Avg response time">⏱ {model.health.avg_response_ms > 0 ? `${model.health.avg_response_ms}ms` : "—"}</span>
                            <span title="Requests"># {model.health.total_requests}</span>
                            <span title="Success rate" className={model.health.success_rate < 70 ? "text-red-400" : "text-muted-foreground"}>
                              ✓ {model.health.success_rate.toFixed(0)}%
                            </span>
                          </div>
                          <div className="hidden sm:flex flex-wrap gap-1 max-w-[120px]">
                            {model.task_affinity.slice(0, 2).map((t) => (
                              <span key={t} className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded">{t}</span>
                            ))}
                          </div>
                          {model.is_free && (
                            <span className="px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 text-xs rounded border border-emerald-500/20">Free</span>
                          )}
                          <button
                            onClick={() => toggleModel.mutate({ id: model.id, enabled: !model.enabled })}
                            disabled={toggleModel.isPending}
                            className={`relative rounded-full transition-colors shrink-0 ${model.enabled ? "bg-primary" : "bg-muted"}`}
                            style={{ minWidth: "2.5rem", width: "2.5rem", height: "1.375rem" }}
                            title={model.enabled ? "Disable" : "Enable"}
                          >
                            <span
                              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${model.enabled ? "translate-x-4" : "translate-x-0"}`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Agents ── */}
            {activeTab === "agents" && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {agentsLoading ? (
                  <div className="col-span-3 text-muted-foreground text-sm py-8 text-center">Loading agents…</div>
                ) : (
                  agents.map((agent) => (
                    <div key={agent.agent_type} className="seven-card rounded-xl p-5">
                      <div className="flex items-start gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${AGENT_COLORS[agent.agent_type] ?? "from-muted to-muted"} flex items-center justify-center text-xl shrink-0`}>
                          {AGENT_ICONS[agent.agent_type] ?? "🤖"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-foreground/90">{agent.name} Agent</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{agent.description}</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground/60 mb-1">Handles</p>
                          <div className="flex flex-wrap gap-1">
                            {agent.supported_task_types.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs rounded">{t}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground/60 mb-1">Preferred models</p>
                          <div className="space-y-1">
                            {agent.preferred_models.slice(0, 2).map((m) => (
                              <div key={m.id} className="flex items-center justify-between">
                                <p className="text-xs text-muted-foreground truncate">{m.name}</p>
                                <StatusBadge status={m.status} />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ── Health ── */}
            {activeTab === "health" && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  {Object.entries(healthSummary).map(([status, count]) => (
                    <div key={status} className="flex items-center gap-2 seven-card rounded-lg px-3 py-2">
                      <StatusBadge status={status} />
                      <span className="text-foreground/80 text-sm font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
                {health.map((h) => (
                  <div key={h.registry_entry_id} className="seven-card rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <StatusBadge status={h.status} />
                        <p className="text-sm font-medium text-foreground/90">{h.name}</p>
                        <p className="text-xs text-muted-foreground">{h.provider_slug}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span title="Active requests" className={h.active_requests > 0 ? "text-blue-400" : ""}>
                          {h.active_requests > 0 ? `${h.active_requests} active` : "idle"}
                        </span>
                        <span>{h.total_requests} reqs</span>
                      </div>
                    </div>
                    {h.total_requests > 0 && (
                      <div className="grid grid-cols-3 gap-4 mt-3">
                        <div>
                          <p className="text-xs text-muted-foreground/60">Success rate</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${h.success_rate >= 80 ? "bg-emerald-500" : h.success_rate >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                                style={{ width: `${h.success_rate}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground w-10 shrink-0">{h.success_rate.toFixed(0)}%</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground/60">Avg response</p>
                          <p className="text-sm font-mono text-foreground/80 mt-1">
                            {h.avg_response_ms > 0 ? `${h.avg_response_ms}ms` : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground/60">Last activity</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {h.last_success_at
                              ? new Date(h.last_success_at).toLocaleTimeString()
                              : "—"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Executions ── */}
            {activeTab === "executions" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm text-muted-foreground">Last {executions.length} executions</p>
                  <p className="text-xs text-muted-foreground/60">Auto-refreshes every 10s</p>
                </div>
                {executions.length === 0 ? (
                  <div className="seven-card rounded-xl p-8 text-center">
                    <p className="text-muted-foreground text-sm">No executions yet.</p>
                    <p className="text-muted-foreground/60 text-xs mt-1">Send a message in the AI Chat to see routing telemetry here.</p>
                  </div>
                ) : (
                  executions.map((e) => (
                    <div key={e.id} className="seven-card rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-1">
                        <StatusBadge status={e.status} />
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded bg-gradient-to-r ${AGENT_COLORS[e.agent_type] ?? "from-muted to-muted"} bg-clip-text text-transparent border border-border`}>
                          {e.agent_type}
                        </span>
                        <span className="text-xs text-muted-foreground">{e.task_type}</span>
                        <span className="flex-1" />
                        {e.latency_ms != null && (
                          <span className="text-xs font-mono text-muted-foreground">{e.latency_ms}ms</span>
                        )}
                        {e.failovers > 0 && (
                          <span className="text-xs text-yellow-500" title={`${e.failovers} failover(s)`}>↷{e.failovers}</span>
                        )}
                        {e.retries > 0 && (
                          <span className="text-xs text-blue-500" title={`${e.retries} retry(s)`}>↺{e.retries}</span>
                        )}
                      </div>
                      {e.request_summary && (
                        <p className="text-xs text-muted-foreground truncate mt-1">{e.request_summary}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/60">
                        <span className="font-mono truncate">{e.model_id}</span>
                        <span>·</span>
                        <span>{new Date(e.started_at).toLocaleTimeString()}</span>
                        {e.routing_rationale && (
                          <>
                            <span>·</span>
                            <span className="truncate flex-1" title={e.routing_rationale}>{e.routing_rationale.slice(0, 80)}</span>
                          </>
                        )}
                      </div>
                      {e.error_message && (
                        <p className="text-xs text-red-400 mt-1.5 truncate" title={e.error_message}>{e.error_message}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
