import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Sparkles, RefreshCw, Filter, Search, CheckCircle2, XCircle,
  Zap, Eye, Wrench, Brain, DollarSign, Cpu, Clock, BarChart3,
  ChevronDown, ChevronUp, Globe, Star,
} from "lucide-react";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Badge }   from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DiscoveredModel {
  id: string;
  providerSlug: string;
  modelId: string;
  displayName: string;
  description?: string;
  contextLength?: number;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  isFree: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  categories: string[];
  rankScore: number;
  priority: number;
  enabled: boolean;
  lastDiscoveredAt: string;
}

interface DiscoveryStatus {
  lastRun: string | null;
  isRunning: boolean;
}

// ── API helpers ────────────────────────────────────────────────────────────────

const BASE = "/api/v1/ai-providers";

function useModels(opts: { provider?: string; free?: boolean; category?: string; search?: string }) {
  return useQuery<{ models: DiscoveredModel[]; total: number }>({
    queryKey: ["ai-models", opts],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts.provider && opts.provider !== "all") params.set("provider", opts.provider);
      if (opts.free)     params.set("free", "true");
      if (opts.category && opts.category !== "all") params.set("category", opts.category);
      params.set("limit", "500");
      const r = await apiFetch<{ data: DiscoveredModel[]; total: number }>(`${BASE}/models?${params}`);
      let models = r.data;
      if (opts.search) {
        const q = opts.search.toLowerCase();
        models = models.filter(m =>
          m.modelId.toLowerCase().includes(q) ||
          m.displayName.toLowerCase().includes(q) ||
          m.description?.toLowerCase().includes(q),
        );
      }
      return { models, total: r.total };
    },
    refetchInterval: 60_000,
  });
}

function useDiscoveryStatus() {
  return useQuery<DiscoveryStatus>({
    queryKey: ["ai-discovery-status"],
    queryFn: () => apiFetch<{ data: DiscoveryStatus }>(`${BASE}/models/discovery-status`).then(r => r.data),
    refetchInterval: 10_000,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: "OpenRouter", gemini: "Gemini", groq: "Groq",
  cloudflare: "Cloudflare", mistral: "Mistral", openai: "OpenAI",
  anthropic: "Anthropic", deepseek: "DeepSeek", xai: "xAI Grok",
  cohere: "Cohere", huggingface: "HuggingFace",
};

const CATEGORY_LABELS: Record<string, string> = {
  free: "Free", paid: "Paid", coding: "Coding", reasoning: "Reasoning",
  fast: "Fast", vision: "Vision", "long-context": "Long Context",
  multimodal: "Multimodal", general: "General",
};

const CAT_COLORS: Record<string, string> = {
  free:            "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paid:            "bg-amber-500/15 text-amber-400 border-amber-500/30",
  coding:          "bg-blue-500/15 text-blue-400 border-blue-500/30",
  reasoning:       "bg-purple-500/15 text-purple-400 border-purple-500/30",
  fast:            "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  vision:          "bg-pink-500/15 text-pink-400 border-pink-500/30",
  "long-context":  "bg-orange-500/15 text-orange-400 border-orange-500/30",
  multimodal:      "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  general:         "bg-muted/60 text-muted-foreground border-border",
};

function fmtPrice(price?: number): string {
  if (price === undefined || price === null) return "—";
  if (price === 0) return "Free";
  if (price < 1)   return `$${price.toFixed(3)}/1M`;
  return `$${price.toFixed(2)}/1M`;
}

function fmtCtx(ctx?: number): string {
  if (!ctx) return "—";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(1)}M`;
  if (ctx >= 1_000)     return `${Math.round(ctx / 1_000)}K`;
  return String(ctx);
}

function relTime(iso?: string | null): string {
  if (!iso) return "never";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60)    return `${sec}s ago`;
  if (sec < 3600)  return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── Capability icons ───────────────────────────────────────────────────────────

function CapBadge({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <span title={label} className={`inline-flex items-center gap-0.5 text-xs ${active ? "text-foreground/80" : "text-muted-foreground/50"}`}>
      {icon}
    </span>
  );
}

// ── Model row ──────────────────────────────────────────────────────────────────

function ModelRow({ m, expanded, onToggle }: { m: DiscoveredModel; expanded: boolean; onToggle: () => void }) {
  const score = m.rankScore ?? 0;
  const scoreColor = score >= 70 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-muted-foreground";

  return (
    <div className={`rounded-lg border border-border/50 bg-muted/10 transition-all ${expanded ? "border-violet-500/30" : ""}`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/10 rounded-lg"
      >
        {/* Provider dot */}
        <div className="w-2 h-2 rounded-full bg-violet-500/60 shrink-0" />

        {/* Model name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white truncate max-w-[260px]" title={m.modelId}>
              {m.displayName !== m.modelId ? m.displayName : m.modelId.split("/").pop()}
            </span>
            <span className="text-xs text-muted-foreground/70 font-mono truncate max-w-[180px]" title={m.modelId}>
              {m.providerSlug}/{m.modelId.split("/").pop() ?? m.modelId}
            </span>
            {/* Category tags */}
            {m.categories.slice(0, 3).map(c => (
              <Badge key={c} variant="outline" className={`text-[10px] h-4 px-1.5 ${CAT_COLORS[c] ?? "bg-muted/60 text-muted-foreground border-border"}`}>
                {CATEGORY_LABELS[c] ?? c}
              </Badge>
            ))}
          </div>
        </div>

        {/* Capabilities icons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <CapBadge icon={<Eye className="h-3 w-3"    />} label="Vision"    active={m.supportsVision}    />
          <CapBadge icon={<Wrench className="h-3 w-3" />} label="Tools"     active={m.supportsTools}     />
          <CapBadge icon={<Brain className="h-3 w-3"  />} label="Reasoning" active={m.supportsReasoning} />
          <CapBadge icon={<Zap className="h-3 w-3"    />} label="Streaming" active={m.supportsStreaming} />
        </div>

        {/* Context */}
        <div className="w-16 text-right text-xs text-muted-foreground shrink-0">{fmtCtx(m.contextLength)}</div>

        {/* Price */}
        <div className="w-20 text-right text-xs shrink-0">
          {m.isFree
            ? <span className="text-emerald-400 font-medium">Free</span>
            : <span className="text-muted-foreground">{fmtPrice(m.inputPricePer1M)}</span>
          }
        </div>

        {/* Score */}
        <div className={`w-12 text-right text-xs font-mono shrink-0 ${scoreColor}`}>{Math.round(score)}</div>

        {/* Expand icon */}
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {m.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">{m.description}</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Context",    value: fmtCtx(m.contextLength) },
              { label: "Input Price",  value: fmtPrice(m.inputPricePer1M)  },
              { label: "Output Price", value: fmtPrice(m.outputPricePer1M) },
              { label: "Rank Score",   value: Math.round(m.rankScore).toString() },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-md bg-muted/15 px-2.5 py-2">
                <p className="text-[10px] text-muted-foreground mb-0.5">{label}</p>
                <p className="text-sm font-medium text-white">{value}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
            <span>ID: <code className="text-muted-foreground">{m.modelId}</code></span>
            <span>Discovered {relTime(m.lastDiscoveredAt)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const ALL_CATEGORIES = ["all", "free", "paid", "coding", "reasoning", "fast", "vision", "long-context", "general"];
const ALL_PROVIDERS  = ["all", "openrouter", "groq", "openai", "anthropic", "deepseek", "xai", "gemini", "cohere", "mistral", "huggingface", "cloudflare"];

export default function AIModelsPage() {
  const qc = useQueryClient();

  const [search,   setSearch]   = useState("");
  const [provider, setProvider] = useState("all");
  const [category, setCategory] = useState("all");
  const [onlyFree, setOnlyFree] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading, error } = useModels({ provider, free: onlyFree, category, search });
  const { data: status }          = useDiscoveryStatus();

  const discover = useMutation({
    mutationFn: () => apiFetch(`${BASE}/models/discover`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Model discovery started");
      void qc.invalidateQueries({ queryKey: ["ai-models"] });
      void qc.invalidateQueries({ queryKey: ["ai-discovery-status"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const models = data?.models ?? [];
  const total  = data?.total ?? 0;

  // Group by provider
  const byProvider: Record<string, DiscoveredModel[]> = {};
  for (const m of models) {
    (byProvider[m.providerSlug] ??= []).push(m);
  }

  const providerCounts = Object.entries(byProvider)
    .sort((a, b) => b[1].length - a[1].length);

  const freeCount = models.filter(m => m.isFree).length;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-violet-400" />
            AI Model Discovery
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Discovered models across all configured providers — ranked by capability and cost.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className="text-xs text-muted-foreground">
              {status.isRunning
                ? <><RefreshCw className="inline h-3 w-3 mr-1 animate-spin" />Scanning…</>
                : `Updated ${relTime(status.lastRun)}`}
            </span>
          )}
          <Button
            size="sm" variant="outline"
            className="gap-1.5 h-8"
            onClick={() => discover.mutate()}
            disabled={discover.isPending || status?.isRunning}
          >
            {discover.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Models",    value: total.toString(),           icon: <Globe className="h-4 w-4 text-violet-400" />  },
          { label: "Free Models",     value: freeCount.toString(),       icon: <Star className="h-4 w-4 text-emerald-400" />  },
          { label: "Providers",       value: providerCounts.length.toString(), icon: <Cpu className="h-4 w-4 text-blue-400" /> },
          { label: "Last Discovery",  value: relTime(status?.lastRun),   icon: <Clock className="h-4 w-4 text-amber-400" />   },
        ].map(({ label, value, icon }) => (
          <Card key={label} className="border-border bg-card/60">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                {icon}
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
              <p className="text-2xl font-bold text-white">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Provider breakdown */}
      {providerCounts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {providerCounts.map(([slug, ms]) => (
            <button
              key={slug}
              onClick={() => setProvider(provider === slug ? "all" : slug)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border transition-all ${
                provider === slug
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-300"
                  : "bg-muted/15 border-border text-muted-foreground hover:text-foreground/90"
              }`}
            >
              <span>{PROVIDER_LABELS[slug] ?? slug}</span>
              <span className="text-muted-foreground">{ms.length}</span>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search models…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 w-56 text-sm bg-card border-white/10"
          />
        </div>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_CATEGORIES.map(c => (
              <SelectItem key={c} value={c} className="text-xs">
                {c === "all" ? "All categories" : CATEGORY_LABELS[c] ?? c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={() => setOnlyFree(!onlyFree)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs border transition-all ${
            onlyFree
              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
              : "bg-muted/15 border-border text-muted-foreground hover:text-foreground/90"
          }`}
        >
          <DollarSign className="h-3 w-3" />
          Free only
        </button>

        {(search || provider !== "all" || category !== "all" || onlyFree) && (
          <button
            className="text-xs text-muted-foreground hover:text-foreground/80"
            onClick={() => { setSearch(""); setProvider("all"); setCategory("all"); setOnlyFree(false); }}
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">{models.length} models shown</span>
      </div>

      {/* Table header */}
      {models.length > 0 && (
        <div className="flex items-center gap-3 px-4 text-xs text-muted-foreground/70 select-none">
          <div className="w-2 shrink-0" />
          <div className="flex-1">Model</div>
          <div className="flex items-center gap-1.5 shrink-0 w-20">
            <Eye className="h-3 w-3" /><Wrench className="h-3 w-3" /><Brain className="h-3 w-3" /><Zap className="h-3 w-3" />
          </div>
          <div className="w-16 text-right">Context</div>
          <div className="w-20 text-right">Price</div>
          <div className="w-12 text-right flex items-center justify-end gap-1"><BarChart3 className="h-3 w-3" />Score</div>
          <div className="w-4 shrink-0" />
        </div>
      )}

      {/* Model list */}
      <div className="space-y-1.5">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin mr-2" />Loading models…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-20 text-red-400 gap-2">
            <XCircle className="h-5 w-5" />Failed to load models
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Sparkles className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-muted-foreground text-sm">No models discovered yet.</p>
            <p className="text-muted-foreground/70 text-xs">Configure a provider API key and click Refresh to discover models.</p>
            <Button size="sm" onClick={() => discover.mutate()} disabled={discover.isPending}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${discover.isPending ? "animate-spin" : ""}`} />
              Discover Now
            </Button>
          </div>
        ) : (
          models.map(m => (
            <ModelRow
              key={m.id}
              m={m}
              expanded={expanded === m.id}
              onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
            />
          ))
        )}
      </div>

      {/* Legend */}
      {models.length > 0 && (
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground/70 pt-2 border-t border-border/50">
          <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> Vision</span>
          <span className="flex items-center gap-1"><Wrench className="h-3 w-3" /> Tools/Function Calling</span>
          <span className="flex items-center gap-1"><Brain className="h-3 w-3" /> Reasoning</span>
          <span className="flex items-center gap-1"><Zap className="h-3 w-3" /> Streaming</span>
          <span className="ml-auto">Score = free tier bonus + capabilities + context rank</span>
        </div>
      )}
    </div>
  );
}
