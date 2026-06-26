/**
 * Repository Import Routes
 *
 * GET  /                — List imported repositories
 * POST /import          — Import (clone) a repository
 * GET  /:id             — Get repository details
 * DELETE /:id           — Remove import
 * GET  /:id/branches    — List branches
 * GET  /:id/commits     — List recent commits
 * GET  /:id/analysis    — Get analysis results
 * POST /:id/analyze     — (Re)trigger analysis
 */

import { Router } from "express";
import { z } from "zod";
import { db, repositoryImportsTable, repoAnalysisResultsTable, githubConnectionsTable, gitOperationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { decrypt, createClient, getRepository, listBranches, listCommits, buildAuthenticatedCloneUrl, parseGitHubUrl, cloneRepository, getLog } from "@workspace/github";
import { analyzeRepository, generateProjectContext, detectRequiredSecrets } from "@workspace/repo-agent";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";
import { generateId } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir } from "fs/promises";

const router = Router();
router.use(authenticate);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const importSchema = z.object({
  url: z.string().url("Must be a valid GitHub repository URL").optional(),
  owner: z.string().optional(),
  repo: z.string().optional(),
}).refine((d) => d.url || (d.owner && d.repo), {
  message: "Provide either url or both owner and repo",
});

// ─── GET / ────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const userId = req.user!.sub;
  const repos = await db
    .select()
    .from(repositoryImportsTable)
    .where(eq(repositoryImportsTable.userId, userId))
    .orderBy(desc(repositoryImportsTable.updatedAt));

  res.json({ items: repos.map(fmtRepo) });
});

// ─── POST /import ─────────────────────────────────────────────────────────────

router.post("/import", validateBody(importSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof importSchema>;

  // Resolve owner/repo from URL or direct fields
  let owner: string;
  let repoName: string;

  if (body.url) {
    const parsed = parseGitHubUrl(body.url);
    if (!parsed) {
      res.status(400).json({ error: "Could not parse GitHub URL. Expected format: https://github.com/owner/repo" });
      return;
    }
    owner = parsed.owner;
    repoName = parsed.repo;
  } else {
    owner = body.owner!;
    repoName = body.repo!;
  }

  // Get user's GitHub connection
  const [conn] = await db
    .select()
    .from(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId))
    .limit(1);

  if (!conn) {
    res.status(400).json({ error: "No GitHub connection found. Please connect your GitHub account first." });
    return;
  }

  let token: string;
  try {
    token = decrypt(conn.encryptedToken);
  } catch {
    res.status(500).json({ error: "Failed to decrypt GitHub credentials" });
    return;
  }

  // Fetch repo metadata from GitHub API
  let repoInfo;
  try {
    const octokit = createClient(token);
    repoInfo = await getRepository(octokit, owner, repoName);
  } catch (err) {
    logger.warn({ err, owner, repo: repoName }, "Failed to fetch repo from GitHub");
    res.status(404).json({ error: `Repository ${owner}/${repoName} not found or not accessible` });
    return;
  }

  // Create the DB record first (status: cloning)
  const repoId = generateId();
  const localPath = join(tmpdir(), "ai-agent-repos", userId, repoId);

  const [inserted] = await db.insert(repositoryImportsTable).values({
    id: repoId,
    userId,
    githubConnectionId: conn.id,
    owner,
    name: repoName,
    fullName: repoInfo.fullName,
    description: repoInfo.description,
    defaultBranch: repoInfo.defaultBranch,
    cloneUrl: repoInfo.cloneUrl,
    htmlUrl: repoInfo.htmlUrl,
    isPrivate: repoInfo.isPrivate,
    localPath,
    status: "cloning",
  }).returning();

  // Respond immediately — cloning happens async
  res.status(202).json({ repository: fmtRepo(inserted!), message: "Repository import started" });

  // Async: clone and analyze
  setImmediate(async () => {
    try {
      await mkdir(localPath, { recursive: true });
      const authUrl = buildAuthenticatedCloneUrl(repoInfo.cloneUrl, token);
      await cloneRepository({ url: authUrl, destination: localPath, branch: repoInfo.defaultBranch });

      await db.update(repositoryImportsTable).set({ status: "analyzing" }).where(eq(repositoryImportsTable.id, repoId));

      await db.insert(gitOperationsTable).values({
        id: generateId(),
        userId,
        repositoryImportId: repoId,
        operation: "clone",
        branch: repoInfo.defaultBranch,
        status: "success",
        output: `Cloned ${repoInfo.fullName}`,
      });

      // Run analysis
      const analysis = await analyzeRepository(localPath);
      const commits = await getLog(localPath, 10);
      const context = generateProjectContext(analysis, commits);
      const requiredSecrets = detectRequiredSecrets(analysis);

      await db.insert(repoAnalysisResultsTable).values({
        id: generateId(),
        repositoryImportId: repoId,
        framework: analysis.framework,
        language: analysis.language,
        packageManager: analysis.packageManager,
        buildSystem: analysis.buildSystem,
        hasDatabase: analysis.hasDatabase,
        hasDocker: analysis.hasDocker,
        hasCI: analysis.hasCI,
        folderTree: analysis.folderTree as unknown as Record<string, unknown>,
        dependencies: analysis.dependencies as unknown as Record<string, unknown>,
        devDependencies: analysis.devDependencies as unknown as Record<string, unknown>,
        detectedEnvVars: analysis.detectedEnvVars as unknown as Record<string, unknown>[],
        detectedSecrets: requiredSecrets as unknown as Record<string, unknown>[],
        routes: analysis.routes as unknown as string[],
        components: analysis.components as unknown as string[],
        apis: analysis.apis as unknown as string[],
        deploymentConfig: analysis.deploymentConfig as unknown as Record<string, unknown> | null,
        fullContext: context as unknown as Record<string, unknown>,
      });

      await db.update(repositoryImportsTable).set({ status: "ready" }).where(eq(repositoryImportsTable.id, repoId));
      logger.info({ repoId, fullName: repoInfo.fullName }, "Repository import and analysis complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, repoId }, "Repository import failed");
      await db.update(repositoryImportsTable).set({ status: "error", errorMessage: msg }).where(eq(repositoryImportsTable.id, repoId));
    }
  });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [repo] = await db
    .select()
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, id), eq(repositoryImportsTable.userId, userId)))
    .limit(1);

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const [analysis] = await db
    .select()
    .from(repoAnalysisResultsTable)
    .where(eq(repoAnalysisResultsTable.repositoryImportId, id))
    .limit(1);

  res.json({ repository: fmtRepo(repo), analysis: analysis ?? null });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [repo] = await db
    .select({ id: repositoryImportsTable.id, localPath: repositoryImportsTable.localPath })
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, id), eq(repositoryImportsTable.userId, userId)))
    .limit(1);

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  await db.delete(repositoryImportsTable).where(eq(repositoryImportsTable.id, id));

  // Clean up local clone (best-effort)
  if (repo.localPath) {
    import("fs/promises").then(({ rm }) => rm(repo.localPath!, { recursive: true, force: true }).catch(() => {}));
  }

  res.json({ deleted: true });
});

// ─── GET /:id/branches ────────────────────────────────────────────────────────

router.get("/:id/branches", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const repo = await getRepoWithToken(userId, id, res);
  if (!repo) return;

  const octokit = createClient(repo.token);
  const branches = await listBranches(octokit, repo.owner, repo.name);
  res.json({ items: branches });
});

// ─── GET /:id/commits ─────────────────────────────────────────────────────────

router.get("/:id/commits", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };
  const branch = req.query["branch"] as string | undefined;
  const per_page = Number(req.query["per_page"] ?? 30);

  const repo = await getRepoWithToken(userId, id, res);
  if (!repo) return;

  const octokit = createClient(repo.token);
  const commits = await listCommits(octokit, repo.owner, repo.name, branch, per_page);
  res.json({ items: commits });
});

// ─── GET /:id/analysis ────────────────────────────────────────────────────────

router.get("/:id/analysis", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [repo] = await db.select({ id: repositoryImportsTable.id })
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, id), eq(repositoryImportsTable.userId, userId)))
    .limit(1);

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const [analysis] = await db
    .select()
    .from(repoAnalysisResultsTable)
    .where(eq(repoAnalysisResultsTable.repositoryImportId, id))
    .limit(1);

  if (!analysis) {
    res.status(404).json({ error: "Analysis not yet available. Please wait for import to complete." });
    return;
  }

  res.json({ analysis });
});

// ─── POST /:id/analyze ────────────────────────────────────────────────────────

router.post("/:id/analyze", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [repo] = await db.select()
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, id), eq(repositoryImportsTable.userId, userId)))
    .limit(1);

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  if (!repo.localPath) {
    res.status(400).json({ error: "Repository not yet cloned" });
    return;
  }

  await db.update(repositoryImportsTable).set({ status: "analyzing" }).where(eq(repositoryImportsTable.id, id));
  res.json({ message: "Analysis started" });

  setImmediate(async () => {
    try {
      const analysis = await analyzeRepository(repo.localPath!);
      const commits = await getLog(repo.localPath!, 10);
      const context = generateProjectContext(analysis, commits);
      const requiredSecrets = detectRequiredSecrets(analysis);

      await db.delete(repoAnalysisResultsTable).where(eq(repoAnalysisResultsTable.repositoryImportId, id));
      await db.insert(repoAnalysisResultsTable).values({
        id: generateId(),
        repositoryImportId: id,
        framework: analysis.framework,
        language: analysis.language,
        packageManager: analysis.packageManager,
        buildSystem: analysis.buildSystem,
        hasDatabase: analysis.hasDatabase,
        hasDocker: analysis.hasDocker,
        hasCI: analysis.hasCI,
        folderTree: analysis.folderTree as unknown as Record<string, unknown>,
        dependencies: analysis.dependencies as unknown as Record<string, unknown>,
        devDependencies: analysis.devDependencies as unknown as Record<string, unknown>,
        detectedEnvVars: analysis.detectedEnvVars as unknown as Record<string, unknown>[],
        detectedSecrets: requiredSecrets as unknown as Record<string, unknown>[],
        routes: analysis.routes as unknown as string[],
        components: analysis.components as unknown as string[],
        apis: analysis.apis as unknown as string[],
        deploymentConfig: analysis.deploymentConfig as unknown as Record<string, unknown> | null,
        fullContext: context as unknown as Record<string, unknown>,
      });

      await db.update(repositoryImportsTable).set({ status: "ready" }).where(eq(repositoryImportsTable.id, id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(repositoryImportsTable).set({ status: "error", errorMessage: msg }).where(eq(repositoryImportsTable.id, id));
    }
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getRepoWithToken(userId: string, repoId: string, res: import("express").Response) {
  const [repo] = await db.select()
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, repoId), eq(repositoryImportsTable.userId, userId)))
    .limit(1);

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return null;
  }

  const [conn] = await db.select()
    .from(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId))
    .limit(1);

  if (!conn) {
    res.status(400).json({ error: "No GitHub connection found" });
    return null;
  }

  let token: string;
  try {
    token = decrypt(conn.encryptedToken);
  } catch {
    res.status(500).json({ error: "Failed to decrypt GitHub token" });
    return null;
  }

  return { ...repo, token };
}

function fmtRepo(r: typeof repositoryImportsTable.$inferSelect) {
  return {
    id: r.id,
    owner: r.owner,
    name: r.name,
    full_name: r.fullName,
    description: r.description,
    default_branch: r.defaultBranch,
    clone_url: r.cloneUrl,
    html_url: r.htmlUrl,
    is_private: r.isPrivate,
    status: r.status,
    error_message: r.errorMessage,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export default router;
