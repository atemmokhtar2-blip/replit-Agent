/**
 * Workspace Session Routes
 *
 * POST /                — Create workspace (copy repo + create branch)
 * GET  /:id             — Get workspace info
 * DELETE /:id           — Delete workspace (cleanup)
 * POST /:id/branch      — Create/checkout a branch
 * GET  /:id/diff        — Get current diff
 * POST /:id/validate    — Run validation pipeline
 * POST /:id/commit      — Stage + commit all changes
 * POST /:id/push        — Push branch to remote
 * POST /:id/pr          — Create pull request
 * POST /:id/undo        — Undo last commit
 * POST /:id/rollback    — Hard reset to a commit
 * GET  /:id/log         — Get git log
 */

import { Router } from "express";
import { z } from "zod";
import { db, workspaceSessionsTable, repositoryImportsTable, githubConnectionsTable, gitOperationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { decrypt, createClient, createPullRequest, buildAuthenticatedCloneUrl } from "@workspace/github";
import {
  createWorkspace, getWorkspaceDiff, commitWorkspaceChanges,
  pushWorkspaceBranch, undoWorkspaceLastCommit, rollbackWorkspace,
  resetWorkspace, getWorkspaceLog, getWorkspaceBranch,
  deleteWorkspaceSession, generateBranchName, getWorkspacePath,
} from "@workspace/repo-agent";
import { runValidation } from "@workspace/repo-agent";
import { createBranch } from "@workspace/github";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";
import { generateId } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";
import { existsSync } from "fs";

const router = Router();
router.use(authenticate);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createWorkspaceSchema = z.object({
  repository_import_id: z.string().min(1),
  name: z.string().min(1).optional(),
  branch_name: z.string().optional(),
  base_branch: z.string().optional(),
});

const commitSchema = z.object({
  message: z.string().min(1, "Commit message is required"),
});

const rollbackSchema = z.object({
  commit_hash: z.string().min(1, "Commit hash is required"),
});

const prSchema = z.object({
  title: z.string().min(1),
  body: z.string().default(""),
  draft: z.boolean().default(false),
});

const branchSchema = z.object({
  branch_name: z.string().min(1),
  from_branch: z.string().optional(),
});

const validateSchema = z.object({
  skip_checks: z.array(z.enum(["build", "typecheck", "lint", "deps"])).default([]),
});

// ─── POST / ───────────────────────────────────────────────────────────────────

router.post("/", validateBody(createWorkspaceSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof createWorkspaceSchema>;

  const repo = await getRepoForUser(userId, body.repository_import_id, res);
  if (!repo) return;

  if (repo.status !== "ready" && repo.status !== "analyzing") {
    res.status(400).json({ error: `Repository is not ready (status: ${repo.status}). Please wait for import to complete.` });
    return;
  }

  if (!repo.localPath || !existsSync(repo.localPath)) {
    res.status(400).json({ error: "Repository source path not available" });
    return;
  }

  const conn = await getUserConnection(userId, res);
  if (!conn) return;

  const baseBranch = body.base_branch ?? repo.defaultBranch;
  const branchName = body.branch_name ?? generateBranchName(body.name ?? "ai-changes");
  const sessionId = generateId();
  const workspaceName = body.name ?? `Workspace ${new Date().toLocaleDateString()}`;

  let workspaceInfo;
  try {
    workspaceInfo = await createWorkspace({
      userId,
      sessionId,
      sourcePath: repo.localPath,
      branchName,
      baseBranch,
      pat: conn.token,
      cloneUrl: repo.cloneUrl,
      authorName: conn.githubName ?? conn.githubLogin ?? undefined,
      authorEmail: conn.githubEmail ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, userId, repoId: repo.id }, "Failed to create workspace");
    res.status(500).json({ error: `Failed to create workspace: ${msg}` });
    return;
  }

  const [session] = await db.insert(workspaceSessionsTable).values({
    id: sessionId,
    userId,
    repositoryImportId: repo.id,
    name: workspaceName,
    localPath: workspaceInfo.localPath,
    baseBranch,
    currentBranch: branchName,
    status: "active",
  }).returning();

  await db.insert(gitOperationsTable).values({
    id: generateId(),
    userId,
    workspaceSessionId: sessionId,
    repositoryImportId: repo.id,
    operation: "branch",
    branch: branchName,
    status: "success",
    output: `Created branch ${branchName} from ${baseBranch}`,
  });

  logger.info({ userId, sessionId, branchName }, "Workspace created");
  res.status(201).json({ workspace: fmtSession(session!) });
});

// ─── GET / (list) ─────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const userId = req.user!.sub;
  const repoId = req.query["repository_import_id"] as string | undefined;

  let query = db.select().from(workspaceSessionsTable)
    .$dynamic()
    .orderBy(desc(workspaceSessionsTable.updatedAt));

  const conditions = [eq(workspaceSessionsTable.userId, userId)];
  if (repoId) conditions.push(eq(workspaceSessionsTable.repositoryImportId, repoId));

  const sessions = await query.where(and(...conditions));
  res.json({ items: sessions.map(fmtSession) });
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const userId = req.user!.sub;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;
  res.json({ workspace: fmtSession(session) });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const userId = req.user!.sub;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  await deleteWorkspaceSession(userId, session.id);
  await db.update(workspaceSessionsTable).set({ status: "closed" }).where(eq(workspaceSessionsTable.id, session.id));

  res.json({ deleted: true });
});

// ─── POST /:id/branch ─────────────────────────────────────────────────────────

router.post("/:id/branch", validateBody(branchSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof branchSchema>;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  assertWorkspaceExists(session, res);

  try {
    await createBranch(session.localPath, body.branch_name, body.from_branch);
    await db.update(workspaceSessionsTable).set({ currentBranch: body.branch_name }).where(eq(workspaceSessionsTable.id, session.id));
    await logGitOp(userId, session.id, session.repositoryImportId, "branch", { branch: body.branch_name, status: "success" });
    res.json({ branch: body.branch_name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Branch creation failed: ${msg}` });
  }
});

// ─── GET /:id/diff ────────────────────────────────────────────────────────────

router.get("/:id/diff", async (req, res) => {
  const userId = req.user!.sub;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  try {
    const diff = await getWorkspaceDiff(session.localPath);
    res.json({ diff });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to get diff: ${msg}` });
  }
});

// ─── POST /:id/validate ───────────────────────────────────────────────────────

router.post("/:id/validate", validateBody(validateSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof validateSchema>;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  // Get package manager from analysis if available
  const [repo] = await db.select({ id: repositoryImportsTable.id })
    .from(repositoryImportsTable)
    .where(eq(repositoryImportsTable.id, session.repositoryImportId))
    .limit(1);

  try {
    const result = await runValidation({
      workspacePath: session.localPath,
      skipChecks: body.skip_checks,
      timeoutMs: 90_000,
    });
    res.json({ validation: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Validation failed: ${msg}` });
  }
});

// ─── POST /:id/commit ─────────────────────────────────────────────────────────

router.post("/:id/commit", validateBody(commitSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof commitSchema>;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  const conn = await getUserConnection(userId, res);
  if (!conn) return;

  try {
    const hash = await commitWorkspaceChanges(session.localPath, body.message, {
      name: conn.githubName ?? conn.githubLogin ?? "AI Agent",
      email: conn.githubEmail ?? "ai@agent.local",
    });

    await db.update(workspaceSessionsTable).set({
      lastCommitHash: hash,
      status: "committed",
    }).where(eq(workspaceSessionsTable.id, session.id));

    await logGitOp(userId, session.id, session.repositoryImportId, "commit", {
      branch: session.currentBranch,
      commitHash: hash,
      status: "success",
      output: body.message,
    });

    res.json({ commit_hash: hash, message: body.message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logGitOp(userId, session.id, session.repositoryImportId, "commit", { status: "failed", errorMessage: msg });
    res.status(500).json({ error: `Commit failed: ${msg}` });
  }
});

// ─── POST /:id/push ───────────────────────────────────────────────────────────

router.post("/:id/push", async (req, res) => {
  const userId = req.user!.sub;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  try {
    await pushWorkspaceBranch(session.localPath, session.currentBranch);
    await db.update(workspaceSessionsTable).set({ status: "pushed" }).where(eq(workspaceSessionsTable.id, session.id));
    await logGitOp(userId, session.id, session.repositoryImportId, "push", {
      branch: session.currentBranch,
      status: "success",
    });
    res.json({ pushed: true, branch: session.currentBranch });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logGitOp(userId, session.id, session.repositoryImportId, "push", { status: "failed", errorMessage: msg });
    res.status(500).json({ error: `Push failed: ${msg}` });
  }
});

// ─── POST /:id/pr ─────────────────────────────────────────────────────────────

router.post("/:id/pr", validateBody(prSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof prSchema>;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  const conn = await getUserConnection(userId, res);
  if (!conn) return;

  const repo = await getRepoForUser(userId, session.repositoryImportId, res);
  if (!repo) return;

  try {
    const octokit = createClient(conn.token);
    const pr = await createPullRequest(octokit, repo.owner, repo.name, {
      title: body.title,
      body: body.body,
      head: session.currentBranch,
      base: session.baseBranch,
      draft: body.draft,
    });

    await db.update(workspaceSessionsTable).set({
      status: "pr_created",
      prUrl: pr.url,
      prNumber: pr.number,
    }).where(eq(workspaceSessionsTable.id, session.id));

    await logGitOp(userId, session.id, session.repositoryImportId, "pr", {
      branch: session.currentBranch,
      prUrl: pr.url,
      status: "success",
      output: `PR #${pr.number}: ${pr.title}`,
    });

    res.status(201).json({ pull_request: pr });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logGitOp(userId, session.id, session.repositoryImportId, "pr", { status: "failed", errorMessage: msg });
    res.status(500).json({ error: `PR creation failed: ${msg}` });
  }
});

// ─── POST /:id/undo ───────────────────────────────────────────────────────────

router.post("/:id/undo", async (req, res) => {
  const userId = req.user!.sub;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  try {
    await undoWorkspaceLastCommit(session.localPath);
    await logGitOp(userId, session.id, session.repositoryImportId, "reset", {
      branch: session.currentBranch, status: "success", output: "Undid last commit",
    });
    res.json({ undone: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Undo failed: ${msg}` });
  }
});

// ─── POST /:id/rollback ───────────────────────────────────────────────────────

router.post("/:id/rollback", validateBody(rollbackSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof rollbackSchema>;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  try {
    await rollbackWorkspace(session.localPath, body.commit_hash);
    await logGitOp(userId, session.id, session.repositoryImportId, "rollback", {
      branch: session.currentBranch,
      commitHash: body.commit_hash,
      status: "success",
    });
    res.json({ rolled_back: true, to_commit: body.commit_hash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Rollback failed: ${msg}` });
  }
});

// ─── GET /:id/log ─────────────────────────────────────────────────────────────

router.get("/:id/log", async (req, res) => {
  const userId = req.user!.sub;
  const session = await getSession(userId, req.params["id"] as string, res);
  if (!session) return;

  if (!assertWorkspaceExists(session, res)) return;

  const count = Number(req.query["count"] ?? 20);
  const log = await getWorkspaceLog(session.localPath, count);
  res.json({ log });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSession(userId: string, id: string, res: import("express").Response) {
  const [session] = await db.select()
    .from(workspaceSessionsTable)
    .where(and(eq(workspaceSessionsTable.id, id), eq(workspaceSessionsTable.userId, userId)))
    .limit(1);
  if (!session) {
    res.status(404).json({ error: "Workspace not found" });
    return null;
  }
  return session;
}

async function getRepoForUser(userId: string, repoId: string, res: import("express").Response) {
  const [repo] = await db.select()
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, repoId), eq(repositoryImportsTable.userId, userId)))
    .limit(1);
  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return null;
  }
  return repo;
}

async function getUserConnection(userId: string, res: import("express").Response) {
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
  return { ...conn, token };
}

function assertWorkspaceExists(session: { localPath: string }, res: import("express").Response): boolean {
  if (!existsSync(session.localPath)) {
    res.status(410).json({ error: "Workspace directory no longer exists. It may have been cleaned up. Please create a new workspace." });
    return false;
  }
  return true;
}

async function logGitOp(
  userId: string,
  workspaceSessionId: string,
  repositoryImportId: string,
  operation: string,
  data: { branch?: string; commitHash?: string; prUrl?: string; status: string; output?: string; errorMessage?: string }
) {
  await db.insert(gitOperationsTable).values({
    id: generateId(),
    userId,
    workspaceSessionId,
    repositoryImportId,
    operation,
    branch: data.branch,
    commitHash: data.commitHash,
    prUrl: data.prUrl,
    status: data.status,
    output: data.output,
    errorMessage: data.errorMessage,
  });
}

function fmtSession(s: typeof workspaceSessionsTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    repository_import_id: s.repositoryImportId,
    base_branch: s.baseBranch,
    current_branch: s.currentBranch,
    status: s.status,
    last_commit_hash: s.lastCommitHash,
    pr_url: s.prUrl,
    pr_number: s.prNumber,
    local_path: s.localPath,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

export default router;
