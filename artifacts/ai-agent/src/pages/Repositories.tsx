import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { repositoriesApi, githubApi, type RepositoryImport, type GitHubRepo } from "@/lib/repo-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  Loader2, GitFork, Plus, Trash2, RefreshCw, Search,
  Github, Star, Lock, GitBranch, Clock, ChevronRight,
  AlertCircle, CheckCircle2, Package, Code2
} from "lucide-react";
import { useLocation } from "wouter";

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: RepositoryImport["status"] }) {
  const map: Record<RepositoryImport["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending:   { label: "Pending",   variant: "secondary" },
    cloning:   { label: "Cloning…",  variant: "secondary" },
    analyzing: { label: "Analyzing…",variant: "secondary" },
    ready:     { label: "Ready",     variant: "default" },
    error:     { label: "Error",     variant: "destructive" },
  };
  const { label, variant } = map[status] ?? { label: status, variant: "outline" };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Import Dialog ─────────────────────────────────────────────────────────────
function ImportDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [tab, setTab] = useState<"url" | "browse">("url");
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const { data: myRepos, isLoading: loadingMyRepos } = useQuery({
    queryKey: ["github-repos"],
    queryFn: () => githubApi.repos({ per_page: 50 }),
    enabled: open && tab === "browse",
  });

  const { data: searchResults, isLoading: loadingSearch } = useQuery({
    queryKey: ["github-search", search],
    queryFn: () => githubApi.searchRepos(search),
    enabled: open && tab === "browse" && search.length > 1,
  });

  const importMutation = useMutation({
    mutationFn: repositoriesApi.importRepo,
    onSuccess: () => {
      toast.success("Repository import started — analysis will begin shortly");
      onImported();
      onClose();
      setUrl("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleImportUrl = () => {
    if (!url.trim()) return;
    importMutation.mutate({ url: url.trim() });
  };

  const handleImportRepo = (r: GitHubRepo) => {
    const [owner, repo] = r.full_name.split("/");
    importMutation.mutate({ owner, repo });
  };

  const displayRepos = search.length > 1
    ? (searchResults?.items ?? [])
    : (myRepos?.items ?? []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitFork className="h-5 w-5" /> Import Repository
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "url" | "browse")} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="url" className="flex-1">By URL</TabsTrigger>
            <TabsTrigger value="browse" className="flex-1">Browse GitHub</TabsTrigger>
          </TabsList>

          <TabsContent value="url" className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label>GitHub Repository URL</Label>
              <Input
                placeholder="https://github.com/owner/repo"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleImportUrl()}
              />
              <p className="text-xs text-muted-foreground">
                Paste any public or private GitHub repository URL. Make sure your GitHub account has access.
              </p>
            </div>
            <Button
              onClick={handleImportUrl}
              disabled={!url.trim() || importMutation.isPending}
              className="w-full"
            >
              {importMutation.isPending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing…</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" />Import Repository</>
              )}
            </Button>
          </TabsContent>

          <TabsContent value="browse" className="mt-4 flex flex-col gap-3 min-h-0 flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search repositories…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput)}
              />
            </div>

            <ScrollArea className="flex-1 min-h-0 max-h-80">
              {(loadingMyRepos || loadingSearch) ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : displayRepos.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  {search.length > 1 ? "No results found" : "No repositories found. Connect GitHub in Settings first."}
                </div>
              ) : (
                <div className="space-y-1.5 pr-2">
                  {displayRepos.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => handleImportRepo(r)}
                      disabled={importMutation.isPending}
                      className="w-full text-left p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/40 transition-colors group"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {r.private ? (
                            <Lock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          ) : (
                            <Github className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          )}
                          <span className="text-sm font-medium truncate">{r.full_name}</span>
                          {r.language && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">{r.language}</Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
                          {r.stargazers_count > 0 && (
                            <span className="flex items-center gap-1">
                              <Star className="h-3 w-3" />{r.stargazers_count}
                            </span>
                          )}
                          <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </div>
                      {r.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{r.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Analysis panel ────────────────────────────────────────────────────────────
function AnalysisPanel({ repoId }: { repoId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["repo-analysis", repoId],
    queryFn: () => repositoriesApi.analysis(repoId),
  });

  if (isLoading) return (
    <div className="flex items-center gap-2 text-muted-foreground py-4">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading analysis…
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-muted-foreground py-4 text-sm">
      <AlertCircle className="h-4 w-4 text-amber-500" />
      Analysis not available yet. Import the repository first.
    </div>
  );

  if (!data) return null;

  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Language", value: data.language },
          { label: "Framework", value: data.framework },
          { label: "Package Manager", value: data.packageManager },
          { label: "Build Tool", value: data.buildTool },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-medium mt-0.5">{value ?? "—"}</p>
          </div>
        ))}
      </div>

      {data.detectedSecrets?.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
            Required Secrets ({data.detectedSecrets.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.detectedSecrets.map((s) => (
              <Badge key={s.key} variant={s.required ? "destructive" : "secondary"} className="font-mono text-xs">
                {s.key}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {Object.keys(data.scripts ?? {}).length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Code2 className="h-3.5 w-3.5" /> Scripts
          </p>
          <div className="rounded-md border border-border divide-y divide-border">
            {Object.entries(data.scripts).map(([name, cmd]) => (
              <div key={name} className="flex gap-3 px-3 py-2 text-xs">
                <span className="font-mono font-medium text-primary w-20 flex-shrink-0">{name}</span>
                <span className="text-muted-foreground font-mono truncate">{cmd}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Repo card ─────────────────────────────────────────────────────────────────
function RepoCard({ repo, onDeleted }: { repo: RepositoryImport; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: () => repositoriesApi.remove(repo.id),
    onSuccess: () => {
      toast.success("Repository removed");
      onDeleted();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const analyzeMutation = useMutation({
    mutationFn: () => repositoriesApi.analyze(repo.id),
    onSuccess: () => {
      toast.success("Analysis triggered");
      qc.invalidateQueries({ queryKey: ["repo-analysis", repo.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10">
              <GitFork className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm">{repo.fullName}</span>
                <StatusBadge status={repo.status} />
              </div>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />{repo.defaultBranch}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {new Date(repo.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {repo.errorMessage && (
                <p className="text-xs text-destructive mt-1 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />{repo.errorMessage}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            {repo.status === "ready" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded((p) => !p)}
                title="View analysis"
              >
                <Package className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => analyzeMutation.mutate()}
              disabled={analyzeMutation.isPending || repo.status === "cloning" || repo.status === "analyzing"}
              title="Re-analyze"
            >
              {analyzeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              title="Remove"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-border">
            <AnalysisPanel repoId={repo.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function Repositories() {
  const [importOpen, setImportOpen] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["repositories"],
    queryFn: repositoriesApi.list,
  });

  const { data: ghStatus } = useQuery({
    queryKey: ["github-status"],
    queryFn: githubApi.status,
  });

  const repos = data?.items ?? [];

  const [, setLocation] = useLocation();

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="min-w-0">
          <h2 className="page-title">Repositories</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Import and analyze GitHub repositories for AI-assisted development.
          </p>
        </div>
        <Button
          onClick={() => {
            if (!ghStatus?.connected) {
              toast.error("Connect your GitHub account first", {
                description: "Go to Settings → GitHub to connect your account.",
                action: { label: "Settings", onClick: () => setLocation("/settings?tab=github") },
              });
              return;
            }
            setImportOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> Import Repository
        </Button>
      </div>

      {/* GitHub not connected banner */}
      {!ghStatus?.connected && (
        <Card className="mb-5 border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">GitHub not connected</p>
                <p className="text-xs text-muted-foreground">
                  Connect your GitHub account in{" "}
                  <button
                    className="underline text-primary"
                    onClick={() => setLocation("/settings?tab=github")}
                  >
                    Settings → GitHub
                  </button>{" "}
                  to import repositories.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Repository list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading repositories…
        </div>
      ) : error ? (
        <Card>
          <CardContent className="pt-6 text-center text-destructive text-sm">
            Failed to load repositories.
          </CardContent>
        </Card>
      ) : repos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <GitFork className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No repositories imported yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Import a GitHub repository to start AI-assisted analysis.
            </p>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Import your first repository
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {repos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              onDeleted={() => qc.invalidateQueries({ queryKey: ["repositories"] })}
            />
          ))}
        </div>
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => qc.invalidateQueries({ queryKey: ["repositories"] })}
      />
    </div>
  );
}
