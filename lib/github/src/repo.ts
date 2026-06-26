/**
 * GitHub repository operations via Octokit REST API.
 * List repos, fetch branches, commits, metadata.
 */

import type { Octokit } from "@octokit/rest";

export interface RepoInfo {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  defaultBranch: string;
  cloneUrl: string;
  sshUrl: string;
  htmlUrl: string;
  isPrivate: boolean;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  updatedAt: string | null;
}

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  email: string;
  date: string;
  url: string;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  url: string;
  state: string;
  body: string;
}

/**
 * List repositories accessible to the authenticated user.
 */
export async function listRepositories(
  octokit: Octokit,
  options: { perPage?: number; page?: number; type?: "all" | "public" | "private" } = {}
): Promise<RepoInfo[]> {
  const { perPage = 50, page = 1, type = "all" } = options;
  const { data } = await octokit.rest.repos.listForAuthenticatedUser({
    per_page: perPage,
    page,
    type,
    sort: "updated",
    direction: "desc",
  });
  return data.map(mapRepo);
}

/**
 * Search GitHub for repositories by query.
 */
export async function searchRepositories(
  octokit: Octokit,
  query: string,
  perPage = 20
): Promise<RepoInfo[]> {
  const { data } = await octokit.rest.search.repos({
    q: query,
    per_page: perPage,
    sort: "updated",
  });
  return data.items.map(mapSearchRepo);
}

/**
 * Get full metadata for a single repository.
 */
export async function getRepository(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<RepoInfo> {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  return mapRepo(data);
}

/**
 * Parse a GitHub URL into owner/repo.
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const patterns = [
    /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?(?:[/#?].*)?$/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { owner: match[1]!, repo: match[2]! };
    }
  }
  return null;
}

/**
 * List branches of a repository.
 */
export async function listBranches(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<BranchInfo[]> {
  const { data } = await octokit.rest.repos.listBranches({
    owner,
    repo,
    per_page: 100,
  });
  return data.map((b) => ({
    name: b.name,
    sha: b.commit.sha,
    protected: b.protected,
  }));
}

/**
 * List recent commits on a branch.
 */
export async function listCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch?: string,
  perPage = 30
): Promise<CommitInfo[]> {
  const { data } = await octokit.rest.repos.listCommits({
    owner,
    repo,
    sha: branch,
    per_page: perPage,
  });
  return data.map((c) => ({
    sha: c.sha,
    message: c.commit.message.split("\n")[0] ?? "",
    author: c.commit.author?.name ?? c.author?.login ?? "Unknown",
    email: c.commit.author?.email ?? "",
    date: c.commit.author?.date ?? "",
    url: c.html_url,
  }));
}

/**
 * Create a pull request.
 */
export async function createPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
  }
): Promise<PullRequestInfo> {
  const { data } = await octokit.rest.pulls.create({
    owner,
    repo,
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base,
    draft: options.draft ?? false,
  });
  return {
    number: data.number,
    title: data.title,
    url: data.html_url,
    state: data.state,
    body: data.body ?? "",
  };
}

/**
 * Build a clone URL that includes the PAT for authentication.
 */
export function buildAuthenticatedCloneUrl(cloneUrl: string, pat: string): string {
  return cloneUrl.replace("https://", `https://${pat}@`);
}

// ─── Internal mappers ──────────────────────────────────────────────────────────

function mapRepo(data: {
  id: number;
  owner: { login: string };
  name: string;
  full_name: string;
  description?: string | null;
  default_branch: string;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  private: boolean;
  language?: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at?: string | null;
}): RepoInfo {
  return {
    id: data.id,
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? null,
    defaultBranch: data.default_branch,
    cloneUrl: data.clone_url,
    sshUrl: data.ssh_url,
    htmlUrl: data.html_url,
    isPrivate: data.private,
    language: data.language ?? null,
    stargazersCount: data.stargazers_count,
    forksCount: data.forks_count,
    updatedAt: data.updated_at ?? null,
  };
}

function mapSearchRepo(data: {
  id: number;
  owner: { login: string } | null;
  name: string;
  full_name: string;
  description?: string | null;
  default_branch?: string;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  private: boolean;
  language?: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at?: string | null;
}): RepoInfo {
  return {
    id: data.id,
    owner: data.owner?.login ?? "",
    name: data.name,
    fullName: data.full_name,
    description: data.description ?? null,
    defaultBranch: data.default_branch ?? "main",
    cloneUrl: data.clone_url,
    sshUrl: data.ssh_url,
    htmlUrl: data.html_url,
    isPrivate: data.private,
    language: data.language ?? null,
    stargazersCount: data.stargazers_count,
    forksCount: data.forks_count,
    updatedAt: data.updated_at ?? null,
  };
}
