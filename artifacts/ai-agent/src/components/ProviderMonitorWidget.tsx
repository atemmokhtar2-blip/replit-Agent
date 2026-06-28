import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Link } from "wouter";
import { useAuth } from "./AuthProvider";

interface ProviderStats {
  activeProviders:  number;
  totalProviders:   number;
  totalKeys:        number;
  activeKeys:       number;
  totalRequests:    number;
  overallSuccess:   number;
  avgLatencyMs:     number;
  currentStrategy:  string;
}

function useProviderStats() {
  return useQuery<ProviderStats>({
    queryKey: ["provider-stats"],
    queryFn: async () => {
      const res = await apiFetch("/api/v1/ai-providers/stats") as Response;
      const body = await res.json() as { ok: boolean; data: ProviderStats };
      if (!body.ok) throw new Error("Failed to fetch provider stats");
      return body.data;
    },
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      {active && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
      )}
      <span
        className={[
          "relative inline-flex h-2 w-2 rounded-full",
          active ? "bg-emerald-500" : "bg-muted-foreground/30",
        ].join(" ")}
      />
    </span>
  );
}

export function ProviderMonitorWidget() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useProviderStats();

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const successPct = data ? Math.round(data.overallSuccess * 100) : null;
  const isHealthy = successPct !== null && successPct >= 80;
  const allDown = data ? data.activeProviders === 0 : false;

  if (isError || (!isLoading && !data)) return null;

  return (
    <div className="border-t border-border/40 px-3 pt-2 pb-2.5 space-y-1.5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StatusDot active={!allDown && !isLoading} />
          <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
            AI Providers
          </span>
        </div>
        {isAdmin && (
          <Link
            href="/ai-providers"
            className="text-[10px] text-primary/60 hover:text-primary transition-colors"
          >
            Manage
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 rounded bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Stat pills */}
          <div className="grid grid-cols-3 gap-1.5">
            <StatPill
              label="Active"
              value={`${data.activeProviders}/${data.totalProviders}`}
              ok={data.activeProviders > 0}
            />
            <StatPill
              label="Success"
              value={successPct !== null ? `${successPct}%` : "—"}
              ok={isHealthy}
            />
            <StatPill
              label="Keys"
              value={`${data.activeKeys}/${data.totalKeys}`}
              ok={data.activeKeys > 0}
            />
          </div>

          {/* Latency + strategy row */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[9px] text-muted-foreground/40 tabular-nums">
              {data.avgLatencyMs > 0 ? `~${Math.round(data.avgLatencyMs)}ms avg` : "no requests yet"}
            </span>
            <span className="text-[9px] text-muted-foreground/40 capitalize">
              {data.currentStrategy?.replace(/_/g, " ") ?? ""}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

function StatPill({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md bg-muted/30 border border-border/30 py-1 px-1.5">
      <span
        className={[
          "text-[11px] font-semibold tabular-nums leading-none",
          ok ? "text-emerald-500" : "text-amber-500",
        ].join(" ")}
      >
        {value}
      </span>
      <span className="text-[9px] text-muted-foreground/50 leading-none">{label}</span>
    </div>
  );
}
