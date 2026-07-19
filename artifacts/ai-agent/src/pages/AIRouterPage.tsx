/**
 * AI Router — Phase 2
 *
 * Shows which provider + model the AI Router would select for each task type,
 * based on live performance data and ranking scores.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Route, Brain, Code2, Bug, BookOpen, GitMerge, CheckCheck, Zap,
  RefreshCw, Sparkles, Server, BarChart3, Cpu, ArrowRight, Clock, Star,
  Eye, Wrench,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RouterRecommendation {
  taskType: string;
  provider: string;
  providerDisplay: string;
  model: string;
  score: number;
  reason: string;
  isFree: boolean;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsReasoning: boolean;
}

interface RouterResponse {
  recommendations: RouterRecommendation[];
  generatedAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const BASE = "/ai-providers";

const TASK_META: Record<string, { label: string; icon: React.ReactNode; description: string; color: string }> = {
  "planning":      { label: "Planning",       icon: <Brain className="h-4 w-4" />,     description: "Architecture design, project planning, roadmaps",          color: "text-violet-400" },
  "code-gen":      { label: "Code Gen",        icon: <Code2 className="h-4 w-4" />,     description: "Writing new code, implementing features",                  color: "text-blue-400"   },
  "debugging":     { label: "Debugging",       icon: <Bug className="h-4 w-4" />,       description: "Finding and fixing bugs, error analysis",                  color: "text-red-400"    },
  "documentation": { label: "Documentation",   icon: <BookOpen className="h-4 w-4" />,  description: "Writing docs, comments, READMEs",                          color: "text-emerald-400"},
  "review":        { label: "Code Review",     icon: <GitMerge className="h-4 w-4" />, description: "Reviewing code quality, security, best practices",          color: "text-amber-400"  },
  "verification":  { label: "Verification",    icon: <CheckCheck className="h-4 w-4" />,description: "Verifying correctness, testing, QA",                       color: "text-cyan-400"   },
  "general":       { label: "General",         icon: <Sparkles className="h-4 w-4" />,  description: "General-purpose tasks, Q&A, analysis",                     color: "text-pink-400"   },
};

const PROVIDER_COLORS: Record<string, string> = {
  openrouter: "#7c3aed", openai: "#10a37f", anthropic: "#d97706",
  gemini: "#3b82f6", groq: "#f97316", xai: "#06b6d4",
  mistral: "#ec4899", deepseek: "#8b5cf6", cohere: "#14b8a6",
  huggingface: "#f59e0b", "hf-space": "#6366f1",
};

function useRouter() {
  return useQuery<RouterResponse>({
    queryKey: ["ai-router-recommendations"],
    queryFn: () => apiFetch<{ data: RouterResponse }>(`${BASE}/router`).then(r => r.data),
    refetchInterval: 60_000,
  });
}

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? "bg-emerald-500" : score >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted/30">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono text-muted-foreground w-6 text-right">{score}</span>
    </div>
  );
}

// ── Recommendation card ────────────────────────────────────────────────────────

function RecCard({ rec }: { rec: RouterRecommendation }) {
  const meta   = TASK_META[rec.taskType] ?? TASK_META["general"]!;
  const pcol   = PROVIDER_COLORS[rec.provider] ?? "#6366f1";
  const shortModel = rec.model.split("/").pop() ?? rec.model;

  return (
    <Card className="border-border bg-card/60 hover:border-border/80 transition-colors">
      <CardContent className="p-4 space-y-3">
        {/* Task type header */}
        <div className="flex items-center gap-2">
          <div className={`${meta.color}`}>{meta.icon}</div>
          <span className="text-sm font-semibold text-white">{meta.label}</span>
          {rec.isFree && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 ml-auto">
              Free
            </Badge>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{meta.description}</p>

        {/* Recommendation */}
        <div className="rounded-lg border border-border/60 bg-muted/15 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Server className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Provider:</span>
            <span className="text-xs font-medium" style={{ color: pcol }}>{rec.providerDisplay}</span>
          </div>
          <div className="flex items-start gap-2">
            <Cpu className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
            <span className="text-xs text-muted-foreground shrink-0">Model:</span>
            <code className="text-xs font-mono text-foreground/80 leading-tight break-all" title={rec.model}>
              {shortModel}
            </code>
          </div>
          <ScoreBar score={rec.score} />
        </div>

        {/* Capabilities */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
          {rec.supportsVision    && <span className="flex items-center gap-1"><Eye className="h-3 w-3" />Vision</span>}
          {rec.supportsTools     && <span className="flex items-center gap-1"><Wrench className="h-3 w-3" />Tools</span>}
          {rec.supportsReasoning && <span className="flex items-center gap-1"><Brain className="h-3 w-3" />Reasoning</span>}
        </div>

        {/* Reason */}
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed italic">
          {rec.reason}
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AIRouterPage() {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch, isFetching } = useRouter();

  const discoverAndRoute = useMutation({
    mutationFn: () => apiFetch(`${BASE}/models/discover`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Model discovery triggered — recommendations will update");
      void qc.invalidateQueries({ queryKey: ["ai-router-recommendations"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const recs = data?.recommendations ?? [];
  const hasFree = recs.some(r => r.isFree);
  const providerSet = new Set(recs.map(r => r.provider));

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
            <Route className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">AI Router</h1>
            <p className="text-xs text-muted-foreground">Smart model selection · ranked by capability, speed, and cost</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm" variant="outline" className="gap-1.5 h-8 text-xs"
            onClick={() => discoverAndRoute.mutate()} disabled={discoverAndRoute.isPending}
          >
            {discoverAndRoute.isPending
              ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              : <Sparkles className="h-3.5 w-3.5" />
            }
            Discover &amp; Update
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => { void refetch(); }} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Status bar */}
      {data && (
        <div className="flex items-center gap-4 rounded-xl border border-border/50 bg-muted/10 px-4 py-3 text-xs flex-wrap">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Updated {new Date(data.generatedAt).toLocaleTimeString()}
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Server className="h-3.5 w-3.5" />
            {providerSet.size} provider{providerSet.size !== 1 ? "s" : ""} active
          </div>
          {hasFree && (
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Star className="h-3.5 w-3.5" />
              Free models available
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5 text-muted-foreground/60 text-[11px]">
            <BarChart3 className="h-3 w-3" />
            Score = discovery rank + performance history
          </div>
        </div>
      )}

      {/* How it works */}
      <Card className="border-border/50 bg-card/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Route className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground/80">How the AI Router works</p>
              <p>
                Every request is routed to the best available model for its task type.
                Rankings are computed from: model capability scores · provider health · actual success rates · response latency.
                Free models are preferred when quality is comparable.
                If the top choice fails, the router automatically falls back to the next best option.
              </p>
              <div className="flex items-center gap-2 mt-2 text-foreground/60">
                <span>Ranked models</span>
                <ArrowRight className="h-3 w-3" />
                <span>Provider selection</span>
                <ArrowRight className="h-3 w-3" />
                <span>Key rotation</span>
                <ArrowRight className="h-3 w-3" />
                <span>Automatic failover</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading / Error */}
      {isLoading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mr-2" /> Loading recommendations…
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center justify-center py-20 text-red-400 gap-3">
          <Zap className="h-8 w-8" />
          <p>Failed to load router recommendations</p>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>Retry</Button>
        </div>
      )}

      {/* Recommendation grid */}
      {data && recs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {recs.map(rec => (
            <RecCard key={rec.taskType} rec={rec} />
          ))}
        </div>
      )}

      {data && recs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <Route className="h-12 w-12 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm text-center max-w-sm">
            No routing recommendations yet. Configure provider API keys and run model discovery to enable smart routing.
          </p>
          <Button size="sm" onClick={() => discoverAndRoute.mutate()} disabled={discoverAndRoute.isPending}>
            {discoverAndRoute.isPending
              ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Discovering…</>
              : <><Sparkles className="h-3.5 w-3.5 mr-1.5" />Run Discovery</>
            }
          </Button>
        </div>
      )}
    </div>
  );
}
