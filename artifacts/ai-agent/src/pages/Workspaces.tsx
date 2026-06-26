import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  workspacesApi, repositoriesApi,
  type WorkspaceSession, type RepositoryImport,
  type DiffFile, type GitCommit, type ValidationResult,
} from "@/lib/repo-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, GitBranch, Plus, Trash2, RefreshCw, GitCommit as GitCommitIcon,
  GitPullRequest, Upload, Undo2, ChevronDown, ChevronRight, AlertCircle,
  CheckCircle2, XCircle, Terminal, Eye, RotateCcw, Play,
  Clock, Hash,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// ─── Schemas ───────────────────────────────────────────────────────────────────
const commitSchema = z.object({ message: z.string().min(1, "Commit message required") });
const prSchema = z.object({
  title: z.string().min(1, "Title required"),
  body: z.string().default(""),
  draft: z.boolean().default(false),
});
const branchSchema = z.object({ branch_name: z.string().min(1, "Branch name required") });

// ─── Status badge ──────────────────────────────────────────────────────────────
function WsBadge({ status }: { status: WorkspaceSession["status"] }) {
  const map: Record<WorkspaceSession["status"], { label: string; cls: string }> = {
    active: { label: "Active", cls: "bg-green-500/15 text-green-600 border-green-500/30" },
    idle:   { label: "Idle",   cls: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" },
    error:  { label: "Error",  cls: "bg-red-500/15 text-red-600 border-red-500/30" },
    closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
  };
  const { label, cls } = map[status] ?? { label: status, cls: "bg-muted text-muted-foreground" };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Diff Viewer ───────────────────────────────────────────────────────────────
function DiffViewer({ files, summary }: {
  files: DiffFile[];
  summary: { files: number; additions: number; deletions: number };
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (files.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No changes in working directory
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground pb-1">
        <span>{summary.files} file{summary.files !== 1 ? "s" : ""} changed</span>
        <span className="text-green-600">+{summary.additions}</span>
        <span className="text-red-500">-{summary.deletions}</span>
      </div>
      {files.map((f) => (
        <div key={f.file} className="rounded-md border border-border overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/60 transition-colors text-left"
            onClick={() => setExpanded((p) => ({ ...p, [f.file]: !p[f.file] }))}
          >
            {expanded[f.file] ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            )}
            <span className="font-mono text-xs flex-1 truncate">{f.file}</span>
            <span className="text-xs text-green-600 flex-shrink-0">+{f.additions}</span>
            <span className="text-xs text-red-500 flex-shrink-0 ml-1">-{f.deletions}</span>
          </button>
          {expanded[f.file] && (
            <ScrollArea className="max-h-64">
              <pre className="font-mono text-xs p-3 leading-relaxed">
                {f.hunks.map((hunk, hi) => (
                  <div key={hi}>
                    <div className="text-muted-foreground/70">{hunk.header}</div>
                    {hunk.lines.map((line, li) => (
                      <div
                        key={li}
                        className={
                          line.startsWith("+") ? "text-green-600 bg-green-500/5" :
                          line.startsWith("-") ? "text-red-500 bg-red-500/5" :
                          "text-muted-foreground"
                        }
                      >
                        {line}
                      </div>
                    ))}
                  </div>
                ))}
              </pre>
            </ScrollArea>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Git Log ───────────────────────────────────────────────────────────────────
function GitLog({ commits, onRollback }: {
  commits: GitCommit[];
  onRollback: (hash: string) => void;
}) {
  if (commits.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">No commits yet</p>;
  }

  return (
    <div className="space-y-1.5">
      {commits.map((c, i) => (
        <div key={c.hash} className="flex items-start gap-3 group px-2 py-2 rounded-md hover:bg-muted/30 transition-colors">
          <div className="flex-shrink-0 mt-1">
            <div className={`h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold ${
              i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {i === 0 ? "●" : "○"}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{c.message}</p>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                <code>{c.hash.slice(0, 7)}</code>
              </span>
              <span>{c.author}</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(c.date).toLocaleDateString()}
              </span>
            </div>
          </div>
          {i > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-xs h-7"
              onClick={() => onRollback(c.hash)}
              title="Rollback to this commit"
            >
              <RotateCcw className="h-3 w-3 mr-1" />Rollback
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Validation Results ─────────────────────────────────────────────────────────
function ValidationResults({ results, passed }: { results: ValidationResult[]; passed: boolean }) {
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 text-sm font-medium ${passed ? "text-green-600" : "text-destructive"}`}>
        {passed ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        {passed ? "All checks passed" : "Some checks failed"}
      </div>
      {results.map((r) => (
        <div key={r.check} className="rounded-md border border-border p-2.5">
          <div className="flex items-center gap-2">
            {r.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
            )}
            <span className="text-xs font-medium capitalize">{r.check}</span>
          </div>
          {(r.output || r.error) && (
            <ScrollArea className="max-h-28 mt-1.5">
              <pre className="font-mono text-xs text-muted-foreground whitespace-pre-wrap">
                {r.error ?? r.output}
              </pre>
            </ScrollArea>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Workspace Detail Panel ─────────────────────────────────────────────────────
function WorkspaceDetail({ ws }: { ws: WorkspaceSession }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("diff");
  const [prOpen, setPrOpen] = useState(false);
  const [validationResults, setValidationResults] = useState<{ results: ValidationResult[]; passed: boolean } | null>(null);

  const commitForm = useForm<z.infer<typeof commitSchema>>({
    resolver: zodResolver(commitSchema),
    defaultValues: { message: "" },
  });
  const branchForm = useForm<z.infer<typeof branchSchema>>({
    resolver: zodResolver(branchSchema),
    defaultValues: { branch_name: "" },
  });
  const prForm = useForm<z.infer<typeof prSchema>>({
    resolver: zodResolver(prSchema),
    defaultValues: { title: "", body: "", draft: false },
  });

  const { data: diffData, isLoading: diffLoading, refetch: refetchDiff } = useQuery({
    queryKey: ["ws-diff", ws.id],
    queryFn: () => workspacesApi.diff(ws.id),
    enabled: activeTab === "diff",
  });

  const { data: logData, isLoading: logLoading } = useQuery({
    queryKey: ["ws-log", ws.id],
    queryFn: () => workspacesApi.log(ws.id),
    enabled: activeTab === "log",
  });

  const commitMutation = useMutation({
    mutationFn: (data: z.infer<typeof commitSchema>) => workspacesApi.commit(ws.id, data),
    onSuccess: (data) => {
      toast.success(`Committed: ${data.hash.slice(0, 7)}`);
      commitForm.reset();
      qc.invalidateQueries({ queryKey: ["ws-diff", ws.id] });
      qc.invalidateQueries({ queryKey: ["ws-log", ws.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const pushMutation = useMutation({
    mutationFn: () => workspacesApi.push(ws.id),
    onSuccess: () => toast.success("Pushed to remote successfully"),
    onError: (err: Error) => toast.error(err.message),
  });

  const undoMutation = useMutation({
    mutationFn: () => workspacesApi.undo(ws.id),
    onSuccess: () => {
      toast.success("Last commit undone");
      qc.invalidateQueries({ queryKey: ["ws-log", ws.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rollbackMutation = useMutation({
    mutationFn: (hash: string) => workspacesApi.rollback(ws.id, { commit_hash: hash }),
    onSuccess: () => {
      toast.success("Rolled back to selected commit");
      qc.invalidateQueries({ queryKey: ["ws-log", ws.id] });
      qc.invalidateQueries({ queryKey: ["ws-diff", ws.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const branchMutation = useMutation({
    mutationFn: (data: z.infer<typeof branchSchema>) =>
      workspacesApi.branch(ws.id, { branch_name: data.branch_name }),
    onSuccess: (data) => {
      toast.success(`Branch created: ${data.branch}`);
      branchForm.reset();
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const prMutation = useMutation({
    mutationFn: (data: z.infer<typeof prSchema>) => workspacesApi.pr(ws.id, data),
    onSuccess: (data) => {
      toast.success(`PR #${data.number} created`);
      setPrOpen(false);
      prForm.reset();
      if (data.url) window.open(data.url, "_blank");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const validateMutation = useMutation({
    mutationFn: () => workspacesApi.validate(ws.id),
    onSuccess: (data) => setValidationResults(data),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      {/* Action row */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => validateMutation.mutate()}
          disabled={validateMutation.isPending}
        >
          {validateMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1.5" />
          )}
          Validate
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => pushMutation.mutate()}
          disabled={pushMutation.isPending}
        >
          {pushMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-1.5" />
          )}
          Push
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => undoMutation.mutate()}
          disabled={undoMutation.isPending}
        >
          {undoMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : (
            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
          )}
          Undo
        </Button>

        <Button size="sm" onClick={() => setPrOpen(true)}>
          <GitPullRequest className="h-3.5 w-3.5 mr-1.5" />
          Pull Request
        </Button>
      </div>

      {/* Validation results */}
      {validationResults && (
        <ValidationResults results={validationResults.results} passed={validationResults.passed} />
      )}

      {/* Tabs: Diff | Commit | Branch | Log */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full">
          <TabsTrigger value="diff" className="flex-1 text-xs">
            <Eye className="h-3.5 w-3.5 mr-1" />Diff
          </TabsTrigger>
          <TabsTrigger value="commit" className="flex-1 text-xs">
            <GitCommitIcon className="h-3.5 w-3.5 mr-1" />Commit
          </TabsTrigger>
          <TabsTrigger value="branch" className="flex-1 text-xs">
            <GitBranch className="h-3.5 w-3.5 mr-1" />Branch
          </TabsTrigger>
          <TabsTrigger value="log" className="flex-1 text-xs">
            <Terminal className="h-3.5 w-3.5 mr-1" />Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="diff" className="mt-3">
          {diffLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />Loading diff…
            </div>
          ) : (
            <div>
              <div className="flex justify-end mb-2">
                <Button variant="ghost" size="sm" onClick={() => refetchDiff()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <DiffViewer
                files={diffData?.diff ?? []}
                summary={diffData?.summary ?? { files: 0, additions: 0, deletions: 0 }}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="commit" className="mt-3">
          <form onSubmit={commitForm.handleSubmit((d) => commitMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Commit message</Label>
              <Textarea
                {...commitForm.register("message")}
                placeholder="feat: add user authentication"
                rows={3}
                className="font-mono text-sm resize-none"
              />
              {commitForm.formState.errors.message && (
                <p className="text-xs text-destructive">{commitForm.formState.errors.message.message}</p>
              )}
            </div>
            <Button type="submit" size="sm" disabled={commitMutation.isPending}>
              {commitMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <GitCommitIcon className="h-3.5 w-3.5 mr-1.5" />
              )}
              Commit Changes
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="branch" className="mt-3">
          <form onSubmit={branchForm.handleSubmit((d) => branchMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">New branch name</Label>
              <Input
                {...branchForm.register("branch_name")}
                placeholder="feature/my-feature"
                className="font-mono text-sm"
              />
              {branchForm.formState.errors.branch_name && (
                <p className="text-xs text-destructive">{branchForm.formState.errors.branch_name.message}</p>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              Current branch: <code className="bg-muted px-1 rounded">{ws.current_branch}</code>
            </div>
            <Button type="submit" size="sm" disabled={branchMutation.isPending}>
              {branchMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <GitBranch className="h-3.5 w-3.5 mr-1.5" />
              )}
              Create Branch
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="log" className="mt-3">
          {logLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />Loading log…
            </div>
          ) : (
            <GitLog
              commits={logData?.log ?? []}
              onRollback={(hash) => rollbackMutation.mutate(hash)}
            />
          )}
        </TabsContent>
      </Tabs>

      {/* PR Dialog */}
      <Dialog open={prOpen} onOpenChange={(o) => !o && setPrOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitPullRequest className="h-5 w-5" /> Create Pull Request
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={prForm.handleSubmit((d) => prMutation.mutate(d))} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input {...prForm.register("title")} placeholder="feat: add new feature" />
              {prForm.formState.errors.title && (
                <p className="text-xs text-destructive">{prForm.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Textarea {...prForm.register("body")} rows={3} placeholder="Describe your changes…" />
            </div>
            <div className="text-xs text-muted-foreground">
              Branch: <code className="bg-muted px-1 rounded">{ws.current_branch}</code> → <code className="bg-muted px-1 rounded">{ws.base_branch}</code>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setPrOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={prMutation.isPending}>
                {prMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <GitPullRequest className="h-3.5 w-3.5 mr-1.5" />
                )}
                Create PR
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Create Workspace Dialog ────────────────────────────────────────────────────
function CreateWorkspaceDialog({
  open,
  onClose,
  repos,
}: {
  open: boolean;
  onClose: () => void;
  repos: RepositoryImport[];
}) {
  const qc = useQueryClient();
  const [repoId, setRepoId] = useState("");
  const [branchName, setBranchName] = useState("");
  const [wsName, setWsName] = useState("");

  const selectedRepo = repos.find((r) => r.id === repoId);

  const createMutation = useMutation({
    mutationFn: () =>
      workspacesApi.create({
        repository_import_id: repoId,
        name: wsName || undefined,
        branch_name: branchName || undefined,
      }),
    onSuccess: () => {
      toast.success("Workspace created");
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      onClose();
      setRepoId("");
      setBranchName("");
      setWsName("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" /> New Workspace
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Repository</Label>
            <Select value={repoId} onValueChange={setRepoId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a ready repository…" />
              </SelectTrigger>
              <SelectContent>
                {repos.filter((r) => r.status === "ready").map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Workspace name <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              placeholder="My feature workspace"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Branch name <span className="text-muted-foreground text-xs">(optional — auto-generated)</span></Label>
            <Input
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="feature/my-feature"
              className="font-mono"
            />
            {selectedRepo && (
              <p className="text-xs text-muted-foreground">
                Base branch: <code className="bg-muted px-1 rounded">{selectedRepo.defaultBranch}</code>
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!repoId || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Plus className="h-4 w-4 mr-2" />
            )}
            Create Workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workspace Card ─────────────────────────────────────────────────────────────
function WorkspaceCard({
  ws,
  onDeleted,
}: {
  ws: WorkspaceSession;
  onDeleted: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => workspacesApi.remove(ws.id),
    onSuccess: () => {
      toast.success("Workspace deleted");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className={ws.status === "active" ? "border-primary/30" : ""}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
              <GitBranch className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{ws.name ?? ws.id.slice(0, 8)}</span>
                <WsBadge status={ws.status} />
              </div>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  <code>{ws.current_branch}</code>
                </span>
                <span className="text-muted-foreground/50">→</span>
                <span><code>{ws.base_branch}</code></span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(ws.updated_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {ws.status !== "closed" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((p) => !p)}
                title={expanded ? "Collapse" : "Expand git tools"}
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              title="Delete workspace"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {expanded && ws.status !== "closed" && (
          <WorkspaceDetail ws={ws} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function Workspaces() {
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => workspacesApi.list(),
  });

  const { data: reposData } = useQuery({
    queryKey: ["repositories"],
    queryFn: repositoriesApi.list,
  });

  const workspaces = data?.items ?? [];
  const repos = reposData?.items ?? [];
  const readyRepos = repos.filter((r) => r.status === "ready");

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Workspaces</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Isolated git environments for AI-assisted code changes — branch, commit, push, and create pull requests.
          </p>
        </div>
        <Button
          onClick={() => {
            if (readyRepos.length === 0) {
              toast.error("No ready repositories", {
                description: "Import and analyze a repository first.",
              });
              return;
            }
            setCreateOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> New Workspace
        </Button>
      </div>

      {/* Info banner */}
      {workspaces.length === 0 && readyRepos.length === 0 && (
        <Card className="mb-5 border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <p className="text-sm text-muted-foreground">
                Import a repository first to create workspaces. Go to{" "}
                <a href="/repositories" className="text-primary underline">Repositories</a>.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading workspaces…
        </div>
      ) : workspaces.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitBranch className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No workspaces yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Create a workspace to start making changes to a repository.
            </p>
            <Button variant="outline" onClick={() => setCreateOpen(true)} disabled={readyRepos.length === 0}>
              <Plus className="mr-2 h-4 w-4" /> Create Workspace
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {workspaces.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              ws={ws}
              onDeleted={() => qc.invalidateQueries({ queryKey: ["workspaces"] })}
            />
          ))}
        </div>
      )}

      <CreateWorkspaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        repos={repos}
      />
    </div>
  );
}
