/**
 * GitHub API client factory.
 * Creates an authenticated Octokit instance from a decrypted PAT.
 */

import { Octokit } from "@octokit/rest";

export interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string;
  scopes: string;
}

export function createClient(pat: string): Octokit {
  return new Octokit({
    auth: pat,
    userAgent: "ai-agent-platform/1.0",
    retry: { enabled: true, retries: 2 },
  });
}

/**
 * Verify a PAT is valid and return the authenticated user's profile.
 * Throws on invalid token.
 */
export async function verifyToken(pat: string): Promise<GitHubUser> {
  const octokit = createClient(pat);
  const { data: user, headers } = await octokit.rest.users.getAuthenticated();
  const scopeHeader = (headers as Record<string, string>)["x-oauth-scopes"] ?? "";
  return {
    login: user.login,
    name: user.name ?? null,
    email: user.email ?? null,
    avatarUrl: user.avatar_url,
    scopes: scopeHeader,
  };
}

/**
 * Check that the PAT has the required scopes for repo operations.
 */
export function hasRequiredScopes(scopes: string): { ok: boolean; missing: string[] } {
  const granted = scopes.split(",").map((s) => s.trim().toLowerCase());
  const required = ["repo"];
  const missing = required.filter((r) => !granted.includes(r) && !granted.includes("public_repo"));
  return { ok: missing.length === 0, missing };
}
