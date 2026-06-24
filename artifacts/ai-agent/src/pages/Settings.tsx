import { useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useTheme } from "@/components/ThemeProvider";
import {
  useUpdateMe,
  useChangePassword,
  useListAvailableProviders,
  useListMyProviders,
  useCreateProvider,
  useUpdateProvider,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Zap,
  Trash2,
  CheckCircle2,
  XCircle,
  Plus,
  ChevronDown,
  ChevronUp,
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

// ─── AI Providers Tab ─────────────────────────────────────────────────────────

function AIProvidersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string; latencyMs?: number }>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const { data: available } = useListAvailableProviders();
  const { data: myProviders, isLoading } = useListMyProviders();

  const createMutation = useCreateProvider();
  const deleteMutation = useDeleteProvider();
  const activateMutation = useActivateProvider();
  const testMutation = useTestProvider();

  const addForm = useForm({
    resolver: zodResolver(addProviderSchema),
    defaultValues: { slug: "", name: "", api_key: "", base_url: "", default_model: "" },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListMyProvidersQueryKey() });

  const onAddSubmit = (data: z.infer<typeof addProviderSchema>) => {
    createMutation.mutate(
      { data: { slug: data.slug, name: data.name, api_key: data.api_key || undefined, base_url: data.base_url || undefined, default_model: data.default_model || undefined } },
      {
        onSuccess: () => {
          toast({ title: "Provider added" });
          addForm.reset();
          setShowAdd(false);
          invalidate();
        },
        onError: () => toast({ variant: "destructive", title: "Failed to add provider" }),
      }
    );
  };

  const handleActivate = (id: string, name: string) => {
    activateMutation.mutate(
      { providerId: id },
      {
        onSuccess: () => {
          toast({ title: `${name} is now active` });
          invalidate();
        },
        onError: () => toast({ variant: "destructive", title: "Failed to activate" }),
      }
    );
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(
      { providerId: id },
      {
        onSuccess: () => {
          toast({ title: "Provider removed" });
          invalidate();
        },
        onError: () => toast({ variant: "destructive", title: "Failed to delete" }),
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
          setTestResults((p) => ({ ...p, [id]: { ok: false, message: "Request failed" } }));
          setTestingId(null);
        },
      }
    );
  };

  const providers = myProviders ?? [];
  const availableList = available ?? [];

  return (
    <div className="space-y-6">
      {/* Free providers info */}
      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>
            Connect AI providers to power your workspace. Many providers offer free tiers.
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
                  if (p.default_model) addForm.setValue("default_model", p.default_model);
                  if (p.default_base_url) addForm.setValue("base_url", p.default_base_url);
                }}
                className="text-left p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{p.name}</span>
                  {p.capabilities?.free_models_available && (
                    <Badge variant="secondary" className="text-xs">Free tier</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{p.description}</p>
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
                  <Input {...addForm.register("slug")} placeholder="huggingface" />
                </div>
                <div className="space-y-1">
                  <Label>Display Name</Label>
                  <Input {...addForm.register("name")} placeholder="My HuggingFace" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>API Key <span className="text-muted-foreground">(optional for some providers)</span></Label>
                <Input type="password" {...addForm.register("api_key")} placeholder="hf_..." />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Base URL <span className="text-muted-foreground">(optional)</span></Label>
                  <Input {...addForm.register("base_url")} placeholder="https://..." />
                </div>
                <div className="space-y-1">
                  <Label>Default Model <span className="text-muted-foreground">(optional)</span></Label>
                  <Input {...addForm.register("default_model")} placeholder="mistralai/Mistral-7B..." />
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex gap-2">
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Plus className="mr-2 h-4 w-4" /> Add Provider
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setShowAdd(false); addForm.reset(); }}>
                Cancel
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {/* Configured providers */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</div>
      ) : providers.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p className="mb-3">No providers configured yet.</p>
            <Button onClick={() => setShowAdd(true)} variant="outline"><Plus className="mr-2 h-4 w-4" />Add your first provider</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const result = testResults[p.id];
            return (
              <Card key={p.id} className={p.is_active ? "border-primary" : ""}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{p.name}</span>
                          {p.is_active && <Badge className="text-xs">Active</Badge>}
                          <Badge variant="outline" className="text-xs capitalize">{p.slug}</Badge>
                        </div>
                        {p.default_model && (
                          <p className="text-xs text-muted-foreground mt-0.5">Model: {p.default_model}</p>
                        )}
                        {result && (
                          <div className={`flex items-center gap-1 text-xs mt-1 ${result.ok ? "text-green-600" : "text-destructive"}`}>
                            {result.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                            {result.message}{result.latencyMs ? ` (${result.latencyMs}ms)` : ""}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTest(p.id)}
                        disabled={testingId === p.id}
                      >
                        {testingId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
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
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!showAdd && providers.length > 0 && (
        <Button variant="outline" onClick={() => setShowAdd(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Another Provider
        </Button>
      )}
    </div>
  );
}

// ─── Main Settings Page ────────────────────────────────────────────────────────

export default function Settings() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();

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
        onSuccess: () => toast({ title: "Profile updated" }),
        onError: (err) => toast({ variant: "destructive", title: "Error", description: (err as { data?: { error?: string } }).data?.error || err.message }),
      }
    );
  };

  const onSecuritySubmit = (data: z.infer<typeof securitySchema>) => {
    changePasswordMutation.mutate(
      { data },
      {
        onSuccess: () => {
          toast({ title: "Password changed successfully" });
          securityForm.reset();
        },
        onError: (err) => toast({ variant: "destructive", title: "Error", description: (err as { data?: { error?: string } }).data?.error || err.message }),
      }
    );
  };

  return (
    <div className="flex-1 space-y-6 p-8 pt-6 max-w-4xl mx-auto w-full">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
        <p className="text-muted-foreground">Manage your account settings and preferences.</p>
      </div>

      <Tabs defaultValue="ai-providers" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="ai-providers">AI Providers</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="ai-providers">
          <AIProvidersTab />
        </TabsContent>

        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Update your personal information.</CardDescription>
            </CardHeader>
            <form onSubmit={profileForm.handleSubmit(onProfileSubmit)}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={user?.email || ""} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" {...profileForm.register("username")} />
                  {profileForm.formState.errors.username && (
                    <p className="text-sm text-destructive">{profileForm.formState.errors.username.message as string}</p>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={updateMeMutation.isPending}>
                  {updateMeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                  <Input type="password" id="current_password" {...securityForm.register("current_password")} />
                  {securityForm.formState.errors.current_password && (
                    <p className="text-sm text-destructive">{securityForm.formState.errors.current_password.message as string}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_password">New Password</Label>
                  <Input type="password" id="new_password" {...securityForm.register("new_password")} />
                  {securityForm.formState.errors.new_password && (
                    <p className="text-sm text-destructive">{securityForm.formState.errors.new_password.message as string}</p>
                  )}
                </div>
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={changePasswordMutation.isPending}>
                  {changePasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
              <CardDescription>Customize the look of your workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Dark Mode</Label>
                  <p className="text-sm text-muted-foreground">Toggle dark mode on or off.</p>
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
              <CardDescription>Manage how you receive updates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Email Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive updates via email.</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
