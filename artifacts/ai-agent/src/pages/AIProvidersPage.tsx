import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Zap, Activity, RefreshCw,
  Plus, Trash2, Eye, EyeOff, ToggleLeft, ToggleRight, TestTube2,
  ChevronDown, ChevronUp, Server, Key, BarChart3, List,
  Shield, TrendingUp, Cpu, Rotate3d, Star,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Label }    from "@/components/ui/label";
import { Badge }    from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProviderStatus  = "healthy" | "degraded" | "unhealthy" | "disabled";
type KeyStatus       = "active" | "disabled" | "exhausted" | "cooling" | "error";
type RoutingStrategy = "round-robin" | "least-recently-used" | "lowest-latency" | "random" | "priority" | "least-failures";

interface KeyHealthReport {
  id: string; name: string; prefix: string; status: KeyStatus; enabled: boolean;
  totalRequests: number; successRate: number; avgResponseTimeMs: number;
  consecutiveFailures: number;
  lastUsed?: string; lastSuccess?: string; lastFailure?: string;
  lastError?: string; cooldownUntil?: string;
}

interface ProviderHealthReport {
  slug: string; displayName: string; status: ProviderStatus; healthScore: number;
  enabled: boolean; priority: number; totalRequests: number;
  successCount: number; failureCount: number; successRate: number;
  avgLatencyMs: number; lastHealthCheck?: string;
  activeKeys: number; totalKeys: number; keys: KeyHealthReport[];
}

interface SystemHealthReport {
  generatedAt: string; activeProviders: number; totalProviders: number;
  totalKeys: number; activeKeys: number; totalRequests: number;
  overallSuccess: number; avgLatencyMs: number; currentStrategy: RoutingStrategy;
  providers: ProviderHealthReport[];
}

interface RequestLog {
  id: string; providerSlug: string; keyId?: string; model?: string;
  taskType?: string; latencyMs?: number; status: string;
  retries: number; errorCode?: number; errorMessage?: string;
  createdAt: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = "/ai-providers";

function useHealth() {
  return useQuery<SystemHealthReport>({
    queryKey: ["ai-providers-health"],
    queryFn: () => apiFetch<{ data: SystemHealthReport }>(`${BASE}/health`).then(r => r.data),
    refetchInterval: 20_000,
  });
}

function useRequestLog() {
  return useQuery<RequestLog[]>({
    queryKey: ["ai-providers-requests"],
    queryFn: () => apiFetch<{ data: RequestLog[] }>(`${BASE}/requests?limit=30`).then(r => r.data),
    refetchInterval: 15_000,
  });
}

// ── Status helpers ────────────────────────────────────────────────────────────

function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
  const map: Record<ProviderStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    healthy:   { label: "Healthy",   icon: <CheckCircle2 className="h-3 w-3" />, cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    degraded:  { label: "Degraded",  icon: <AlertTriangle className="h-3 w-3" />, cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    unhealthy: { label: "Unhealthy", icon: <XCircle className="h-3 w-3" />,      cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    disabled:  { label: "Disabled",  icon: <XCircle className="h-3 w-3" />,      cls: "bg-muted/60 text-muted-foreground border-border" },
  };
  const m = map[status];
  return <Badge variant="outline" className={`gap-1 text-xs ${m.cls}`}>{m.icon}{m.label}</Badge>;
}

function KeyStatusBadge({ status }: { status: KeyStatus }) {
  const map: Record<KeyStatus, { cls: string }> = {
    active:    { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    disabled:  { cls: "bg-muted/60 text-muted-foreground border-border" },
    exhausted: { cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
    cooling:   { cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    error:     { cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  return <Badge variant="outline" className={`text-xs capitalize ${map[status].cls}`}>{status}</Badge>;
}

function HealthBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-emerald-500" : score >= 30 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 rounded-full bg-muted/30">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{score}</span>
    </div>
  );
}

function fmt(ms: number)   { return ms > 0 ? `${Math.round(ms)}ms` : "—"; }
function pct(r: number)    { return `${Math.round(r * 100)}%`; }
function relTime(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

/** Derive per-provider key stats from the health report */
function deriveKeyStats(p: ProviderHealthReport) {
  const healthyKeys  = p.keys.filter(k => k.enabled && k.status === "active").length;
  const disabledKeys = p.keys.filter(k => !k.enabled || k.status === "disabled" || k.status === "error").length;

  // Current active key = most recently used enabled key
  const activeKey = p.keys
    .filter(k => k.enabled && k.status === "active")
    .sort((a, b) => {
      if (!a.lastUsed && !b.lastUsed) return 0;
      if (!a.lastUsed) return 1;
      if (!b.lastUsed) return -1;
      return new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime();
    })[0] ?? null;

  // Last error = key with most recent failure
  const lastErrorKey = p.keys
    .filter(k => k.lastFailure)
    .sort((a, b) => new Date(b.lastFailure!).getTime() - new Date(a.lastFailure!).getTime())[0] ?? null;

  // Last rotation = most recent lastSuccess across all keys (proxy for rotation activity)
  const lastSuccessTs = p.keys
    .map(k => k.lastSuccess)
    .filter(Boolean)
    .sort()
    .at(-1);

  return { healthyKeys, disabledKeys, activeKey, lastErrorKey, lastSuccessTs };
}

// ── Add Key Dialog ────────────────────────────────────────────────────────────

function AddKeyDialog({ slug, onAdded }: { slug: string; onAdded: () => void }) {
  const [open, setOpen]     = useState(false);
  const [name, setName]     = useState("");
  const [apiKey, setApiKey] = useState("");
  const [show, setShow]     = useState(false);

  const qc  = useQueryClient();
  const add = useMutation({
    mutationFn: () => apiFetch(`${BASE}/${slug}/keys`, { method: "POST", body: JSON.stringify({ name, apiKey }) }),
    onSuccess: () => {
      toast.success("API key added");
      setOpen(false); setName(""); setApiKey("");
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
      onAdded();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
          <Plus className="h-3 w-3" /> Add Key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add API Key — {slug}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="key-name">Label</Label>
            <Input id="key-name" placeholder="e.g. Production Key 1" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="key-val">API Key</Label>
            <div className="flex gap-2">
              <Input id="key-val" type={show ? "text" : "password"} placeholder="sk-..." value={apiKey} onChange={e => setApiKey(e.target.value)} className="font-mono text-xs" />
              <Button size="icon" variant="ghost" onClick={() => setShow(!show)}>
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => add.mutate()} disabled={!name || !apiKey || add.isPending}>
            {add.isPending ? "Adding…" : "Add Key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Rotate Key Dialog ─────────────────────────────────────────────────────────

function RotateKeyDialog({ slug, keyId, keyName }: { slug: string; keyId: string; keyName: string }) {
  const [open, setOpen] = useState(false);
  const [val,  setVal]  = useState("");
  const [show, setShow] = useState(false);
  const qc = useQueryClient();
  const rotate = useMutation({
    mutationFn: () => apiFetch(`${BASE}/${slug}/keys/${keyId}/rotate`, { method: "POST", body: JSON.stringify({ newApiKey: val }) }),
    onSuccess: () => { toast.success("Key rotated"); setOpen(false); setVal(""); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground hover:text-white gap-1">
          <Rotate3d className="h-3 w-3" /> Rotate
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Rotate Key — {keyName}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Input type={show ? "text" : "password"} placeholder="New API key…" value={val} onChange={e => setVal(e.target.value)} className="font-mono text-xs" />
            <Button size="icon" variant="ghost" onClick={() => setShow(!show)}>
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => rotate.mutate()} disabled={!val || rotate.isPending}>
            {rotate.isPending ? "Rotating…" : "Rotate Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Key row ───────────────────────────────────────────────────────────────────

function KeyRow({ slug, k }: { slug: string; k: KeyHealthReport }) {
  const qc = useQueryClient();

  const toggle = useMutation({
    mutationFn: () => apiFetch(`${BASE}/${slug}/keys/${k.id}/${k.enabled ? "disable" : "enable"}`, { method: "POST" }),
    onSuccess: () => { toast.success(k.enabled ? "Key disabled" : "Key enabled"); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`${BASE}/${slug}/keys/${k.id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Key removed"); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const test = useMutation({
    mutationFn: () => apiFetch<{ data: { ok: boolean; latencyMs: number; error?: string } }>(`${BASE}/${slug}/keys/${k.id}/test`, { method: "POST" }),
    onSuccess: (r) => {
      if (r.data.ok) toast.success(`Key OK — ${r.data.latencyMs}ms`);
      else toast.error(`Key failed: ${r.data.error ?? "Unknown error"}`);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/10 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-white truncate">{k.name}</span>
          <code className="text-xs font-mono text-muted-foreground">{k.prefix}…</code>
          <KeyStatusBadge status={k.status} />
          {k.cooldownUntil && <span className="text-xs text-blue-400"><Clock className="inline h-3 w-3 mr-0.5" />cooling</span>}
        </div>
        <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground flex-wrap">
          <span>{k.totalRequests.toLocaleString()} reqs</span>
          <span>{pct(k.successRate)} ok</span>
          <span>{fmt(k.avgResponseTimeMs)} avg</span>
          {k.consecutiveFailures > 0 && <span className="text-red-400">{k.consecutiveFailures} consec fails</span>}
          <span>used {relTime(k.lastUsed)}</span>
          {k.lastError && <span className="truncate max-w-[200px] text-red-400" title={k.lastError}>{k.lastError.slice(0, 50)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => test.mutate()} disabled={test.isPending} title="Test connection">
          {test.isPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
        </Button>
        <RotateKeyDialog slug={slug} keyId={k.id} keyName={k.name} />
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => toggle.mutate()} disabled={toggle.isPending} title={k.enabled ? "Disable" : "Enable"}>
          {k.enabled ? <ToggleRight className="h-3.5 w-3.5 text-emerald-400" /> : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground" />}
        </Button>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-300" onClick={() => remove.mutate()} disabled={remove.isPending} title="Remove key">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({ p, isCurrentActive }: { p: ProviderHealthReport; isCurrentActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const { healthyKeys, disabledKeys, activeKey, lastErrorKey, lastSuccessTs } = deriveKeyStats(p);

  const toggle = useMutation({
    mutationFn: () => apiFetch(`${BASE}/${p.slug}/${p.enabled ? "disable" : "enable"}`, { method: "POST" }),
    onSuccess: () => { toast.success(p.enabled ? "Provider disabled" : "Provider enabled"); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const testProvider = useMutation({
    mutationFn: () => apiFetch<{ data: { ok: boolean; latencyMs: number; error?: string } }>(`${BASE}/${p.slug}/test`, { method: "POST" }),
    onSuccess: (r) => {
      if (r.data.ok) toast.success(`${p.displayName} reachable — ${r.data.latencyMs}ms`);
      else toast.error(`${p.displayName} unreachable: ${r.data.error ?? "check keys"}`);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const setStrategy = useMutation({
    mutationFn: (strategy: RoutingStrategy) => apiFetch(`${BASE}/${p.slug}/strategy`, { method: "POST", body: JSON.stringify({ strategy }) }),
    onSuccess: () => { toast.success("Routing strategy updated"); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  const STRATEGIES: RoutingStrategy[] = ["round-robin","least-recently-used","lowest-latency","random","priority","least-failures"];

  return (
    <Card className={`border-border bg-card/60 backdrop-blur-sm ${isCurrentActive ? "ring-1 ring-violet-500/40" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/20 text-foreground/80">
              <Server className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-sm font-semibold text-white">{p.displayName}</CardTitle>
                <ProviderStatusBadge status={p.status} />
                {isCurrentActive && (
                  <Badge variant="outline" className="text-xs bg-violet-500/15 text-violet-400 border-violet-500/30 gap-1">
                    <Star className="h-2.5 w-2.5" /> Active
                  </Badge>
                )}
                {!p.enabled && <Badge variant="outline" className="text-xs text-muted-foreground border-zinc-600">Off</Badge>}
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                <span>Priority {p.priority}</span>
                <span className="text-emerald-400">{healthyKeys} healthy</span>
                <span className="text-red-400/80">{disabledKeys} disabled</span>
                <span className="text-muted-foreground">{p.totalKeys} total</span>
                <span>{p.totalRequests.toLocaleString()} reqs</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => testProvider.mutate()} disabled={testProvider.isPending || !p.enabled}>
              {testProvider.isPending ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <TestTube2 className="h-3 w-3 mr-1" />}
              Test
            </Button>
            <Button
              size="sm" variant="ghost"
              className={`h-7 px-2 text-xs ${p.enabled ? "text-amber-400 hover:text-amber-300" : "text-emerald-400 hover:text-emerald-300"}`}
              onClick={() => toggle.mutate()} disabled={toggle.isPending}
            >
              {p.enabled ? <ToggleRight className="h-3.5 w-3.5 mr-1" /> : <ToggleLeft className="h-3.5 w-3.5 mr-1" />}
              {p.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Health Score", value: <HealthBar score={p.healthScore} /> },
            { label: "Success Rate", value: pct(p.successRate) },
            { label: "Avg Latency",  value: fmt(p.avgLatencyMs) },
            { label: "Failures",     value: p.failureCount.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-md bg-muted/15 px-2.5 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
              <div className="text-sm font-medium text-white">{value}</div>
            </div>
          ))}
        </div>

        {/* Active key + last error row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/15 px-2.5 py-2">
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <Key className="h-3 w-3" /> Current Active Key
            </p>
            {activeKey ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white truncate">{activeKey.name}</span>
                <code className="text-xs font-mono text-muted-foreground shrink-0">{activeKey.prefix}…</code>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground italic">none</span>
            )}
            {activeKey?.lastUsed && (
              <p className="text-xs text-muted-foreground/70 mt-0.5">last used {relTime(activeKey.lastUsed)}</p>
            )}
          </div>

          <div className="rounded-md bg-muted/15 px-2.5 py-2">
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Last Error
            </p>
            {lastErrorKey?.lastError ? (
              <>
                <p className="text-xs text-red-400 truncate" title={lastErrorKey.lastError}>
                  {lastErrorKey.lastError.slice(0, 60)}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {lastErrorKey.name} · {relTime(lastErrorKey.lastFailure)}
                </p>
              </>
            ) : (
              <span className="text-sm text-emerald-400">No errors</span>
            )}
          </div>
        </div>

        {/* Last activity row */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Last health check: {relTime(p.lastHealthCheck)}</span>
          {lastSuccessTs && <span>Last rotation activity: {relTime(lastSuccessTs)}</span>}
        </div>

        {/* Routing strategy */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">Routing:</span>
          <Select onValueChange={(v) => setStrategy.mutate(v as RoutingStrategy)} disabled={setStrategy.isPending}>
            <SelectTrigger className="h-7 text-xs w-52">
              <SelectValue placeholder={p.slug} />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map(s => (
                <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Keys section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-white"
              onClick={() => setExpanded(!expanded)}
            >
              <Key className="h-3 w-3" />
              API Keys ({p.totalKeys}) — {healthyKeys} healthy · {disabledKeys} disabled
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <AddKeyDialog slug={p.slug} onAdded={() => setExpanded(true)} />
          </div>

          {expanded && (
            <div className="space-y-1.5">
              {p.keys.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2 text-center">
                  No keys added yet. Add one above or set <code className="font-mono">{p.slug.toUpperCase().replace(/-/g,"_")}_API_KEY</code> environment variable.
                </p>
              ) : (
                p.keys.map(k => <KeyRow key={k.id} slug={p.slug} k={k} />)
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Request log table ─────────────────────────────────────────────────────────

function RequestLogTable() {
  const { data: logs, isLoading } = useRequestLog();

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Loading requests…</div>;
  if (!logs?.length) return <div className="py-8 text-center text-sm text-muted-foreground">No requests logged yet.</div>;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="text-xs text-muted-foreground">Provider</TableHead>
            <TableHead className="text-xs text-muted-foreground">Model</TableHead>
            <TableHead className="text-xs text-muted-foreground">Task</TableHead>
            <TableHead className="text-xs text-muted-foreground">Status</TableHead>
            <TableHead className="text-xs text-muted-foreground text-right">Latency</TableHead>
            <TableHead className="text-xs text-muted-foreground text-right">Retries</TableHead>
            <TableHead className="text-xs text-muted-foreground">When</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map(r => (
            <TableRow key={r.id} className="border-border/50 hover:bg-muted/10">
              <TableCell className="text-xs font-medium text-white">{r.providerSlug}</TableCell>
              <TableCell className="text-xs text-muted-foreground font-mono max-w-[140px] truncate">{r.model ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{r.taskType ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-xs ${r.status === "success" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"}`}>
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground text-right">{r.latencyMs ? `${r.latencyMs}ms` : "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground text-right">{r.retries}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{relTime(r.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "providers" | "requests";

export default function AIProvidersPage() {
  const qc = useQueryClient();
  const { data: health, isLoading, refetch, isFetching } = useHealth();
  const [tab, setTab] = useState<Tab>("providers");

  const runHealthCheck = useMutation({
    mutationFn: () => apiFetch(`${BASE}/health-check`, { method: "POST" }),
    onSuccess: () => { toast.success("Health check complete"); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError:   (e) => toast.error((e as Error).message),
  });

  const overallStatusColor = useCallback(() => {
    if (!health) return "text-muted-foreground";
    const rate = health.overallSuccess;
    if (rate >= 0.95) return "text-emerald-400";
    if (rate >= 0.80) return "text-amber-400";
    return "text-red-400";
  }, [health]);

  const sortedProviders = health?.providers
    .slice()
    .sort((a, b) => a.priority - b.priority) ?? [];

  // Current active provider = highest priority enabled provider with healthy keys
  const currentActiveProvider = sortedProviders.find(p => p.enabled && p.activeKeys > 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-background/90 backdrop-blur px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">AI Provider Manager</h1>
              <p className="text-xs text-muted-foreground">
                Multi-provider orchestration · auto-discovery · key rotation · failover
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs"
              onClick={() => void refetch()}
              disabled={isFetching}
              title="Refresh Keys — re-reads provider health and newly discovered env keys"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh Keys
            </Button>
            <Button
              size="sm"
              className="gap-1.5 h-8 text-xs bg-violet-600 hover:bg-violet-500"
              onClick={() => runHealthCheck.mutate()}
              disabled={runHealthCheck.isPending}
            >
              {runHealthCheck.isPending
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Activity className="h-3.5 w-3.5" />
              }
              Run Health Check
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Summary cards ─────────────────────────────────────────────────── */}
        {health && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                {
                  icon: <Server className="h-4 w-4" />,
                  label: "Active Providers",
                  value: `${health.activeProviders} / ${health.totalProviders}`,
                  color: "text-violet-400",
                },
                {
                  icon: <Key className="h-4 w-4" />,
                  label: "Discovered Keys",
                  value: `${health.activeKeys} healthy / ${health.totalKeys} total`,
                  color: "text-blue-400",
                },
                {
                  icon: <TrendingUp className="h-4 w-4" />,
                  label: "Overall Success",
                  value: pct(health.overallSuccess),
                  color: overallStatusColor(),
                },
                {
                  icon: <Zap className="h-4 w-4" />,
                  label: "Avg Latency",
                  value: fmt(health.avgLatencyMs),
                  color: "text-amber-400",
                },
              ].map(({ icon, label, value, color }) => (
                <Card key={label} className="border-border bg-card/60 p-4">
                  <div className={`flex items-center gap-2 mb-2 ${color}`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
                  <p className="text-xl font-bold text-white leading-tight">{value}</p>
                </Card>
              ))}
            </div>

            {/* Current active provider banner */}
            {currentActiveProvider && (
              <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
                <Star className="h-4 w-4 text-violet-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-muted-foreground">Current Active Provider: </span>
                  <span className="text-sm font-semibold text-white">{currentActiveProvider.displayName}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {currentActiveProvider.activeKeys} key{currentActiveProvider.activeKeys !== 1 ? "s" : ""} ready
                    · {pct(currentActiveProvider.successRate)} success rate
                    · {fmt(currentActiveProvider.avgLatencyMs)} avg
                  </span>
                </div>
                <ProviderStatusBadge status={currentActiveProvider.status} />
              </div>
            )}
          </>
        )}

        {/* ── Tabs ──────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-lg bg-muted/20 p-1 w-fit">
          {([
            ["providers", <Shield className="h-3.5 w-3.5" key="s" />, "Providers"],
            ["requests",  <List   className="h-3.5 w-3.5" key="l" />, "Request Log"],
          ] as const).map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setTab(id as Tab)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === id ? "bg-muted/30 text-white" : "text-muted-foreground hover:text-foreground/80"
              }`}
            >
              {icon}{label}
            </button>
          ))}
        </div>

        {/* ── Provider cards ─────────────────────────────────────────────────── */}
        {tab === "providers" && (
          <div className="space-y-4">
            {isLoading && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading providers…
              </div>
            )}
            {!isLoading && sortedProviders.length === 0 && (
              <div className="py-16 text-center text-sm text-muted-foreground">No providers configured.</div>
            )}
            {sortedProviders.map(p => (
              <ProviderCard
                key={p.slug}
                p={p}
                isCurrentActive={p.slug === currentActiveProvider?.slug}
              />
            ))}
          </div>
        )}

        {/* ── Request log ───────────────────────────────────────────────────── */}
        {tab === "requests" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground/80">Recent Requests</span>
              <span className="text-xs text-muted-foreground/70">(last 30 · auto-refreshes every 15s)</span>
            </div>
            <RequestLogTable />
          </div>
        )}

        {/* ── Footer timestamp ───────────────────────────────────────────────── */}
        {health?.generatedAt && (
          <p className="text-xs text-muted-foreground/70 text-right">
            Last refreshed {relTime(health.generatedAt)}
          </p>
        )}
      </div>
    </div>
  );
}
