---
name: GitHub API field contracts
description: Correct field names and shapes for GitHub/repository routes between backend and frontend.
---

## GitHub Status (`GET /api/v1/github/status`)
Returns:
```json
{
  "connected": bool,
  "status": "connected|disconnected|expired|invalid",
  "github_login": string | null,
  "github_name": string | null,
  "github_avatar_url": string | null,
  "scopes": string[],           // parsed array, NOT comma-string
  "last_verified_at": ISO | null,
  "created_at": ISO
}
```
Frontend type: `GitHubStatus` in `repo-api.ts`.

## GitHub Connect (`POST /api/v1/github/connect/pat`)
Returns:
```json
{
  "connected": true,
  "github_login": string,
  "github_name": string | null,
  "github_avatar_url": string,
  "scopes": string[]
}
```
**Why:** `verifyToken` returns `scopes: string` (comma-separated from `X-OAuth-Scopes` header). Both `/connect/pat` and `/status` routes now parse it into `string[]` before responding.

## GitHub Repos (`GET /api/v1/github/repos` and `/repos/search`)
Returns snake_case `GitHubRepo[]` (via `fmtGitHubRepo` mapper in `github.ts`):
```
id, name, full_name, description, private, language, stargazers_count, updated_at (string|null), html_url, default_branch
```
**Why:** `listRepositories`/`searchRepositories` in `lib/github` return camelCase `RepoInfo` objects; a mapper converts to snake_case for the frontend.

## Repository Analysis (`GET /api/v1/repositories/:id/analysis`)
Returns `{ analysis: RepoAnalysisResult }` (wrapped). `repositoriesApi.analysis()` in `repo-api.ts` unwraps it and returns the inner object directly.

Key fields on `RepoAnalysis`:
- `buildSystem` (NOT `buildTool`)
- `repositoryImportId` (NOT `repositoryId`)
- `fullContext` contains `{ analysis: { scripts: Record<string,string> } }` — scripts live here, not at the top level

**How to apply:** Any frontend code reading analysis data must use `buildSystem`, `repositoryImportId`, and access scripts via `fullContext.analysis.scripts`.
