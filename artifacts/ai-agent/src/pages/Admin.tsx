import { useState, useEffect } from "react";
import { useGetSystemStats, useAdminListUsers, useAdminListProjects, useListAuditLogs } from "@workspace/api-client-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Layout, ShieldCheck, Activity, KeyRound, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// ── Auth provider types ───────────────────────────────────────────────────────

interface ProviderConfig {
  provider: string;
  client_id: string | null;
  has_client_secret: boolean;
  redirect_uri: string | null;
  is_enabled: boolean;
  updated_at: string | null;
}

interface ProvidersResponse {
  providers: ProviderConfig[];
}

async function fetchProviders(): Promise<ProvidersResponse> {
  const res = await fetch("/api/v1/admin/auth/providers", {
    headers: {
      Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
    },
  });
  if (!res.ok) throw new Error("Failed to load auth providers");
  return res.json() as Promise<ProvidersResponse>;
}

async function saveProvider(provider: string, data: {
  client_id?: string;
  client_secret?: string;
  redirect_uri?: string;
  is_enabled?: boolean;
}): Promise<ProviderConfig & { message: string }> {
  const res = await fetch(`/api/v1/admin/auth/providers/${provider}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to save configuration");
  }
  return res.json() as Promise<ProviderConfig & { message: string }>;
}

async function testProvider(provider: string): Promise<{ ok: boolean; message: string; latency_ms?: number }> {
  const res = await fetch(`/api/v1/admin/auth/providers/${provider}/test`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    return { ok: false, message: body.message ?? "Test failed" };
  }
  return res.json() as Promise<{ ok: boolean; message: string; latency_ms?: number }>;
}

// ── Google OAuth config schema ────────────────────────────────────────────────

const googleConfigSchema = z.object({
  client_id: z.string().min(1, "Client ID is required"),
  client_secret: z.string().optional(),
  redirect_uri: z.string().url("Must be a valid URL").min(1, "Redirect URI is required"),
  is_enabled: z.boolean(),
});

type GoogleConfigFormValues = z.infer<typeof googleConfigSchema>;

function GoogleConfigForm({ config, onSaved }: { config: ProviderConfig; onSaved: () => void }) {
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const form = useForm<GoogleConfigFormValues>({
    resolver: zodResolver(googleConfigSchema),
    defaultValues: {
      client_id: config.client_id ?? "",
      client_secret: "",
      redirect_uri: config.redirect_uri ?? `${window.location.origin}/auth/callback`,
      is_enabled: config.is_enabled,
    },
  });

  useEffect(() => {
    form.reset({
      client_id: config.client_id ?? "",
      client_secret: "",
      redirect_uri: config.redirect_uri ?? `${window.location.origin}/auth/callback`,
      is_enabled: config.is_enabled,
    });
  }, [config, form]);

  const saveMutation = useMutation({
    mutationFn: (data: GoogleConfigFormValues) => {
      const payload: {
        client_id: string;
        client_secret?: string;
        redirect_uri: string;
        is_enabled: boolean;
      } = {
        client_id: data.client_id,
        redirect_uri: data.redirect_uri,
        is_enabled: data.is_enabled,
      };
      if (data.client_secret) payload.client_secret = data.client_secret;
      return saveProvider("google", payload);
    },
    onSuccess: (result) => {
      toast.success("Saved", { description: result.message });
      form.setValue("client_secret", "");
      onSaved();
    },
    onError: (err: Error) => {
      toast.error("Save failed", { description: err.message });
    },
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider("google");
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, message: "Test request failed" });
    } finally {
      setTesting(false);
    }
  };

  const isEnabled = form.watch("is_enabled");

  return (
    <form onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Google OAuth 2.0
              </CardTitle>
              <CardDescription>
                Allow users to sign in with their Google account.
                {config.updated_at && (
                  <span className="ml-1 text-xs">
                    Last updated {new Date(config.updated_at).toLocaleDateString()}.
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Label htmlFor="google-enabled" className="text-sm text-muted-foreground">
                {isEnabled ? "Enabled" : "Disabled"}
              </Label>
              <Switch
                id="google-enabled"
                checked={isEnabled}
                onCheckedChange={(v) => form.setValue("is_enabled", v)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Setup instructions */}
          <div className="rounded-md bg-muted/50 border border-border p-3 space-y-1 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Setup instructions</p>
            <ol className="list-decimal list-inside space-y-0.5 text-xs">
              <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-primary underline">Google Cloud Console → APIs &amp; Services → Credentials</a></li>
              <li>Create an <strong>OAuth 2.0 Client ID</strong> (Web application type)</li>
              <li>Add the Authorized Redirect URI below to the "Authorized redirect URIs" field</li>
              <li>Copy the Client ID and Client Secret here and click Save</li>
            </ol>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client_id">Google Client ID</Label>
            <Input
              id="client_id"
              placeholder="123456789-abc123.apps.googleusercontent.com"
              {...form.register("client_id")}
            />
            {form.formState.errors.client_id && (
              <p className="text-xs text-destructive">{form.formState.errors.client_id.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client_secret">
              Google Client Secret{" "}
              <span className="text-muted-foreground text-xs">
                {config.has_client_secret ? "(leave blank to keep current)" : "(required)"}
              </span>
            </Label>
            <Input
              id="client_secret"
              type="password"
              placeholder={config.has_client_secret ? "••••••••••••••••" : "GOCSPX-..."}
              {...form.register("client_secret")}
            />
            <p className="text-xs text-muted-foreground">
              Encrypted with AES-256-GCM before storage.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="redirect_uri">Authorized Redirect URI</Label>
            <Input
              id="redirect_uri"
              placeholder="https://yourdomain.com/auth/callback"
              {...form.register("redirect_uri")}
            />
            {form.formState.errors.redirect_uri && (
              <p className="text-xs text-destructive">{form.formState.errors.redirect_uri.message}</p>
            )}
            <p className="text-xs text-muted-foreground">
              This URL must be added to your Google OAuth app's Authorized Redirect URIs.
            </p>
          </div>

          {testResult && (
            <div
              className={`flex items-start gap-2 p-3 rounded-md border text-sm ${
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
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Configuration
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={testing || saveMutation.isPending}
          >
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Test Connection
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

// ── Auth Settings Tab ─────────────────────────────────────────────────────────

function AuthSettingsTab() {
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["admin-auth-providers"],
    queryFn: fetchProviders,
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
      <div className="text-sm text-destructive flex items-center gap-2">
        <XCircle className="h-4 w-4" />
        Failed to load authentication settings. Please reload.
      </div>
    );
  }

  const googleConfig = data?.providers.find((p) => p.provider === "google") ?? {
    provider: "google",
    client_id: null,
    has_client_secret: false,
    redirect_uri: null,
    is_enabled: false,
    updated_at: null,
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Authentication Providers</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure social login providers. Only administrators can change these settings.
        </p>
      </div>
      <GoogleConfigForm config={googleConfig} onSaved={() => { void refetch(); }} />
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
        <TabsList className="mb-4">
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="audit">Audit Logs</TabsTrigger>
          <TabsTrigger value="authentication">
            <KeyRound className="h-3.5 w-3.5 mr-1.5" />
            Authentication
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
                      {u.is_active ? <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}
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
      </Tabs>
    </div>
  );
}
