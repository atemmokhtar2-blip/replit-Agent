import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { secretsApi, repositoriesApi, type RepoSecret, type RepositoryImport } from "@/lib/repo-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Loader2, KeyRound, Plus, Trash2, Eye, EyeOff, Download,
  AlertCircle, CheckCircle2, ShieldCheck, RefreshCw,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// ─── Schemas ───────────────────────────────────────────────────────────────────
const createSchema = z.object({
  repositoryId: z.string().min(1, "Select a repository"),
  key: z.string().min(1, "Key is required").regex(/^[A-Z0-9_]+$/, "Use uppercase letters, numbers, and underscores"),
  value: z.string().min(1, "Value is required"),
  description: z.string().optional(),
});

const updateSchema = z.object({
  value: z.string().min(1, "Value is required"),
  description: z.string().optional(),
});

// ─── Add Secret Dialog ─────────────────────────────────────────────────────────
function AddSecretDialog({
  open,
  onClose,
  repos,
  defaultRepoId,
}: {
  open: boolean;
  onClose: () => void;
  repos: RepositoryImport[];
  defaultRepoId?: string;
}) {
  const qc = useQueryClient();
  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      repositoryId: defaultRepoId ?? "",
      key: "",
      value: "",
      description: "",
    },
  });

  const selectedRepoId = form.watch("repositoryId");
  const { data: detected } = useQuery({
    queryKey: ["detected-secrets", selectedRepoId],
    queryFn: () => secretsApi.detected(selectedRepoId),
    enabled: !!selectedRepoId,
  });

  const createMutation = useMutation({
    mutationFn: secretsApi.create,
    onSuccess: () => {
      toast.success("Secret saved securely");
      qc.invalidateQueries({ queryKey: ["secrets"] });
      form.reset();
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSubmit = (data: z.infer<typeof createSchema>) => {
    createMutation.mutate({
      repositoryId: data.repositoryId,
      key: data.key,
      value: data.value,
      description: data.description || undefined,
    });
  };

  const fillDetected = (key: string) => {
    form.setValue("key", key);
    const d = detected?.items.find((s) => s.key === key);
    if (d?.description) form.setValue("description", d.description);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" /> Add Secret
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Repository</Label>
            <Select
              value={form.watch("repositoryId")}
              onValueChange={(v) => form.setValue("repositoryId", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select repository…" />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.repositoryId && (
              <p className="text-xs text-destructive">{form.formState.errors.repositoryId.message}</p>
            )}
          </div>

          {detected?.items && detected.items.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Detected required secrets — click to fill:</p>
              <div className="flex flex-wrap gap-1.5">
                {detected.items.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => fillDetected(s.key)}
                    className="px-2 py-0.5 rounded font-mono text-xs border border-border hover:border-primary hover:bg-muted/50 transition-colors"
                  >
                    {s.key}
                    {s.required && <span className="text-destructive ml-1">*</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Key</Label>
            <Input
              {...form.register("key")}
              placeholder="DATABASE_URL"
              className="font-mono"
              onBlur={(e) => form.setValue("key", e.target.value.toUpperCase())}
            />
            {form.formState.errors.key && (
              <p className="text-xs text-destructive">{form.formState.errors.key.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Value <span className="text-muted-foreground text-xs">(stored encrypted)</span></Label>
            <Input
              {...form.register("value")}
              type="password"
              placeholder="••••••••"
            />
            {form.formState.errors.value && (
              <p className="text-xs text-destructive">{form.formState.errors.value.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              {...form.register("description")}
              placeholder="PostgreSQL connection string"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                <><ShieldCheck className="mr-2 h-4 w-4" />Save Secret</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Secret row ────────────────────────────────────────────────────────────────
function SecretRow({ secret }: { secret: RepoSecret }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [showValue, setShowValue] = useState(false);
  const form = useForm<z.infer<typeof updateSchema>>({
    resolver: zodResolver(updateSchema),
    defaultValues: { value: "", description: secret.description ?? "" },
  });

  const deleteMutation = useMutation({
    mutationFn: () => secretsApi.remove(secret.id),
    onSuccess: () => {
      toast.success("Secret deleted");
      qc.invalidateQueries({ queryKey: ["secrets"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (data: z.infer<typeof updateSchema>) => secretsApi.update(secret.id, data),
    onSuccess: () => {
      toast.success("Secret updated");
      qc.invalidateQueries({ queryKey: ["secrets"] });
      setEditing(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (editing) {
    return (
      <form
        onSubmit={form.handleSubmit((d) => updateMutation.mutate(d))}
        className="flex flex-col gap-2 p-3 rounded-lg border border-primary bg-muted/30"
      >
        <div className="flex items-center gap-2">
          <code className="font-mono text-sm font-semibold text-primary">{secret.key}</code>
        </div>
        <Input
          {...form.register("value")}
          type="password"
          placeholder="New value (leave empty to keep current)"
          className="font-mono"
        />
        <Input {...form.register("description")} placeholder="Description (optional)" />
        <div className="flex gap-2 justify-end">
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          <Button type="submit" size="sm" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:bg-muted/30 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <code className="font-mono text-sm font-medium">{secret.key}</code>
          {secret.isVerified && (
            <Badge variant="outline" className="text-xs text-green-600 border-green-600/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />Verified
            </Badge>
          )}
        </div>
        {secret.description && (
          <p className="text-xs text-muted-foreground mt-0.5">{secret.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          Updated {new Date(secret.updatedAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          title="Edit"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          title="Delete"
        >
          {deleteMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function SecretsCenter() {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<string>("all");

  const { data: reposData } = useQuery({
    queryKey: ["repositories"],
    queryFn: repositoriesApi.list,
  });

  const repos = reposData?.items ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ["secrets", selectedRepo],
    queryFn: () => secretsApi.list(selectedRepo !== "all" ? selectedRepo : undefined),
  });

  const secrets = data?.items ?? [];

  const handleDownloadEnv = async () => {
    if (selectedRepo === "all") {
      toast.error("Select a repository to download .env.example");
      return;
    }
    try {
      const result = await secretsApi.envExample(selectedRepo);
      const blob = new Blob([result.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ".env.example";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to generate .env.example");
    }
  };

  const readyRepos = repos.filter((r) => r.status === "ready");
  const selectedRepoObj = repos.find((r) => r.id === selectedRepo);

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Secrets Center</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage encrypted environment variables for your repositories.
          </p>
        </div>
        <div className="flex gap-2">
          {selectedRepo !== "all" && (
            <Button variant="outline" onClick={handleDownloadEnv}>
              <Download className="mr-2 h-4 w-4" /> .env.example
            </Button>
          )}
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add Secret
          </Button>
        </div>
      </div>

      {/* Security notice */}
      <Card className="mb-5 border-green-500/30 bg-green-500/5">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-green-500 flex-shrink-0" />
            <span className="text-green-700 dark:text-green-400">
              All secret values are encrypted at rest using AES-256-GCM. Values are never stored in plain text.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Repository filter */}
      <div className="mb-4 flex items-center gap-3">
        <Label className="text-sm text-muted-foreground flex-shrink-0">Filter by repo:</Label>
        <Select value={selectedRepo} onValueChange={setSelectedRepo}>
          <SelectTrigger className="w-60">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All repositories</SelectItem>
            {repos.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {secrets.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {secrets.length} secret{secrets.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Secrets list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading secrets…
        </div>
      ) : repos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <KeyRound className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No repositories imported</p>
            <p className="text-xs text-muted-foreground mt-1">
              Import a repository first to manage its secrets.
            </p>
          </CardContent>
        </Card>
      ) : secrets.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <KeyRound className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No secrets yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Add environment variables that will be encrypted and stored securely.
            </p>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add your first secret
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {secrets.map((s) => (
            <SecretRow key={s.id} secret={s} />
          ))}
        </div>
      )}

      <AddSecretDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        repos={repos}
        defaultRepoId={selectedRepo !== "all" ? selectedRepo : undefined}
      />
    </div>
  );
}
