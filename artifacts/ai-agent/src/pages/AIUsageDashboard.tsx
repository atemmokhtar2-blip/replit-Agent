/**
 * AI Usage Dashboard — Phase 2
 *
 * Real-time usage statistics, per-provider charts, per-model table,
 * and activity timeline. Built with recharts.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Activity, BarChart3, RefreshCw, Server, Key, TrendingUp,
  Zap, CheckCircle2, XCircle, Clock, Globe,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProviderUsageStat {
  slug: string;
  displayName: string;
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  activeKeys: number;
  totalKeys: number;
  errorCount: number;
  healthScore: number;
  status: string;
}

interface ModelUsageStat {
  model: string;
  provider: string;
  uses: number;
  successRate: number;
  avgLatencyMs: number;
  lastUsed: string | null;
}

interface HourlyActivity {
  hour: string;
  requests: number;
  success: number;
  failed: number;
}

interface UsageDashboard {
  providers: ProviderUsageStat[];
  models: ModelUsageStat[];
  recentActivity: HourlyActivity[];
  totals: {
    requests: number;
    success: number;
    errors: number;
    avgLatency: number;
    activeProviders: number;
    totalKeys: number;
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE = "/ai-providers";

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: "#7c3aed",
  openai:     "#10a37f",
  anthropic:  "#d97706",
  gemini:     "#3b82f6",
  groq:       "#f97316",
  xai:        "#06b6d4",
  mistral:    "#ec4899",
  deepseek:   "#8b5cf6",
  cohere:     "#14b8a6",
  huggingface:"#f59e0b",
  cloudflare: "#f97316",
  "hf-space": "#6366f1",
};

const PIE_COLORS = ["#7c3aed", "#10a37f", "#d97706", "#3b82f6", "#f97316", "#06b6d4", "#ec4899", "#8b5cf6"];

function fmt(ms: number) { return ms > 0 ? `${Math.round(ms)}ms` : "—"; }
function pct(r: number)  { return `${Math.round(r * 100)}%`; }
function relTime(iso?: string | null) {
  if (!iso) return "—";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function useDashboard() {
  return useQuery<UsageDashboard>({
    queryKey: ["ai-usage-dashboard"],
    queryFn: () => apiFetch<{ data: UsageDashboard }>(`${BASE}/dashboard`).then(r => r.data),
    refetchInterval: 30_000,
  });
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur p-3 shadow-lg text-xs">
      <p className="font-medium text-white mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="text-white font-medium">{typeof p.value === "number" && p.name.includes("Rate") ? `${Math.round(p.value)}%` : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Summary card ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <Card className="border-border bg-card/60">
      <CardContent className="p-4">
        <div className={`flex items-center gap-2 mb-2 ${color ?? "text-muted-foreground"}`}>
          {icon}
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-2xl font-bold text-white">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type DashTab = "overview" | "models" | "activity";

export default function AIUsageDashboard() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useDashboard();
  const [tab, setTab] = useState<DashTab>("overview");

  const providers = data?.providers ?? [];
  const models    = data?.models ?? [];
  const activity  = data?.recentActivity ?? [];
  const totals    = data?.totals;

  // Chart data
  const providerBarData = providers
    .filter(p => p.totalRequests > 0)
    .sort((a, b) => b.totalRequests - a.totalRequests)
    .slice(0, 8)
    .map(p => ({
      name:     p.displayName.replace(" AI", "").replace("Google ", ""),
      requests: p.totalRequests,
      success:  Math.round(p.successRate * 100),
      latency:  Math.round(p.avgLatencyMs),
      color:    PROVIDER_COLORS[p.slug] ?? "#6366f1",
    }));

  const pieData = providers
    .filter(p => p.totalRequests > 0)
    .map((p, i) => ({
      name:  p.displayName.replace(" AI", "").replace("Google ", ""),
      value: p.totalRequests,
      color: PIE_COLORS[i % PIE_COLORS.length] ?? "#6366f1",
    }));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Usage Dashboard</h1>
            <p className="text-xs text-muted-foreground">Real-time monitoring · per-provider + per-model analytics</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => { void refetch(); void qc.invalidateQueries({ queryKey: ["ai-usage-dashboard"] }); }} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Loading / error */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading dashboard…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-center py-20 text-red-400 gap-2">
          <XCircle className="h-5 w-5" /> Failed to load dashboard
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={<Activity className="h-4 w-4" />}    label="Total Requests"    value={(totals?.requests ?? 0).toLocaleString()} color="text-violet-400" />
            <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Success"           value={totals ? pct(totals.success / Math.max(totals.requests, 1)) : "—"} color="text-emerald-400" />
            <StatCard icon={<XCircle className="h-4 w-4" />}      label="Errors"            value={(totals?.errors ?? 0).toLocaleString()} color="text-red-400" />
            <StatCard icon={<Zap className="h-4 w-4" />}          label="Avg Latency"       value={fmt(totals?.avgLatency ?? 0)} color="text-amber-400" />
            <StatCard icon={<Server className="h-4 w-4" />}       label="Active Providers"  value={String(totals?.activeProviders ?? 0)} color="text-blue-400" />
            <StatCard icon={<Key className="h-4 w-4" />}          label="Active Keys"       value={String(totals?.totalKeys ?? 0)} color="text-cyan-400" />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-lg bg-muted/20 p-1 w-fit">
            {([
              ["overview", <BarChart3 className="h-3.5 w-3.5" key="b" />, "Overview"],
              ["models",   <Globe    className="h-3.5 w-3.5" key="g" />, "Models"],
              ["activity", <Clock    className="h-3.5 w-3.5" key="c" />, "Activity"],
            ] as const).map(([id, icon, label]) => (
              <button
                key={id}
                onClick={() => setTab(id as DashTab)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  tab === id ? "bg-muted/30 text-white" : "text-muted-foreground hover:text-foreground/80"
                }`}
              >
                {icon}{label}
              </button>
            ))}
          </div>

          {/* ── Overview tab ─────────────────────────────────────────────────── */}
          {tab === "overview" && (
            <div className="space-y-6">
              {providers.every(p => p.totalRequests === 0) ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <BarChart3 className="h-10 w-10 opacity-30" />
                  <p>No requests logged yet. Usage data will appear here once the AI router starts sending requests.</p>
                </div>
              ) : (
                <>
                  {/* Requests by provider */}
                  {providerBarData.length > 0 && (
                    <Card className="border-border bg-card/60">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold text-white">Requests by Provider</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                          <BarChart data={providerBarData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                            <Tooltip content={<CustomTooltip />} />
                            <Bar dataKey="requests" name="Requests" radius={[3, 3, 0, 0]}>
                              {providerBarData.map((entry, i) => (
                                <Cell key={i} fill={entry.color} fillOpacity={0.8} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  )}

                  {/* Two-column: Pie + Latency */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Distribution pie */}
                    {pieData.length > 0 && (
                      <Card className="border-border bg-card/60">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-white">Traffic Distribution</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} paddingAngle={3}>
                                {pieData.map((entry, i) => (
                                  <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: number) => [v.toLocaleString(), "Requests"]} />
                              <Legend formatter={(v) => <span className="text-xs text-muted-foreground">{v}</span>} />
                            </PieChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    )}

                    {/* Success rate comparison */}
                    {providerBarData.length > 0 && (
                      <Card className="border-border bg-card/60">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-white">Success Rate by Provider</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={providerBarData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                              <YAxis domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={v => `${v}%`} />
                              <Tooltip content={<CustomTooltip />} />
                              <Bar dataKey="success" name="Success Rate" radius={[3, 3, 0, 0]}>
                                {providerBarData.map((entry, i) => (
                                  <Cell key={i} fill={entry.success >= 90 ? "#10b981" : entry.success >= 70 ? "#f59e0b" : "#ef4444"} fillOpacity={0.8} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </CardContent>
                      </Card>
                    )}
                  </div>

                  {/* Provider table */}
                  <Card className="border-border bg-card/60">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-white">Provider Stats</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-border hover:bg-transparent">
                            {["Provider", "Status", "Requests", "Success", "Errors", "Avg Latency", "Keys"].map(h => (
                              <TableHead key={h} className="text-xs text-muted-foreground">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {providers.sort((a, b) => b.totalRequests - a.totalRequests).map(p => (
                            <TableRow key={p.slug} className="border-border/50 hover:bg-muted/10">
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ background: PROVIDER_COLORS[p.slug] ?? "#6366f1" }} />
                                  <span className="text-sm font-medium text-white">{p.displayName}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={`text-xs ${
                                  p.status === "healthy"   ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                                  p.status === "degraded"  ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                                  p.status === "unhealthy" ? "bg-red-500/15 text-red-400 border-red-500/30" :
                                  "bg-muted/60 text-muted-foreground border-border"
                                }`}>{p.status}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-white">{p.totalRequests.toLocaleString()}</TableCell>
                              <TableCell className={`text-xs font-medium ${p.successRate >= 0.9 ? "text-emerald-400" : p.successRate >= 0.7 ? "text-amber-400" : "text-red-400"}`}>
                                {pct(p.successRate)}
                              </TableCell>
                              <TableCell className="text-xs text-red-400">{p.errorCount.toLocaleString()}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmt(p.avgLatencyMs)}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{p.activeKeys}/{p.totalKeys}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}

          {/* ── Models tab ───────────────────────────────────────────────────── */}
          {tab === "models" && (
            <div className="space-y-4">
              {models.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <Globe className="h-10 w-10 opacity-30" />
                  <p>No model usage data yet. Stats will appear after AI requests are processed.</p>
                </div>
              ) : (
                <Card className="border-border bg-card/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-violet-400" />
                      Model Usage Statistics ({models.length} models)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          {["Model", "Provider", "Uses", "Success Rate", "Avg Latency", "Last Used"].map(h => (
                            <TableHead key={h} className="text-xs text-muted-foreground">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {models.slice(0, 50).map((m, i) => (
                          <TableRow key={i} className="border-border/50 hover:bg-muted/10">
                            <TableCell>
                              <code className="text-xs font-mono text-foreground/80 max-w-[200px] truncate block" title={m.model}>
                                {m.model.split("/").pop() ?? m.model}
                              </code>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs" style={{ borderColor: (PROVIDER_COLORS[m.provider] ?? "#6366f1") + "40", color: PROVIDER_COLORS[m.provider] ?? "#6366f1" }}>
                                {m.provider}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-medium text-white">{m.uses.toLocaleString()}</TableCell>
                            <TableCell className={`text-xs font-medium ${m.successRate >= 0.9 ? "text-emerald-400" : m.successRate >= 0.7 ? "text-amber-400" : "text-red-400"}`}>
                              {pct(m.successRate)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmt(m.avgLatencyMs)}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{relTime(m.lastUsed)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ── Activity tab ─────────────────────────────────────────────────── */}
          {tab === "activity" && (
            <div className="space-y-4">
              {activity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <Clock className="h-10 w-10 opacity-30" />
                  <p>No activity data yet. The chart will show hourly request trends as usage accumulates.</p>
                </div>
              ) : (
                <Card className="border-border bg-card/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold text-white">Hourly Request Volume (last 24h)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={activity} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="hour" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={v => new Date(v).getHours() + ":00"} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="requests" name="Total" stroke="#7c3aed" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="success"  name="Success" stroke="#10b981" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="failed"   name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
