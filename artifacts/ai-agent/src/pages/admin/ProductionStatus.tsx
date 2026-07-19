import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, Database,
  Shield, Cpu, HardDrive, Globe, Server, Clock, MemoryStick,
} from "lucide-react";

interface ComponentHealth {
  name: string;
  status: "healthy" | "warning" | "error";
  message: string;
  latency_ms?: number;
}

interface SystemStatus {
  overall: "healthy" | "warning" | "error";
  uptime_seconds: number;
  node_version: string;
  node_env: string;
  checks: ComponentHealth[];
}

interface SystemInfo {
  version: string;
  node_version: string;
  node_env: string;
  platform: string;
  arch: string;
  uptime_seconds: number;
  memory_mb: number;
  commit: string;
  build_time: string;
  replit_slug: string;
  deploy_url: string;
}

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}` };
}

async function fetchSystemStatus(): Promise<SystemStatus> {
  const res = await fetch("/api/v1/admin/system/status", { headers: authHeader() });
  if (!res.ok) throw new Error("Failed to load system status");
  return res.json() as Promise<SystemStatus>;
}

async function fetchSystemInfo(): Promise<SystemInfo> {
  const res = await fetch("/api/v1/admin/system/info", { headers: authHeader() });
  if (!res.ok) throw new Error("Failed to load system info");
  return res.json() as Promise<SystemInfo>;
}

function StatusIcon({ status }: { status: "healthy" | "warning" | "error" }) {
  if (status === "healthy") return <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />;
  if (status === "warning") return <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />;
  return <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />;
}

function StatusBadge({ status }: { status: "healthy" | "warning" | "error" }) {
  if (status === "healthy") {
    return <Badge className="bg-green-500/10 text-green-600 border-green-500/30 hover:bg-green-500/20">Healthy</Badge>;
  }
  if (status === "warning") {
    return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 hover:bg-yellow-500/20">Warning</Badge>;
  }
  return <Badge className="bg-red-500/10 text-red-600 border-red-500/30 hover:bg-red-500/20">Error</Badge>;
}

const componentIcons: Record<string, React.ReactNode> = {
  "Database":       <Database className="h-4 w-4" />,
  "Authentication": <Shield className="h-4 w-4" />,
  "AI Providers":   <Cpu className="h-4 w-4" />,
  "Storage":        <HardDrive className="h-4 w-4" />,
  "Sessions":       <Shield className="h-4 w-4" />,
  "Environment":    <Server className="h-4 w-4" />,
  "Deployment":     <Globe className="h-4 w-4" />,
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function ProductionStatus() {
  const {
    data: status,
    isLoading: statusLoading,
    error: statusError,
    refetch: refetchStatus,
    isFetching: statusFetching,
  } = useQuery({
    queryKey: ["admin-system-status"],
    queryFn: fetchSystemStatus,
    refetchInterval: 30_000,
  });

  const { data: info, isLoading: infoLoading } = useQuery({
    queryKey: ["admin-system-info"],
    queryFn: fetchSystemInfo,
    refetchInterval: 60_000,
  });

  const overallStatus = status?.overall ?? "error";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Production Status</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time health check of all system components
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetchStatus()}
          disabled={statusFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${statusFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Overall status banner */}
      {!statusLoading && status && (
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${
            overallStatus === "healthy"
              ? "bg-green-500/10 border-green-500/30"
              : overallStatus === "warning"
              ? "bg-yellow-500/10 border-yellow-500/30"
              : "bg-red-500/10 border-red-500/30"
          }`}
        >
          <StatusIcon status={overallStatus} />
          <div>
            <p className="font-medium">
              {overallStatus === "healthy"
                ? "All systems operational"
                : overallStatus === "warning"
                ? "Some systems need attention"
                : "Critical issues detected"}
            </p>
            <p className="text-sm text-muted-foreground">
              Uptime: {formatUptime(status.uptime_seconds)} · {status.node_env} · Node {status.node_version}
            </p>
          </div>
        </div>
      )}

      {statusError && (
        <div className="flex items-center gap-2 text-sm text-destructive p-4 border border-destructive/30 rounded-lg bg-destructive/10">
          <XCircle className="h-4 w-4 flex-shrink-0" />
          Failed to load system status. Please check server connectivity.
        </div>
      )}

      {/* Component checks grid */}
      <div className="grid gap-3 md:grid-cols-2">
        {statusLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))
          : status?.checks.map((check) => (
              <Card key={check.name} className="border">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      {componentIcons[check.name] ?? <Server className="h-4 w-4" />}
                      <span className="text-sm font-medium text-foreground">{check.name}</span>
                    </div>
                    <StatusBadge status={check.status} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{check.message}</p>
                  {check.latency_ms !== undefined && (
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Latency: {check.latency_ms}ms
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
      </div>

      {/* System info cards */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Uptime
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {infoLoading ? <Skeleton className="h-6 w-24" /> : (
              <p className="text-lg font-bold">{info ? formatUptime(info.uptime_seconds) : "—"}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <MemoryStick className="h-3.5 w-3.5" /> Memory
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {infoLoading ? <Skeleton className="h-6 w-24" /> : (
              <p className="text-lg font-bold">{info ? `${info.memory_mb} MB` : "—"}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Server className="h-3.5 w-3.5" /> Version
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {infoLoading ? <Skeleton className="h-6 w-24" /> : (
              <p className="text-lg font-bold">{info?.version ?? "—"}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" /> Environment
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {infoLoading ? <Skeleton className="h-6 w-24" /> : (
              <p className="text-lg font-bold capitalize">{info?.node_env ?? "—"}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Build info */}
      {info && info.commit !== "unknown" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Build Information</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
              {info.commit !== "unknown" && (
                <>
                  <dt className="text-muted-foreground">Commit</dt>
                  <dd className="font-mono text-xs">{info.commit.slice(0, 12)}</dd>
                </>
              )}
              {info.build_time !== "unknown" && (
                <>
                  <dt className="text-muted-foreground">Build Time</dt>
                  <dd>{info.build_time}</dd>
                </>
              )}
              {info.deploy_url !== "unknown" && (
                <>
                  <dt className="text-muted-foreground">Deploy URL</dt>
                  <dd className="truncate text-xs">{info.deploy_url}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Platform</dt>
              <dd>{info.platform} / {info.arch}</dd>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
