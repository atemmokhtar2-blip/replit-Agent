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
  userId: string;
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  localPath: string | null;
  status: "pending" | "cloning" | "analyzing" | "ready" | "error";
  errorMessage: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
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
  repositoryId: string;
  userId: string;
  branch: string;
  localPath: string;
  status: "active" | "idle" | "error" | "closed";
  createdAt: string;
  updatedAt: string;
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
  importRepo: (payload: { url?: string; owner?: string; repo?: string }) =>
    apiFetch<RepositoryImport>("/repositories/import", {
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

export const workspacesApi = {
  list: () => apiFetch<{ items: WorkspaceSession[] }>("/workspaces"),
  create: (payload: { repositoryId: string; branch?: string }) =>
    apiFetch<WorkspaceSession>("/workspaces", { method: "POST", body: JSON.stringify(payload) }),
  get: (id: string) => apiFetch<WorkspaceSession>(`/workspaces/${id}`),
  remove: (id: string) =>
    apiFetch<{ message: string }>(`/workspaces/${id}`, { method: "DELETE" }),
};
