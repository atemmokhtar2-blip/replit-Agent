import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Zap, Activity, RefreshCw,
  Plus, Trash2, Eye, EyeOff, ToggleLeft, ToggleRight, TestTube2,
  ChevronDown, ChevronUp, Server, Key, BarChart3, List,
  Shield, TrendingUp, Cpu, Rotate3d, Star, Upload, Download,
  Layers, FlaskConical, Ban, Copy as CopyIcon, Wifi, WifiOff,
  Play, Square, Info, CheckSquare, MinusSquare,
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
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
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
  avgLatencyMs: number; lastHealthCheck?: string; routingStrategy?: RoutingStrategy;
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

interface ClassifiedKey {
  key: string;
  prefix: string;
  providerSlug: string | null;
  isDuplicate: boolean;
}

interface ImportResult {
  imported: { id: string; providerSlug: string; name: string; prefix: string }[];
  skipped:  { key: string; reason: string }[];
  total:    number;
}

interface ValidationProgress {
  keyId: string; providerSlug: string; keyName: string; prefix: string;
  ok: boolean; latencyMs: number; error?: string;
}

interface ValidationSummary { total: number; passed: number; failed: number; }

// ── Provider display names for display ────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter", anthropic: "Anthropic Claude", openai: "OpenAI",
  gemini: "Google Gemini", groq: "Groq", xai: "xAI Grok",
  huggingface: "HuggingFace", deepseek: "DeepSeek", mistral: "Mistral AI",
  cohere: "Cohere", cloudflare: "Cloudflare AI", "hf-space": "HF Space",
};

// ── Client-side key classifier (mirrors backend logic) ─────────────────────────

function classifyKeyClient(raw: string): string | null {
  const k = raw.trim();
  if (!k || k.length < 8) return null;
  if (k.startsWith("sk-or-v1-"))           return "openrouter";
  if (k.startsWith("sk-ant-"))              return "anthropic";
  if (k.startsWith("AIzaSy"))               return "gemini";
  if (k.startsWith("gsk_"))                 return "groq";
  if (k.startsWith("xai-"))                 return "xai";
  if (k.startsWith("hf_"))                  return "huggingface";
  if (k.startsWith("sk-proj-"))             return "openai";
  if (k.startsWith("sk-") && k.length > 48) return "openai";
  if (k.startsWith("sk-") && k.length >= 32) return "deepseek";
  if (k.startsWith("ms-") || /^[a-zA-Z0-9]{32}$/.test(k)) return "mistral";
  if (k.startsWith("co-") || /^[a-zA-Z0-9]{40}$/.test(k)) return "cohere";
  return null;
}

function parseRawKeys(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map(s => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter(s => s.length >= 8);
}

function deduplicateParsed(keys: string[]): string[] {
  const seen = new Set<string>();
  return keys.filter(k => {
    const prefix = k.slice(0, 20);
    if (seen.has(prefix)) return false;
    seen.add(prefix);
    return true;
  });
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
    queryFn: () => apiFetch<{ data: RequestLog[] }>(`${BASE}/requests?limit=50`).then(r => r.data),
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
  const d   = new Date(iso);
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function deriveKeyStats(p: ProviderHealthReport) {
  const healthyKeys  = p.keys.filter(k => k.enabled && k.status === "active").length;
  const disabledKeys = p.keys.filter(k => !k.enabled || k.status === "disabled" || k.status === "error").length;
  const activeKey    = p.keys
    .filter(k => k.enabled && k.status === "active")
    .sort((a, b) => {
      if (!a.lastUsed && !b.lastUsed) return 0;
      if (!a.lastUsed) return 1;
      if (!b.lastUsed) return -1;
      return new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime();
    })[0] ?? null;
  const lastErrorKey = p.keys
    .filter(k => k.lastFailure)
    .sort((a, b) => new Date(b.lastFailure!).getTime() - new Date(a.lastFailure!).getTime())[0] ?? null;
  const lastSuccessTs = p.keys.map(k => k.lastSuccess).filter(Boolean).sort().at(-1);
  return { healthyKeys, disabledKeys, activeKey, lastErrorKey, lastSuccessTs };
}

// ── Add Key Dialog ─────────────────────────────────────────────────────────────

function AddKeyDialog({ slug, onAdded }: { slug: string; onAdded: () => void }) {
  const [open, setOpen]     = useState(false);
  const [name, setName]     = useState("");
  const [apiKey, setApiKey] = useState("");
  const [show, setShow]     = useState(false);
  const qc = useQueryClient();

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
            <Label>Label</Label>
            <Input placeholder="e.g. Production Key 1" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input type={show ? "text" : "password"} placeholder="sk-…" value={apiKey} onChange={e => setApiKey(e.target.value)} className="font-mono text-xs" />
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

// ── Rotate Key Dialog ──────────────────────────────────────────────────────────

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
        <div className="flex gap-2 py-2">
          <Input type={show ? "text" : "password"} placeholder="New API key…" value={val} onChange={e => setVal(e.target.value)} className="font-mono text-xs" />
          <Button size="icon" variant="ghost" onClick={() => setShow(!show)}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
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

// ── Key row ────────────────────────────────────────────────────────────────────

function KeyRow({
  slug, k, selected, onSelect,
}: {
  slug: string; k: KeyHealthReport;
  selected: boolean; onSelect: (id: string, checked: boolean) => void;
}) {
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
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
      selected ? "border-violet-500/40 bg-violet-500/5" : "border-border/50 bg-muted/10"
    }`}>
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={selected}
        onChange={e => onSelect(k.id, e.target.checked)}
        className="h-3.5 w-3.5 rounded accent-violet-500 shrink-0 cursor-pointer"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-white truncate">{k.name}</span>
          <code className="text-xs font-mono text-muted-foreground">{k.prefix}</code>
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
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-400 hover:text-red-300" onClick={() => remove.mutate()} disabled={remove.isPending} title="Delete key">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ── Provider card ──────────────────────────────────────────────────────────────

function ProviderCard({
  p, isCurrentActive, selectedKeys, onSelectKey,
}: {
  p: ProviderHealthReport;
  isCurrentActive: boolean;
  selectedKeys: Set<string>;
  onSelectKey: (id: string, checked: boolean) => void;
}) {
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

  const STRATEGIES: { value: RoutingStrategy; label: string }[] = [
    { value: "round-robin",        label: "Round Robin" },
    { value: "least-recently-used",label: "Least Used" },
    { value: "lowest-latency",     label: "Fastest Response" },
    { value: "random",             label: "Random" },
    { value: "priority",           label: "Priority" },
    { value: "least-failures",     label: "Least Failures" },
  ];

  const allSelected = p.keys.length > 0 && p.keys.every(k => selectedKeys.has(k.id));
  const someSelected = p.keys.some(k => selectedKeys.has(k.id));

  const toggleAll = () => {
    const val = !allSelected;
    p.keys.forEach(k => onSelectKey(k.id, val));
  };

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
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                <span>Priority {p.priority}</span>
                <span className="text-emerald-400">{healthyKeys} working</span>
                <span className="text-red-400/80">{disabledKeys} disabled</span>
                <span>{p.totalKeys} total</span>
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
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Health Score",  value: <HealthBar score={p.healthScore} /> },
            { label: "Success Rate",  value: pct(p.successRate) },
            { label: "Avg Latency",   value: fmt(p.avgLatencyMs) },
            { label: "Failures",      value: p.failureCount.toLocaleString() },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-md bg-muted/15 px-2.5 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
              <div className="text-sm font-medium text-white">{value}</div>
            </div>
          ))}
        </div>

        {/* Active key + last error */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/15 px-2.5 py-2">
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <Key className="h-3 w-3" /> Current Active Key
            </p>
            {activeKey ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white truncate">{activeKey.name}</span>
                <code className="text-xs font-mono text-muted-foreground shrink-0">{activeKey.prefix}</code>
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

        {lastSuccessTs && (
          <div className="text-xs text-muted-foreground">
            Last health check: {relTime(p.lastHealthCheck)} · Last success: {relTime(lastSuccessTs)}
          </div>
        )}

        {/* Routing strategy */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground shrink-0">Routing:</span>
          <Select onValueChange={(v) => setStrategy.mutate(v as RoutingStrategy)} disabled={setStrategy.isPending}>
            <SelectTrigger className="h-7 text-xs w-52">
              <SelectValue placeholder={p.routingStrategy ?? p.slug} />
            </SelectTrigger>
            <SelectContent>
              {STRATEGIES.map(s => (
                <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Keys */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <button
              className="flex items-center gap-1.5 text-xs font-medium text-foreground/80 hover:text-white"
              onClick={() => setExpanded(!expanded)}
            >
              <Key className="h-3 w-3" />
              API Keys Pool ({p.totalKeys}) — {healthyKeys} working · {disabledKeys} disabled
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            <div className="flex items-center gap-1.5">
              {p.keys.length > 0 && (
                <button
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white"
                  onClick={toggleAll}
                  title={allSelected ? "Deselect all" : "Select all"}
                >
                  {allSelected ? <CheckSquare className="h-3.5 w-3.5" /> : someSelected ? <MinusSquare className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5 opacity-40" />}
                </button>
              )}
              <AddKeyDialog slug={p.slug} onAdded={() => setExpanded(true)} />
            </div>
          </div>

          {expanded && (
            <div className="space-y-1.5">
              {p.keys.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2 text-center">
                  No keys. Add one or use Import tab to paste multiple keys.
                </p>
              ) : (
                p.keys.map(k => (
                  <KeyRow
                    key={k.id} slug={p.slug} k={k}
                    selected={selectedKeys.has(k.id)}
                    onSelect={onSelectKey}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Import Panel ───────────────────────────────────────────────────────────────

function ImportPanel({ onImported, initialRaw = "" }: { onImported: () => void; initialRaw?: string }) {
  const [raw, setRaw]                     = useState(initialRaw);
  const [classified, setClassified]       = useState<ClassifiedKey[] | null>(null);
  const [isImporting, setIsImporting]     = useState(false);
  const [importResult, setImportResult]   = useState<ImportResult | null>(null);
  const [overrideSlug, setOverrideSlug]   = useState<string>("");

  const qc = useQueryClient();

  // Live classification as user types (client-side, fast)
  const liveClassified = (() => {
    if (!raw.trim()) return null;
    const keys = deduplicateParsed(parseRawKeys(raw));
    if (keys.length === 0) return null;
    const seenPrefixes = new Set<string>();
    return keys.map(k => {
      const prefix = k.slice(0, 20);
      const dup    = seenPrefixes.has(prefix);
      seenPrefixes.add(prefix);
      return { key: k, prefix, providerSlug: classifyKeyClient(k), isDuplicate: dup };
    });
  })();

  // Group by provider for summary
  const grouped = liveClassified ? (() => {
    const map = new Map<string, number>();
    for (const c of liveClassified) {
      const slug = c.providerSlug ?? "unknown";
      map.set(slug, (map.get(slug) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  })() : [];

  const handleImport = async () => {
    if (!liveClassified || liveClassified.length === 0) return;
    const validKeys = liveClassified.filter(c => !c.isDuplicate);
    const keysToImport = validKeys.map(c => c.key);
    if (keysToImport.length === 0) { toast.error("All keys are duplicates"); return; }

    setIsImporting(true);
    setImportResult(null);
    try {
      const result = await apiFetch<{ data: ImportResult }>(`${BASE}/import`, {
        method: "POST",
        body: JSON.stringify({
          keys: keysToImport,
          ...(overrideSlug ? { defaultSlug: overrideSlug } : {}),
        }),
      });
      setImportResult(result.data);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
      toast.success(`Imported ${result.data.imported.length} key(s)`, {
        description: result.data.skipped.length > 0
          ? `${result.data.skipped.length} skipped (duplicates or unknown format)`
          : undefined,
      });
      onImported();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setIsImporting(false);
    }
  };

  const clear = () => { setRaw(""); setClassified(null); setImportResult(null); };

  const unknownCount  = liveClassified?.filter(c => !c.providerSlug).length ?? 0;
  const duplicateCount = liveClassified?.filter(c => c.isDuplicate).length ?? 0;
  const validCount    = liveClassified ? liveClassified.length - duplicateCount : 0;

  const KNOWN_SLUGS = [
    "openrouter","openai","anthropic","gemini","groq","xai",
    "huggingface","deepseek","mistral","cohere","cloudflare",
  ];

  return (
    <div className="space-y-6">
      {/* Textarea */}
      <Card className="border-border bg-card/60">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-violet-400" />
            <CardTitle className="text-sm font-semibold text-white">Paste API Keys</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Paste any number of API keys — one per line. The system auto-detects the provider from the key format.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder={`sk-or-v1-xxxxxxxxxxxxx\nsk-ant-api-03-xxxxxxxxx\nAIzaSyxxxxxxxxxxxxxxx\ngsk_xxxxxxxxxxxxxxxxx\nxai-xxxxxxxxxxxxxxxxx\nhf_xxxxxxxxxxxxxxxxxx\n\n# One key per line — blank lines and duplicates are ignored automatically`}
            value={raw}
            onChange={e => setRaw(e.target.value)}
            className="font-mono text-xs min-h-[220px] resize-y bg-muted/10 border-border/60"
          />

          {/* Live stats */}
          {liveClassified && liveClassified.length > 0 && (
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span className="text-muted-foreground">Detected:</span>
              <span className="text-white font-medium">{liveClassified.length} keys</span>
              {validCount > 0 && <span className="text-emerald-400">{validCount} new</span>}
              {duplicateCount > 0 && <span className="text-amber-400">{duplicateCount} duplicate</span>}
              {unknownCount > 0 && <span className="text-red-400">{unknownCount} unknown provider</span>}
            </div>
          )}

          {/* Provider summary */}
          {grouped.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground font-medium">Auto-classified by provider:</p>
              <div className="flex flex-wrap gap-2">
                {grouped.map(([slug, count]) => (
                  <div
                    key={slug}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${
                      slug === "unknown"
                        ? "border-red-500/30 bg-red-500/10 text-red-400"
                        : "border-violet-500/30 bg-violet-500/10 text-violet-300"
                    }`}
                  >
                    <Server className="h-2.5 w-2.5" />
                    <span className="font-medium">{PROVIDER_LABELS[slug] ?? slug}</span>
                    <span className="bg-white/10 rounded px-1">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Override for unknown keys */}
          {unknownCount > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
              <p className="text-xs text-amber-400 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" />
                {unknownCount} key(s) couldn't be auto-detected. Assign them to a provider:
              </p>
              <Select value={overrideSlug || "__skip__"} onValueChange={v => setOverrideSlug(v === "__skip__" ? "" : v)}>
                <SelectTrigger className="h-7 text-xs w-64 bg-background">
                  <SelectValue placeholder="Select provider for unknown keys…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__skip__" className="text-xs text-muted-foreground">Skip unknown keys</SelectItem>
                  {KNOWN_SLUGS.map(s => (
                    <SelectItem key={s} value={s} className="text-xs">{PROVIDER_LABELS[s] ?? s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2 justify-end pt-1">
            {raw && (
              <Button size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={clear}>
                Clear
              </Button>
            )}
            <Button
              size="sm"
              className="gap-1.5 h-8 text-xs bg-violet-600 hover:bg-violet-500"
              onClick={handleImport}
              disabled={isImporting || !liveClassified || liveClassified.length === 0}
            >
              {isImporting
                ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Importing…</>
                : <><Upload className="h-3.5 w-3.5" /> Import {validCount > 0 ? validCount : ""} Keys</>
              }
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Import result */}
      {importResult && (
        <Card className="border-border bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Import Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Total Parsed",  value: importResult.total,              color: "text-white" },
                { label: "Imported",      value: importResult.imported.length,    color: "text-emerald-400" },
                { label: "Skipped",       value: importResult.skipped.length,     color: "text-amber-400" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-md bg-muted/15 px-3 py-2 text-center">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            {importResult.imported.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Imported keys by provider:</p>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const pMap = new Map<string, number>();
                    importResult.imported.forEach(i => pMap.set(i.providerSlug, (pMap.get(i.providerSlug) ?? 0) + 1));
                    return [...pMap.entries()].map(([slug, cnt]) => (
                      <Badge key={slug} variant="outline" className="text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        {PROVIDER_LABELS[slug] ?? slug}: {cnt}
                      </Badge>
                    ));
                  })()}
                </div>
              </div>
            )}

            {importResult.skipped.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-amber-400 hover:text-amber-300">
                  {importResult.skipped.length} skipped — click to see reasons
                </summary>
                <div className="mt-2 rounded border border-border/50 bg-muted/10 p-2 space-y-1 max-h-40 overflow-y-auto">
                  {importResult.skipped.map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <code className="font-mono text-muted-foreground">{s.key}</code>
                      <span className="text-amber-400/80">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* Format guide */}
      <Card className="border-border/50 bg-card/30">
        <CardContent className="pt-4">
          <p className="text-xs font-medium text-muted-foreground mb-3">Auto-detected key formats:</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {[
              ["OpenRouter",   "sk-or-v1-…"],
              ["Anthropic",    "sk-ant-…"],
              ["OpenAI",       "sk-proj-… / sk-…(51 chars)"],
              ["Gemini",       "AIzaSy…"],
              ["Groq",         "gsk_…"],
              ["xAI Grok",     "xai-…"],
              ["HuggingFace",  "hf_…"],
              ["DeepSeek",     "sk-…(32-48 chars)"],
            ].map(([name, fmt]) => (
              <div key={name} className="flex items-center gap-2 text-muted-foreground">
                <span className="font-medium text-foreground/70 w-24 shrink-0">{name}</span>
                <code className="font-mono text-xs bg-muted/20 px-1.5 py-0.5 rounded">{fmt}</code>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Validate All Panel (SSE-based) ────────────────────────────────────────────

function ValidateAllButton({ totalKeys }: { totalKeys: number }) {
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState<ValidationProgress[]>([]);
  const [summary,  setSummary]  = useState<ValidationSummary | null>(null);
  const [show,     setShow]     = useState(false);
  const sseRef  = useRef<EventSource | null>(null);
  const qc      = useQueryClient();

  const stop = () => {
    sseRef.current?.close();
    sseRef.current = null;
    setRunning(false);
  };

  const start = () => {
    if (running) { stop(); return; }
    setProgress([]);
    setSummary(null);
    setShow(true);
    setRunning(true);

    // Use fetch + ReadableStream because EventSource doesn't support POST
    const token = localStorage.getItem("access_token") ?? "";
    const ctrl  = new AbortController();

    void (async () => {
      try {
        const res = await fetch("/api/v1/ai-providers/validate-all/stream", {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({}),
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) throw new Error("Stream failed");
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if ("total" in data) {
                  setSummary(data as ValidationSummary);
                  void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
                } else {
                  setProgress(prev => [...prev, data as ValidationProgress]);
                }
              } catch { /* skip malformed */ }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error("Validation stream error: " + (err as Error).message);
        }
      } finally {
        setRunning(false);
      }
    })();

    sseRef.current = { close: () => ctrl.abort() } as unknown as EventSource;
  };

  useEffect(() => () => { stop(); }, []);

  const passed  = progress.filter(p => p.ok).length;
  const failed  = progress.filter(p => !p.ok).length;
  const total   = summary?.total ?? totalKeys;
  const pct     = total > 0 ? Math.round((progress.length / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <Button
        size="sm"
        variant={running ? "destructive" : "outline"}
        className="gap-1.5 h-8 text-xs"
        onClick={start}
      >
        {running
          ? <><Square className="h-3.5 w-3.5" /> Stop Validation</>
          : <><FlaskConical className="h-3.5 w-3.5" /> Validate All ({totalKeys})</>
        }
      </Button>

      {show && (progress.length > 0 || running) && (
        <div className="rounded-xl border border-border bg-card/60 p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {running ? "Validating…" : "Complete"} — {progress.length}/{total} keys
            </span>
            <div className="flex items-center gap-3">
              <span className="text-emerald-400 flex items-center gap-1"><Wifi className="h-3 w-3" />{passed} OK</span>
              {failed > 0 && <span className="text-red-400 flex items-center gap-1"><WifiOff className="h-3 w-3" />{failed} failed</span>}
            </div>
          </div>

          <Progress value={pct} className="h-1.5" />

          {summary && (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-white font-medium">Validation complete:</span>
              <span className="text-emerald-400">{summary.passed} passed</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-red-400">{summary.failed} failed</span>
            </div>
          )}

          {progress.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {[...progress].reverse().slice(0, 30).map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {r.ok
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                    : <XCircle className="h-3 w-3 text-red-400 shrink-0" />
                  }
                  <span className="text-muted-foreground w-20 shrink-0 truncate">{r.providerSlug}</span>
                  <code className="font-mono text-xs text-foreground/60 shrink-0">{r.prefix.slice(0, 16)}</code>
                  {r.ok
                    ? <span className="text-emerald-400 shrink-0">{r.latencyMs}ms</span>
                    : <span className="text-red-400 truncate">{r.error ?? "failed"}</span>
                  }
                </div>
              ))}
              {progress.length > 30 && (
                <p className="text-xs text-muted-foreground text-center">… and {progress.length - 30} more</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Request log table ──────────────────────────────────────────────────────────

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

// ── Bulk Actions Bar ───────────────────────────────────────────────────────────

function BulkActionsBar({
  selectedIds,
  onClear,
  onDone,
  providers,
}: {
  selectedIds: string[];
  onClear: () => void;
  onDone: () => void;
  providers: ProviderHealthReport[];
}) {
  const qc = useQueryClient();
  const [moveOpen,   setMoveOpen]   = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const [valOpen,    setValOpen]    = useState(false);
  const [valRunning, setValRunning] = useState(false);
  const [valProgress, setValProgress] = useState<ValidationProgress[]>([]);
  const [valSummary,  setValSummary]  = useState<ValidationSummary | null>(null);
  const valCtrlRef = useRef<{ close: () => void } | null>(null);

  const bulk = useMutation({
    mutationFn: (action: "enable" | "disable" | "delete") =>
      apiFetch<{ data: { count: number } }>(`${BASE}/bulk`, {
        method: "POST",
        body: JSON.stringify({ action, keyIds: selectedIds }),
      }),
    onSuccess: (r, action) => {
      toast.success(`${action}d ${r.data.count} key(s)`);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const moveMut = useMutation({
    mutationFn: () =>
      apiFetch<{ data: { count: number } }>(`${BASE}/bulk/move`, {
        method: "POST",
        body: JSON.stringify({ keyIds: selectedIds, targetSlug: moveTarget }),
      }),
    onSuccess: (r) => {
      toast.success(`Moved ${r.data.count} key(s) to ${moveTarget}`);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
      setMoveOpen(false);
      onDone();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const startValidateSelected = () => {
    setValProgress([]);
    setValSummary(null);
    setValRunning(true);
    setValOpen(true);
    const token = localStorage.getItem("access_token") ?? "";
    const ctrl  = new AbortController();
    valCtrlRef.current = { close: () => ctrl.abort() };

    void (async () => {
      try {
        const res = await fetch(`/api/v1/ai-providers/validate-selected/stream`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ keyIds: selectedIds }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error("Stream failed");
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if ("total" in data) {
                  setValSummary(data as ValidationSummary);
                  void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
                } else {
                  setValProgress(prev => [...prev, data as ValidationProgress]);
                }
              } catch { /* skip */ }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") toast.error("Validation error: " + (err as Error).message);
      } finally {
        setValRunning(false);
      }
    })();
  };

  const stopValidate = () => {
    valCtrlRef.current?.close();
    setValRunning(false);
  };

  useEffect(() => () => { valCtrlRef.current?.close(); }, []);

  if (selectedIds.length === 0) return null;

  const passed = valProgress.filter(p => p.ok).length;
  const failed = valProgress.filter(p => !p.ok).length;
  const valPct = selectedIds.length > 0 ? Math.round((valProgress.length / selectedIds.length) * 100) : 0;

  return (
    <div className="sticky bottom-4 z-10 flex flex-col items-center gap-2">
      {/* Validate Selected results panel */}
      {valOpen && (valProgress.length > 0 || valRunning) && (
        <div className="rounded-xl border border-violet-500/20 bg-card/95 backdrop-blur p-4 shadow-lg w-full max-w-lg space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {valRunning ? "Validating selected…" : "Validation complete"} · {valProgress.length}/{selectedIds.length}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-emerald-400">{passed} OK</span>
              {failed > 0 && <span className="text-red-400">{failed} failed</span>}
              {valRunning && (
                <Button size="sm" variant="ghost" className="h-5 px-2 text-xs text-muted-foreground" onClick={stopValidate}>
                  <Square className="h-2.5 w-2.5 mr-1" /> Stop
                </Button>
              )}
              {!valRunning && (
                <Button size="sm" variant="ghost" className="h-5 px-2 text-xs text-muted-foreground" onClick={() => setValOpen(false)}>
                  ✕
                </Button>
              )}
            </div>
          </div>
          <Progress value={valPct} className="h-1" />
          {valSummary && (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> Done: {valSummary.passed} passed · {valSummary.failed} failed
            </p>
          )}
        </div>
      )}

      {/* Move To Provider dialog */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Move {selectedIds.length} key(s) to provider</DialogTitle></DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              Select the target provider. Keys will be reassigned immediately in the live pool.
            </p>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select provider…" />
              </SelectTrigger>
              <SelectContent>
                {providers.map(p => (
                  <SelectItem key={p.slug} value={p.slug} className="text-xs">
                    {p.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setMoveOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => moveMut.mutate()} disabled={!moveTarget || moveMut.isPending}>
              {moveMut.isPending ? "Moving…" : "Move Keys"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Main action bar */}
      <div className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-card/95 backdrop-blur px-4 py-2.5 shadow-lg flex-wrap justify-center">
        <span className="text-xs text-violet-300 font-medium">
          {selectedIds.length} key{selectedIds.length > 1 ? "s" : ""} selected
        </span>
        <div className="w-px h-4 bg-border mx-1" />
        <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-400 hover:text-emerald-300"
          onClick={() => bulk.mutate("enable")} disabled={bulk.isPending}>
          <Wifi className="h-3 w-3 mr-1" /> Enable
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-amber-400 hover:text-amber-300"
          onClick={() => bulk.mutate("disable")} disabled={bulk.isPending}>
          <WifiOff className="h-3 w-3 mr-1" /> Disable
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300"
          onClick={() => bulk.mutate("delete")} disabled={bulk.isPending}>
          <Trash2 className="h-3 w-3 mr-1" /> Delete
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button size="sm" variant="ghost" className="h-7 text-xs text-blue-400 hover:text-blue-300"
          onClick={valRunning ? stopValidate : startValidateSelected}>
          {valRunning
            ? <><Square className="h-3 w-3 mr-1" /> Stop</>
            : <><FlaskConical className="h-3 w-3 mr-1" /> Validate Selected</>
          }
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs text-cyan-400 hover:text-cyan-300"
          onClick={() => setMoveOpen(true)}>
          <Layers className="h-3 w-3 mr-1" /> Move To Provider
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={onClear}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "providers" | "import" | "requests";

export default function AIProvidersPage() {
  const qc                    = useQueryClient();
  const { data: health, isLoading, refetch, isFetching } = useHealth();
  const [tab, setTab]         = useState<Tab>("providers");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [importInitialRaw, setImportInitialRaw] = useState("");
  const restoreInputRef = useRef<HTMLInputElement>(null);

  const handleSelectKey = useCallback((id: string, checked: boolean) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const clearSelection = () => setSelectedKeys(new Set());

  const runHealthCheck = useMutation({
    mutationFn: () => apiFetch(`${BASE}/health-check`, { method: "POST" }),
    onSuccess: () => { toast.success("Health check complete"); void qc.invalidateQueries({ queryKey: ["ai-providers-health"] }); },
    onError:   (e) => toast.error((e as Error).message),
  });

  const deleteInvalid = useMutation({
    mutationFn: () => apiFetch<{ data: { count: number } }>(`${BASE}/invalid`, { method: "DELETE" }),
    onSuccess: (r) => {
      toast.success(`Removed ${r.data.count} invalid key(s)`);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const deleteDuplicates = useMutation({
    mutationFn: () => apiFetch<{ data: { count: number } }>(`${BASE}/duplicates`, { method: "DELETE" }),
    onSuccess: (r) => {
      toast.success(`Removed ${r.data.count} duplicate key(s)`);
      void qc.invalidateQueries({ queryKey: ["ai-providers-health"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const handleExport = async () => {
    try {
      const result = await apiFetch<{ data: object[] }>(`${BASE}/export`);
      const json   = JSON.stringify(result.data, null, 2);
      const blob   = new Blob([json], { type: "application/json" });
      const url    = URL.createObjectURL(blob);
      const a      = document.createElement("a");
      a.href       = url;
      a.download   = `ai-providers-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleBackup = async () => {
    try {
      const result = await apiFetch<{ data: object[] }>(`${BASE}/export`);
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        keys: result.data,
      };
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ai-providers-backup-${new Date().toISOString().slice(0, 16).replace("T", "_")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup downloaded", { description: "Upload this file with Restore to import the key list later." });
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setImportInitialRaw(text);
      setTab("import");
      toast.info("File loaded", { description: "Review the keys below, then press Import." });
    };
    reader.readAsText(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const overallStatusColor = (() => {
    if (!health) return "text-muted-foreground";
    const rate = health.overallSuccess;
    if (rate >= 0.95) return "text-emerald-400";
    if (rate >= 0.80) return "text-amber-400";
    return "text-red-400";
  })();

  const sortedProviders     = health?.providers.slice().sort((a, b) => a.priority - b.priority) ?? [];
  const currentActiveProvider = sortedProviders.find(p => p.enabled && p.activeKeys > 0);
  const totalEnabledKeys    = health?.activeKeys ?? 0;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border bg-background/90 backdrop-blur px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
              <Cpu className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-white">AI Providers Manager</h1>
              <p className="text-xs text-muted-foreground">
                Multi-provider orchestration · bulk import · auto-discovery · key pool · failover
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={handleBackup}>
              <Download className="h-3.5 w-3.5" /> Backup
            </Button>
            <label>
              <input
                type="file"
                accept=".txt,.json,.csv,.env,text/plain"
                className="sr-only"
                ref={restoreInputRef}
                onChange={handleRestoreFile}
              />
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs cursor-pointer" asChild>
                <span><Upload className="h-3.5 w-3.5" /> Restore</span>
              </Button>
            </label>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs text-amber-400 hover:text-amber-300 border-amber-500/30"
              onClick={() => deleteInvalid.mutate()}
              disabled={deleteInvalid.isPending}
            >
              <Ban className="h-3.5 w-3.5" />
              {deleteInvalid.isPending ? "Removing…" : "Delete Invalid"}
            </Button>
            <Button
              size="sm" variant="outline"
              className="gap-1.5 h-8 text-xs text-orange-400 hover:text-orange-300 border-orange-500/30"
              onClick={() => deleteDuplicates.mutate()}
              disabled={deleteDuplicates.isPending}
            >
              <CopyIcon className="h-3.5 w-3.5" />
              {deleteDuplicates.isPending ? "Removing…" : "Delete Duplicates"}
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
              Health Check
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Summary cards ──────────────────────────────────────────────── */}
        {health && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { icon: <Server className="h-4 w-4" />,    label: "Active Providers", value: `${health.activeProviders} / ${health.totalProviders}`, color: "text-violet-400" },
                { icon: <Key className="h-4 w-4" />,       label: "Key Pool",         value: `${health.activeKeys} active / ${health.totalKeys} total`, color: "text-blue-400" },
                { icon: <TrendingUp className="h-4 w-4" />,label: "Overall Success",  value: pct(health.overallSuccess), color: overallStatusColor },
                { icon: <Zap className="h-4 w-4" />,       label: "Avg Latency",      value: fmt(health.avgLatencyMs),    color: "text-amber-400" },
              ].map(({ icon, label, value, color }) => (
                <Card key={label} className="border-border bg-card/60 p-4">
                  <div className={`flex items-center gap-2 mb-2 ${color}`}>{icon}<span className="text-xs text-muted-foreground">{label}</span></div>
                  <p className="text-xl font-bold text-white leading-tight">{value}</p>
                </Card>
              ))}
            </div>

            {currentActiveProvider && (
              <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
                <Star className="h-4 w-4 text-violet-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-muted-foreground">Active Provider: </span>
                  <span className="text-sm font-semibold text-white">{currentActiveProvider.displayName}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {currentActiveProvider.activeKeys} key{currentActiveProvider.activeKeys !== 1 ? "s" : ""} ready
                    · {pct(currentActiveProvider.successRate)} success
                    · {fmt(currentActiveProvider.avgLatencyMs)} avg
                  </span>
                </div>
                <ProviderStatusBadge status={currentActiveProvider.status} />
              </div>
            )}
          </>
        )}

        {/* ── Validate All ─────────────────────────────────────────────────── */}
        {totalEnabledKeys > 0 && (
          <ValidateAllButton totalKeys={totalEnabledKeys} />
        )}

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex gap-1 rounded-lg bg-muted/20 p-1 w-fit">
          {([
            ["providers", <Shield className="h-3.5 w-3.5" key="s" />,  "Providers"],
            ["import",    <Upload className="h-3.5 w-3.5" key="u" />,  "Import Keys"],
            ["requests",  <List   className="h-3.5 w-3.5" key="l" />,  "Request Log"],
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

        {/* ── Providers tab ─────────────────────────────────────────────────── */}
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
                selectedKeys={selectedKeys}
                onSelectKey={handleSelectKey}
              />
            ))}
          </div>
        )}

        {/* ── Import tab ────────────────────────────────────────────────────── */}
        {tab === "import" && (
          <ImportPanel
            key={importInitialRaw}
            initialRaw={importInitialRaw}
            onImported={() => { setTab("providers"); setImportInitialRaw(""); }}
          />
        )}

        {/* ── Request log tab ───────────────────────────────────────────────── */}
        {tab === "requests" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground/80">Recent Requests</span>
              <span className="text-xs text-muted-foreground/70">(last 50 · auto-refreshes every 15s)</span>
            </div>
            <RequestLogTable />
          </div>
        )}

        {health?.generatedAt && (
          <p className="text-xs text-muted-foreground/70 text-right">
            Last refreshed {relTime(health.generatedAt)}
          </p>
        )}
      </div>

      {/* ── Sticky bulk actions bar ───────────────────────────────────────── */}
      <BulkActionsBar
        selectedIds={[...selectedKeys]}
        onClear={clearSelection}
        onDone={clearSelection}
        providers={sortedProviders}
      />
    </div>
  );
}
