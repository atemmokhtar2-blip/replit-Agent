import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { githubApi, type GitHubRepo } from "@/lib/repo-api";
import { useAuth } from "@/components/AuthProvider";
import { useTheme } from "@/components/ThemeProvider";
import {
  useUpdateMe,
  useChangePassword,
  useListAvailableProviders,
  useListMyProviders,
  useCreateProvider,
  useDeleteProvider,
  useActivateProvider,
  useTestProvider,
  getListMyProvidersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2,
  Zap,
  Trash2,
  CheckCircle2,
  XCircle,
  Plus,
  Github,
  Link2,
  Link2Off,
  RefreshCw,
  Star,
  Lock,
  GitBranch,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const profileSchema = z.object({
  username: z.string().min(3),
});

const securitySchema = z.object({
  current_password: z.string().min(1, "Required"),
  new_password: z.string().min(8, "Must be at least 8 characters"),
});

const addProviderSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
});

// ── GitHub Tab ─────────────────────────────────────────────────────────────────

const patSchema = z.object({ token: z.string().min(10, "Enter your GitHub PAT") });

function GitHubTab() {
  const qc = useQueryClient();
  const [showConnect, setShowConnect] = useState(false);
  const [showRepos, setShowRepos] = useState(false);

  const { data: status, isLoading: loadingStatus } = useQuery({
    queryKey: ["github-status"],
    queryFn: githubApi.status,
  });

  const { data: reposData, isLoading: loadingRepos } = useQuery({
    queryKey: ["github-repos"],
    queryFn: () => githubApi.repos({ per_page: 30 }),
    enabled: showRepos && !!status?.connected,
  });

  const patForm = useForm<z.infer<typeof patSchema>>({
    resolver: zodResolver(patSchema),
    defaultValues: { token: "" },
  });

  const connectMutation = useMutation({
    mutationFn: (token: string) => githubApi.connect(token),
    onSuccess: (data) => {
      toast.success(`Connected as @${data.github_login}`);
      qc.invalidateQueries({ queryKey: ["github-status"] });
      setShowConnect(false);
      patForm.reset();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: githubApi.disconnect,
    onSuccess: () => {
      toast.success("GitHub disconnected");
      qc.invalidateQueries({ queryKey: ["github-status"] });
      qc.invalidateQueries({ queryKey: ["github-repos"] });
      setShowRepos(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (loadingStatus) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking connection…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Connection status card */}
      <Card className={status?.connected ? "border-green-500/40" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Github className="h-4 w-4" /> GitHub Connection
          </CardTitle>
          <CardDescription>
            Connect your GitHub account to import repositories and run git operations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status?.connected ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">Connected as <span className="text-green-600 dark:text-green-400">@{status.github_login}</span></p>
                  {status.github_name && <p className="text-xs text-muted-foreground">{status.github_name}</p>}
                  {status.created_at && (
                    <p className="text-xs text-muted-foreground">
                      Since {new Date(status.created_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {status.scopes && status.scopes.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Token scopes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {status.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="font-mono text-xs">{s}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <XCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
              <p className="text-sm text-muted-foreground">Not connected. Add a Personal Access Token to get started.</p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {status?.connected ? (
            <>
              <Button
                variant="outline"
                onClick={() => setShowRepos((p) => !p)}
                disabled={loadingRepos}
              >
                {loadingRepos ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {showRepos ? "Hide Repos" : "Browse Repos"}
              </Button>
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                {disconnectMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2Off className="mr-2 h-4 w-4" />
                )}
                Disconnect
              </Button>
            </>
          ) : (
            <Button onClick={() => setShowConnect(true)}>
              <Link2 className="mr-2 h-4 w-4" /> Connect with PAT
            </Button>
          )}
        </CardFooter>
      </Card>

      {/* Connect PAT form */}
      {showConnect && !status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Personal Access Token</CardTitle>
            <CardDescription>
              Create a token at{" "}
              <a
                href="https://github.com/settings/tokens"
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                github.com/settings/tokens
              </a>{" "}
              with the <code className="bg-muted px-1 rounded">repo</code> scope.
            </CardDescription>
          </CardHeader>
          <form onSubmit={patForm.handleSubmit((d) => connectMutation.mutate(d.token))}>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>GitHub PAT</Label>
                <Input
                  {...patForm.register("token")}
                  type="password"
                  placeholder="ghp_..."
                  className="font-mono"
                />
                {patForm.formState.errors.token && (
                  <p className="text-xs text-destructive">{patForm.formState.errors.token.message}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Your token is encrypted with AES-256 before being stored.
              </p>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button type="submit" disabled={connectMutation.isPending}>
                {connectMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Connecting…</>
                ) : (
                  <><Github className="mr-2 h-4 w-4" />Connect</>
                )}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setShowConnect(false); patForm.reset(); }}>
                Cancel
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Repository preview */}
      {showRepos && status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your Repositories</CardTitle>
            <CardDescription>Recent repositories from your GitHub account.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingRepos ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (reposData?.items ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No repositories found.</p>
            ) : (
              <div className="space-y-1.5">
                {(reposData?.items ?? []).slice(0, 15).map((r: GitHubRepo) => (
                  <div key={r.id} className="flex items-center gap-2 px-3 py-2 rounded-md border border-border">
                    {r.private ? (
                      <Lock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    ) : (
                      <Github className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium truncate flex-1">{r.full_name}</span>
                    {r.language && (
                      <Badge variant="outline" className="text-xs flex-shrink-0">{r.language}</Badge>
                    )}
                    {r.stargazers_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0">
                        <Star className="h-3 w-3" />{r.stargazers_count}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── AI Providers Tab ───────────────────────────────────────────────────────────

function AIProvidersTab() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message: string; latencyMs?: number }>
  >({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: available } = useListAvailableProviders();
  const { data: myProviders, isLoading } = useListMyProviders();

  const createMutation = useCreateProvider();
  const deleteMutation = useDeleteProvider();
  const activateMutation = useActivateProvider();
  const testMutation = useTestProvider();

  const addForm = useForm({
    resolver: zodResolver(addProviderSchema),
    defaultValues: {
      slug: "",
      name: "",
      api_key: "",
      base_url: "",
      default_model: "",
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListMyProvidersQueryKey() });

  const onAddSubmit = (data: z.infer<typeof addProviderSchema>) => {
    createMutation.mutate(
      {
        data: {
          slug: data.slug,
          name: data.name,
          api_key: data.api_key || undefined,
          base_url: data.base_url || undefined,
          default_model: data.default_model || undefined,
        },
      },
      {
        onSuccess: () => {
          toast.success("Provider added");
          addForm.reset();
          setShowAdd(false);
          invalidate();
        },
        onError: () => toast.error("Failed to add provider"),
      }
    );
  };

  const handleActivate = (id: string, name: string) => {
    activateMutation.mutate(
      { providerId: id },
      {
        onSuccess: () => {
          toast.success(`${name} is now active`);
          invalidate();
        },
        onError: () => toast.error("Failed to activate"),
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(
      { providerId: id },
      {
        onSuccess: () => {
          toast.success("Provider removed");
          invalidate();
        },
        onError: () => toast.error("Failed to delete"),
      }
    );
  };

  const handleTest = (id: string) => {
    setTestingId(id);
    testMutation.mutate(
      { providerId: id },
      {
        onSuccess: (result) => {
          setTestResults((p) => ({ ...p, [id]: result }));
          setTestingId(null);
        },
        onError: () => {
          setTestResults((p) => ({
            ...p,
            [id]: { ok: false, message: "Request failed" },
          }));
          setTestingId(null);
        },
      }
    );
  };

  const providers = myProviders ?? [];
  const availableList = available ?? [];

  return (
    <div className="space-y-5">
      {/* Available providers */}
      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>
            Connect AI providers to power your workspace. Many offer free tiers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            {availableList.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  setShowAdd(true);
                  addForm.setValue("slug", p.slug);
                  addForm.setValue("name", p.name);
                  if (p.default_model)
                    addForm.setValue("default_model", p.default_model);
                  if (p.default_base_url)
                    addForm.setValue("base_url", p.default_base_url);
                }}
                className="text-left p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1 gap-2">
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.capabilities?.free_models_available && (
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      Free tier
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {p.description}
                </p>
                {p.free_tier_note && (
                  <p className="text-xs text-primary mt-1">{p.free_tier_note}</p>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add provider form */}
      {showAdd && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add Provider</CardTitle>
          </CardHeader>
          <form onSubmit={addForm.handleSubmit(onAddSubmit)}>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Provider</Label>
                  <Input
                    {...addForm.register("slug")}
                    placeholder="openrouter"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Display Name</Label>
                  <Input
                    {...addForm.register("name")}
                    placeholder="My OpenRouter"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>
                  API Key{" "}
                  <span className="text-muted-foreground">
                    (optional for some providers)
                  </span>
                </Label>
                <Input
                  type="password"
                  {...addForm.register("api_key")}
                  placeholder="hf_..."
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>
                    Base URL{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    {...addForm.register("base_url")}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-1">
                  <Label>
                    Default Model{" "}
                    <span className="text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    {...addForm.register("default_model")}
                    placeholder="mistralai/Mistral-7B..."
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex flex-wrap gap-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                <Plus className="mr-2 h-4 w-4" /> Add Provider
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowAdd(false);
                  addForm.reset();
                }}
              >
                Cancel
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Configured providers */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p className="mb-3">No providers configured yet.</p>
            <Button onClick={() => setShowAdd(true)} variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Add your first provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const result = testResults[p.id];
            return (
              <Card
                key={p.id}
                className={p.is_active ? "border-primary" : ""}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{p.name}</span>
                        {p.is_active && (
                          <Badge className="text-xs">Active</Badge>
                        )}
                        <Badge variant="outline" className="text-xs capitalize">
                          {p.slug}
                        </Badge>
                      </div>
                      {p.default_model && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          Model: {p.default_model}
                        </p>
                      )}
                      {result && (
                        <div
                          className={`flex items-center gap-1 text-xs mt-1 ${
                            result.ok ? "text-green-600" : "text-destructive"
                          }`}
                        >
                          {result.ok ? (
                            <CheckCircle2 className="h-3 w-3 flex-shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 flex-shrink-0" />
                          )}
                          {result.message}
                          {result.latencyMs ? ` (${result.latencyMs}ms)` : ""}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTest(p.id)}
                        disabled={testingId === p.id}
                        title="Test provider"
                      >
                        {testingId === p.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                      </Button>
                      {!p.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleActivate(p.id, p.name)}
                          disabled={activateMutation.isPending}
                        >
                          Set Active
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(p.id)}
                        disabled={deleteMutation.isPending}
                        title="Remove provider"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {!showAdd && (
            <Button variant="outline" onClick={() => setShowAdd(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Another Provider
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Settings Page ─────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();

  const updateMeMutation = useUpdateMe();
  const changePasswordMutation = useChangePassword();

  const profileForm = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { username: user?.username || "" },
  });

  const securityForm = useForm({
    resolver: zodResolver(securitySchema),
    defaultValues: { current_password: "", new_password: "" },
  });

  const onProfileSubmit = (data: z.infer<typeof profileSchema>) => {
    updateMeMutation.mutate(
      { data },
      {
        onSuccess: () => toast.success("Profile updated"),
        onError: (err) =>
          toast.error("Error", {
            description:
              (err as { data?: { error?: string } }).data?.error ||
              err.message,
          }),
      }
    );
  };

  const onSecuritySubmit = (data: z.infer<typeof securitySchema>) => {
    changePasswordMutation.mutate(
      { data },
      {
        onSuccess: () => {
          toast.success("Password changed successfully");
          securityForm.reset();
        },
        onError: (err) =>
          toast.error("Error", {
            description:
              (err as { data?: { error?: string } }).data?.error ||
              err.message,
          }),
      }
    );
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Settings</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your account settings and preferences.
          </p>
        </div>
      </div>

      <div className="max-w-3xl">
        <Tabs defaultValue="ai-providers" className="w-full">
          {/* Scrollable tabs on mobile */}
          <TabsList className="mb-5 flex w-full overflow-x-auto sm:inline-flex sm:w-auto">
            <TabsTrigger value="ai-providers" className="flex-shrink-0">
              AI Providers
            </TabsTrigger>
            <TabsTrigger value="github" className="flex-shrink-0">
              GitHub
            </TabsTrigger>
            <TabsTrigger value="profile" className="flex-shrink-0">
              Profile
            </TabsTrigger>
            <TabsTrigger value="security" className="flex-shrink-0">
              Security
            </TabsTrigger>
            <TabsTrigger value="appearance" className="flex-shrink-0">
              Appearance
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex-shrink-0">
              Notifications
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ai-providers">
            <AIProvidersTab />
          </TabsContent>

          <TabsContent value="github">
            <GitHubTab />
          </TabsContent>

          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>
                  Update your personal information.
                </CardDescription>
              </CardHeader>
              <form onSubmit={profileForm.handleSubmit(onProfileSubmit)}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input value={user?.email || ""} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="username">Username</Label>
                    <Input
                      id="username"
                      {...profileForm.register("username")}
                    />
                    {profileForm.formState.errors.username && (
                      <p className="text-sm text-destructive">
                        {
                          profileForm.formState.errors.username
                            .message as string
                        }
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    type="submit"
                    disabled={updateMeMutation.isPending}
                  >
                    {updateMeMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save Changes
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Security</CardTitle>
                <CardDescription>Change your password.</CardDescription>
              </CardHeader>
              <form onSubmit={securityForm.handleSubmit(onSecuritySubmit)}>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="current_password">Current Password</Label>
                    <Input
                      type="password"
                      id="current_password"
                      {...securityForm.register("current_password")}
                    />
                    {securityForm.formState.errors.current_password && (
                      <p className="text-sm text-destructive">
                        {
                          securityForm.formState.errors.current_password
                            .message as string
                        }
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new_password">New Password</Label>
                    <Input
                      type="password"
                      id="new_password"
                      {...securityForm.register("new_password")}
                    />
                    {securityForm.formState.errors.new_password && (
                      <p className="text-sm text-destructive">
                        {
                          securityForm.formState.errors.new_password
                            .message as string
                        }
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    type="submit"
                    disabled={changePasswordMutation.isPending}
                  >
                    {changePasswordMutation.isPending && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Change Password
                  </Button>
                </CardFooter>
              </form>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
                <CardDescription>
                  Customize the look of your workspace.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <Label>Dark Mode</Label>
                    <p className="text-sm text-muted-foreground">
                      Toggle dark mode on or off.
                    </p>
                  </div>
                  <Switch
                    checked={theme === "dark"}
                    onCheckedChange={(c) => setTheme(c ? "dark" : "light")}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle>Notifications</CardTitle>
                <CardDescription>
                  Manage how you receive updates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5 min-w-0">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Receive updates via email.
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
