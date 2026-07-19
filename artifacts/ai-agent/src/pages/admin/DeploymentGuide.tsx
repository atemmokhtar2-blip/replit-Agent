import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, RefreshCw, Copy, Info } from "lucide-react";
import { toast } from "sonner";

interface EnvVar {
  key: string;
  required: boolean;
  present: boolean;
  description: string;
}

interface EnvGroup {
  name: string;
  vars: EnvVar[];
}

interface EnvReport {
  groups: EnvGroup[];
  summary: {
    total: number;
    present: number;
    missing_required: number;
    missing_required_keys: string[];
  };
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}` };
}

async function fetchEnvReport(): Promise<EnvReport> {
  const res = await fetch("/api/v1/admin/system/env", { headers: authHeader() });
  if (!res.ok) throw new Error("Failed to load env report");
  return res.json() as Promise<EnvReport>;
}

function EnvVarRow({ v }: { v: EnvVar }) {
  const copyKey = () => {
    void navigator.clipboard.writeText(v.key);
    toast.success(`Copied ${v.key}`);
  };

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
        v.present
          ? "border-green-500/20 bg-green-500/5"
          : v.required
          ? "border-red-500/30 bg-red-500/5"
          : "border-border bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {v.present ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
        ) : (
          <XCircle className={`h-3.5 w-3.5 flex-shrink-0 ${v.required ? "text-red-500" : "text-muted-foreground"}`} />
        )}
        <span className={`font-mono font-medium truncate ${v.required && !v.present ? "text-red-600 dark:text-red-400" : ""}`}>
          {v.key}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {v.required && (
          <Badge variant="outline" className="text-xs h-5 px-1.5">Required</Badge>
        )}
        <Badge
          className={`text-xs h-5 px-1.5 ${
            v.present
              ? "bg-green-500/10 text-green-600 border-green-500/30"
              : v.required
              ? "bg-red-500/10 text-red-600 border-red-500/30"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {v.present ? "SET" : "MISSING"}
        </Badge>
        <button
          onClick={copyKey}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={`Copy ${v.key}`}
        >
          <Copy className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export function DeploymentGuide() {
  const {
    data,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["admin-env-report"],
    queryFn: fetchEnvReport,
    refetchInterval: 60_000,
  });

  const copyAll = () => {
    if (!data) return;
    const lines = data.groups
      .flatMap((g) => g.vars)
      .map((v) => `${v.key}=`)
      .join("\n");
    void navigator.clipboard.writeText(lines);
    toast.success("Copied all env var keys as template");
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Deployment Guide</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            All environment variables required to deploy this application.
            Values are never shown — only whether each variable is set.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copyAll} disabled={!data}>
            <Copy className="h-3.5 w-3.5 mr-1.5" />
            Copy Template
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary bar */}
      {data && (
        <div className={`flex items-center gap-3 rounded-lg border p-3 text-sm ${
          data.summary.missing_required > 0
            ? "bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400"
            : "bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400"
        }`}>
          {data.summary.missing_required > 0 ? (
            <>
              <XCircle className="h-4 w-4 flex-shrink-0" />
              <span>
                <strong>{data.summary.missing_required}</strong> required variable(s) missing:{" "}
                {data.summary.missing_required_keys.join(", ")}
              </span>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              <span>
                All required variables are set ({data.summary.present}/{data.summary.total} total configured)
              </span>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive p-4 border border-destructive/30 rounded-lg bg-destructive/10">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          Failed to load environment report.
        </div>
      )}

      {/* Groups */}
      {isLoading ? (
        <div className="space-y-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      ) : (
        data?.groups.map((group) => (
          <div key={group.name} className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              {group.name}
              <span className="text-xs font-normal normal-case">
                ({group.vars.filter((v) => v.present).length}/{group.vars.length} set)
              </span>
            </h4>
            <div className="space-y-1.5">
              {group.vars.map((v) => (
                <div key={v.key} className="space-y-0.5">
                  <EnvVarRow v={v} />
                  <p className="text-xs text-muted-foreground pl-6">{v.description}</p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Info box */}
      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium text-foreground mb-1">How to configure</p>
          <ul className="space-y-1 list-none">
            <li><strong>Replit:</strong> Go to Secrets (lock icon) in the sidebar → add each variable</li>
            <li><strong>Vercel:</strong> Project Settings → Environment Variables → add each variable</li>
            <li><strong>Local:</strong> Create a <code className="bg-muted rounded px-1">.env</code> file in the repo root</li>
          </ul>
          <p className="mt-2">
            Actual values are never displayed here for security.
            Only presence/absence is shown.
          </p>
        </div>
      </div>
    </div>
  );
}
