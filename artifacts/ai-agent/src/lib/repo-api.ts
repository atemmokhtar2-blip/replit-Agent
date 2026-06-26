/**
 * Typed fetch helpers for Repository Agent API routes.
 * Uses the same /api prefix that Vite proxies to localhost:8000.
 */

function authHeader(): Record<string, string> {
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeader(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), { status: res.status, data: body });
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubStatus {
  connected: boolean;
  login?: string;
  avatarUrl?: string;
  name?: string;
  scopes?: string[];
  connectedAt?: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  html_url: string;
  default_branch: string;
}

export interface RepositoryImport {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  description: string | null;
  default_branch: string;
  clone_url: string;
  html_url: string;
  is_private: boolean;
  status: "pending" | "cloning" | "analyzing" | "ready" | "error";
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepoAnalysis {
  id: string;
  repositoryId: string;
  framework: string | null;
  language: string | null;
  packageManager: string | null;
  buildTool: string | null;
  testFramework: string | null;
  detectedSecrets: Array<{ key: string; description?: string; required?: boolean }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  context: string | null;
  analyzedAt: string;
}

export interface RepoSecret {
  id: string;
  repositoryId: string;
  userId: string;
  key: string;
  description: string | null;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSession {
  id: string;
  name: string;
  repository_import_id: string;
  base_branch: string;
  current_branch: string;
  status: "active" | "idle" | "error" | "closed";
  last_commit_hash: string | null;
  pr_url: string | null;
  pr_number: number | null;
  local_path: string | null;
  created_at: string;
  updated_at: string;
}

// ─── GitHub ───────────────────────────────────────────────────────────────────

export const githubApi = {
  status: () => apiFetch<GitHubStatus>("/github/status"),
  connect: (token: string) =>
    apiFetch<{ message: string; login: string }>("/github/connect/pat", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  disconnect: () =>
    apiFetch<{ message: string }>("/github/disconnect", { method: "DELETE" }),
  repos: (params?: { per_page?: number; page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.per_page) qs.set("per_page", String(params.per_page));
    if (params?.page) qs.set("page", String(params.page));
    return apiFetch<{ items: GitHubRepo[]; total: number }>(`/github/repos?${qs}`);
  },
  searchRepos: (q: string) =>
    apiFetch<{ items: GitHubRepo[]; total: number }>(`/github/repos/search?q=${encodeURIComponent(q)}`),
};

// ─── Repositories ─────────────────────────────────────────────────────────────

export const repositoriesApi = {
  list: () => apiFetch<{ items: RepositoryImport[] }>("/repositories"),
  importRepo: (payload: { url?: string; owner?: string; repo?: string; pat?: string }) =>
    apiFetch<{ repository: RepositoryImport; message: string }>("/repositories/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  get: (id: string) => apiFetch<RepositoryImport>(`/repositories/${id}`),
  remove: (id: string) =>
    apiFetch<{ message: string }>(`/repositories/${id}`, { method: "DELETE" }),
  analysis: (id: string) => apiFetch<RepoAnalysis>(`/repositories/${id}/analysis`),
  analyze: (id: string) =>
    apiFetch<{ message: string }>(`/repositories/${id}/analyze`, { method: "POST" }),
  branches: (id: string) => apiFetch<{ items: string[] }>(`/repositories/${id}/branches`),
  commits: (id: string) =>
    apiFetch<{ items: Array<{ hash: string; message: string; author: string; date: string }> }>(
      `/repositories/${id}/commits`
    ),
};

// ─── Secrets Center ───────────────────────────────────────────────────────────

export const secretsApi = {
  list: (repositoryId?: string) => {
    const qs = repositoryId ? `?repositoryId=${repositoryId}` : "";
    return apiFetch<{ items: RepoSecret[] }>(`/secrets${qs}`);
  },
  create: (payload: { repositoryId: string; key: string; value: string; description?: string }) =>
    apiFetch<RepoSecret>("/secrets", { method: "POST", body: JSON.stringify(payload) }),
  update: (id: string, payload: { value?: string; description?: string }) =>
    apiFetch<RepoSecret>(`/secrets/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  remove: (id: string) =>
    apiFetch<{ message: string }>(`/secrets/${id}`, { method: "DELETE" }),
  envExample: (repositoryId: string) =>
    apiFetch<{ content: string }>(`/secrets/env-example?repositoryId=${repositoryId}`),
  detected: (repositoryId: string) =>
    apiFetch<{ items: Array<{ key: string; description?: string; required?: boolean }> }>(
      `/secrets/detected?repositoryId=${repositoryId}`
    ),
};

// ─── Workspaces ───────────────────────────────────────────────────────────────

export interface DiffFile {
  file: string;
  additions: number;
  deletions: number;
  hunks: Array<{ header: string; lines: string[] }>;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface ValidationResult {
  check: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export const workspacesApi = {
  list: (repositoryImportId?: string) => {
    const qs = repositoryImportId ? `?repository_import_id=${repositoryImportId}` : "";
    return apiFetch<{ items: WorkspaceSession[] }>(`/workspaces${qs}`);
  },
  create: (payload: {
    repository_import_id: string;
    name?: string;
    branch_name?: string;
    base_branch?: string;
  }) =>
    apiFetch<{ workspace: WorkspaceSession }>("/workspaces", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  get: (id: string) => apiFetch<{ workspace: WorkspaceSession }>(`/workspaces/${id}`),
  remove: (id: string) =>
    apiFetch<{ message: string }>(`/workspaces/${id}`, { method: "DELETE" }),

  // ── Git operations ──────────────────────────────────────────────────────
  diff: (id: string) =>
    apiFetch<{ diff: DiffFile[]; summary: { files: number; additions: number; deletions: number } }>(
      `/workspaces/${id}/diff`
    ),
  log: (id: string) =>
    apiFetch<{ log: GitCommit[] }>(`/workspaces/${id}/log`),
  branch: (id: string, payload: { branch_name: string; from_branch?: string }) =>
    apiFetch<{ message: string; branch: string }>(`/workspaces/${id}/branch`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  commit: (id: string, payload: { message: string }) =>
    apiFetch<{ message: string; hash: string }>(`/workspaces/${id}/commit`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  push: (id: string) =>
    apiFetch<{ message: string }>(`/workspaces/${id}/push`, { method: "POST" }),
  pr: (id: string, payload: { title: string; body?: string; draft?: boolean }) =>
    apiFetch<{ message: string; url: string; number: number }>(`/workspaces/${id}/pr`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  undo: (id: string) =>
    apiFetch<{ message: string }>(`/workspaces/${id}/undo`, { method: "POST" }),
  rollback: (id: string, payload: { commit_hash: string }) =>
    apiFetch<{ message: string }>(`/workspaces/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  validate: (id: string, payload?: { skip_checks?: string[] }) =>
    apiFetch<{ results: ValidationResult[]; passed: boolean }>(`/workspaces/${id}/validate`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
};
