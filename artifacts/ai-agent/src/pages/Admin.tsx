import { useState } from "react";
import { useGetSystemStats, useAdminListUsers, useAdminListProjects, useListAuditLogs } from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Users, Layout, ShieldCheck, Activity, KeyRound, MonitorCheck, BookOpen,
  CheckCircle2, XCircle, Loader2, RefreshCw, Copy, ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ProductionStatus } from "./admin/ProductionStatus";
import { DeploymentGuide } from "./admin/DeploymentGuide";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProviderStatus {
  provider: string;
  env_configured: boolean;
  db_configured: boolean;
  is_active: boolean;
  redirect_uri: string | null;
  client_id: string | null;
  has_client_secret: boolean;
  db_is_enabled: boolean;
  updated_at: string | null;
}

interface ProvidersResponse {
  providers: ProviderStatus[];
}

interface TestResult {
  ok: boolean;
  message: string;
  latency_ms?: number;
  source?: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

function authHeader() {
  return { Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}` };
}

async function fetchProviders(): Promise<ProvidersResponse> {
  const res = await fetch("/api/v1/admin/auth/providers", { headers: authHeader() });
  if (!res.ok) throw new Error("Failed to load auth providers");
  return res.json() as Promise<ProvidersResponse>;
}

async function testProvider(provider: string): Promise<TestResult> {
  const res = await fetch(`/api/v1/admin/auth/providers/${provider}/test`, {
    method: "POST",
    headers: authHeader(),
  });
  return res.json() as Promise<TestResult>;
}

// ── Google status card ────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GoogleStatusCard({
  status,
  onRefresh,
}: {
  status: ProviderStatus;
  onRefresh: () => void;
}) {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider("google");
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Test request failed — check network connectivity." });
    } finally {
      setTesting(false);
    }
  };

  const copyRedirectUri = () => {
    if (status.redirect_uri) {
      void navigator.clipboard.writeText(status.redirect_uri);
      toast.success("Copied", { description: "Redirect URI copied to clipboard." });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <GoogleIcon />
            <div>
              <CardTitle className="text-base">Google OAuth 2.0</CardTitle>
              <CardDescription className="mt-0.5">
                Allow users to sign in with their Google account.
              </CardDescription>
            </div>
          </div>

          {/* Status badge */}
          {status.is_active ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-500 flex-shrink-0">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive flex-shrink-0">
              <XCircle className="h-3.5 w-3.5" />
              Not Configured
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Credential source pills */}
        <div className="flex flex-wrap gap-2">
          <CredentialPill
            label="GOOGLE_CLIENT_ID"
            present={status.env_configured}
          />
          <CredentialPill
            label="GOOGLE_CLIENT_SECRET"
            present={status.env_configured}
          />
          {!status.env_configured && status.db_configured && (
            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground">
              Configured via admin database override
            </span>
          )}
        </div>

        {/* Redirect URI — admin needs to paste this into Google Console */}
        {status.redirect_uri && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Authorized Redirect URI
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono text-foreground break-all">
                {status.redirect_uri}
              </code>
              <button
                type="button"
                onClick={copyRedirectUri}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                title="Copy to clipboard"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add this URI to your{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                Google Cloud Console
                <ExternalLink className="h-3 w-3" />
              </a>
              {" "}under Authorized Redirect URIs.
            </p>
          </div>
        )}

        {/* Not configured instructions */}
        {!status.is_active && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How to enable Google login</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>
                Go to{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  Google Cloud Console → Credentials
                </a>
              </li>
              <li>Create an OAuth 2.0 Client ID (Web application)</li>
              <li>Add the Authorized Redirect URI shown above</li>
              <li>
                Set <code className="bg-muted px-1 rounded">GOOGLE_CLIENT_ID</code> and{" "}
                <code className="bg-muted px-1 rounded">GOOGLE_CLIENT_SECRET</code> in Secrets
              </li>
              <li>Restart the server — status will update automatically</li>
            </ol>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div
            className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
              testResult.ok
                ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                : "bg-destructive/10 border-destructive/30 text-destructive"
            }`}
          >
            {testResult.ok ? (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing || !status.is_active}
        >
          {testing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Test Connection
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          title="Refresh status"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardFooter>
    </Card>
  );
}

function CredentialPill({ label, present }: { label: string; present: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-mono ${
        present
          ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      }`}
    >
      {present ? (
        <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
      ) : (
        <XCircle className="h-3 w-3 flex-shrink-0" />
      )}
      {label}
    </span>
  );
}

// ── Auth Settings Tab ─────────────────────────────────────────────────────────

function AuthSettingsTab() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-auth-providers"],
    queryFn: fetchProviders,
    refetchOnWindowFocus: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-destructive p-4">
        <XCircle className="h-4 w-4" />
        Failed to load authentication settings. Please reload.
      </div>
    );
  }

  const googleStatus = data?.providers.find((p) => p.provider === "google") ?? {
    provider: "google",
    env_configured: false,
    db_configured: false,
    is_active: false,
    redirect_uri: null,
    client_id: null,
    has_client_secret: false,
    db_is_enabled: false,
    updated_at: null,
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h3 className="text-lg font-semibold">Authentication Providers</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          OAuth providers are configured via environment variables. Only administrators can view this page.
        </p>
      </div>
      <GoogleStatusCard
        status={googleStatus}
        onRefresh={() => { void refetch(); }}
      />
    </div>
  );
}

// ── Admin Page ────────────────────────────────────────────────────────────────

export default function Admin() {
  const { data: stats, isLoading: statsLoading } = useGetSystemStats();
  const { data: users, isLoading: usersLoading } = useAdminListUsers({ page: 1, per_page: 20 });
  const { data: projects, isLoading: projectsLoading } = useAdminListProjects({ page: 1, per_page: 20 });
  const { data: logs, isLoading: logsLoading } = useListAuditLogs({ page: 1, per_page: 20 });

  return (
    <div className="flex-1 space-y-6 p-8 pt-6 w-full overflow-x-hidden">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Admin Dashboard</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-[50px]" /> : (
              <div className="text-2xl font-bold">{stats?.total_users || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Users</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-[50px]" /> : (
              <div className="text-2xl font-bold">{stats?.active_users || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <Layout className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-[50px]" /> : (
              <div className="text-2xl font-bold">{stats?.total_projects || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Projects Today</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-7 w-[50px]" /> : (
              <div className="text-2xl font-bold">{stats?.new_projects_today || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
          <TabsTrigger value="authentication">
            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
            Authentication
          </TabsTrigger>
          <TabsTrigger value="production-status">
            <MonitorCheck className="h-3.5 w-3.5 mr-1.5" />
            Production Status
          </TabsTrigger>
          <TabsTrigger value="deployment-guide">
            <BookOpen className="h-3.5 w-3.5 mr-1.5" />
            Deployment Guide
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="border rounded-md bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersLoading ? (
                <TableRow><TableCell colSpan={5}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ) : (
                users?.items.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
                    <TableCell>
                      {u.is_active
                        ? <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">Active</Badge>
                        : <Badge variant="destructive">Inactive</Badge>}
                    </TableCell>
                    <TableCell>{new Date(u.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="projects" className="border rounded-md bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectsLoading ? (
                <TableRow><TableCell colSpan={4}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ) : (
                projects?.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="secondary">{p.project_type}</Badge></TableCell>
                    <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
                    <TableCell>{new Date(p.created_at).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="audit" className="border rounded-md bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logsLoading ? (
                <TableRow><TableCell colSpan={3}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
              ) : (
                logs?.items.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.action}</TableCell>
                    <TableCell>{log.user?.email || "System"}</TableCell>
                    <TableCell>{new Date(log.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="authentication" className="p-1">
          <AuthSettingsTab />
        </TabsContent>

        <TabsContent value="production-status" className="p-1">
          <ProductionStatus />
        </TabsContent>

        <TabsContent value="deployment-guide" className="p-1">
          <DeploymentGuide />
        </TabsContent>
      </Tabs>
    </div>
  );
}
