/**
 * GitHub Authentication Routes
 *
 * POST /connect/pat   — Connect with a Personal Access Token
 * DELETE /disconnect  — Disconnect GitHub account
 * GET /status         — Get current connection status
 * POST /verify        — Verify / re-validate connection
 * GET /repos          — List repositories from GitHub
 * GET /repos/search   — Search GitHub repositories
 */

import { Router } from "express";
import { z } from "zod";
import { db, githubConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encrypt, decrypt, verifyToken, hasRequiredScopes, createClient, listRepositories, searchRepositories, parseGitHubUrl, getRepository, type RepoInfo } from "@workspace/github";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";
import { generateId } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";

const router = Router();
router.use(authenticate);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const connectPatSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

const searchReposSchema = z.object({
  q: z.string().min(1),
});

// ─── POST /connect/pat ────────────────────────────────────────────────────────

router.post("/connect/pat", validateBody(connectPatSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { token } = req.body as z.infer<typeof connectPatSchema>;

  let profile;
  try {
    profile = await verifyToken(token);
  } catch (err) {
    logger.warn({ err }, "GitHub PAT verification failed");
    res.status(401).json({ error: "Invalid GitHub token. Please check your Personal Access Token." });
    return;
  }

  const scopeCheck = hasRequiredScopes(profile.scopes);
  if (!scopeCheck.ok) {
    res.status(400).json({
      error: `Token is missing required scopes: ${scopeCheck.missing.join(", ")}. Please create a token with the 'repo' scope.`,
    });
    return;
  }

  let encryptedToken: string;
  try {
    encryptedToken = encrypt(token);
  } catch (err) {
    logger.error({ err }, "Failed to encrypt GitHub token");
    res.status(500).json({ error: "Failed to securely store token. Ensure ENCRYPTION_KEY is configured." });
    return;
  }

  // Upsert — one connection per user
  const existing = await db
    .select({ id: githubConnectionsTable.id })
    .from(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubConnectionsTable)
      .set({
        encryptedToken,
        connectionType: "pat",
        githubLogin: profile.login,
        githubName: profile.name,
        githubAvatarUrl: profile.avatarUrl,
        githubEmail: profile.email,
        scopes: profile.scopes,
        status: "connected",
        lastVerifiedAt: new Date(),
      })
      .where(eq(githubConnectionsTable.userId, userId));
  } else {
    await db.insert(githubConnectionsTable).values({
      id: generateId(),
      userId,
      connectionType: "pat",
      encryptedToken,
      githubLogin: profile.login,
      githubName: profile.name,
      githubAvatarUrl: profile.avatarUrl,
      githubEmail: profile.email,
      scopes: profile.scopes,
      status: "connected",
      lastVerifiedAt: new Date(),
    });
  }

  logger.info({ userId, githubLogin: profile.login }, "GitHub account connected via PAT");

  // parse scopes from comma-separated string to array for consistency with /status
  const connScopesArray = profile.scopes
    ? profile.scopes.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  res.json({
    connected: true,
    github_login: profile.login,
    github_name: profile.name,
    github_avatar_url: profile.avatarUrl,
    scopes: connScopesArray,
  });
});

// ─── DELETE /disconnect ───────────────────────────────────────────────────────

router.delete("/disconnect", async (req, res) => {
  const userId = req.user!.sub;
  await db
    .delete(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId));

  logger.info({ userId }, "GitHub account disconnected");
  res.json({ disconnected: true });
});

// ─── GET /status ──────────────────────────────────────────────────────────────

router.get("/status", async (req, res) => {
  const userId = req.user!.sub;
  const [conn] = await db
    .select()
    .from(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId))
    .limit(1);

  if (!conn) {
    res.json({ connected: false });
    return;
  }

  // scopes is stored as a comma-separated string; parse into array for the frontend
  const scopesArray = conn.scopes
    ? conn.scopes.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  res.json({
    connected: conn.status === "connected",
    status: conn.status,
    github_login: conn.githubLogin,
    github_name: conn.githubName,
    github_avatar_url: conn.githubAvatarUrl,
    scopes: scopesArray,
    last_verified_at: conn.lastVerifiedAt?.toISOString() ?? null,
    created_at: conn.createdAt.toISOString(),
  });
});

// ─── POST /verify ─────────────────────────────────────────────────────────────

router.post("/verify", async (req, res) => {
  const userId = req.user!.sub;
  const [conn] = await db
    .select()
    .from(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId))
    .limit(1);

  if (!conn) {
    res.status(404).json({ error: "No GitHub connection found" });
    return;
  }

  let token: string;
  try {
    token = decrypt(conn.encryptedToken);
  } catch {
    await db.update(githubConnectionsTable).set({ status: "invalid" }).where(eq(githubConnectionsTable.id, conn.id));
    res.status(500).json({ error: "Failed to decrypt token" });
    return;
  }

  let profile;
  try {
    profile = await verifyToken(token);
    await db.update(githubConnectionsTable).set({
      status: "connected",
      githubLogin: profile.login,
      githubName: profile.name,
      githubAvatarUrl: profile.avatarUrl,
      scopes: profile.scopes,
      lastVerifiedAt: new Date(),
    }).where(eq(githubConnectionsTable.id, conn.id));
  } catch {
    await db.update(githubConnectionsTable).set({ status: "invalid" }).where(eq(githubConnectionsTable.id, conn.id));
    res.status(401).json({ error: "GitHub token is no longer valid. Please reconnect.", valid: false });
    return;
  }

  res.json({
    valid: true,
    github_login: profile.login,
    github_name: profile.name,
    last_verified_at: new Date().toISOString(),
  });
});

// ─── GET /repos ───────────────────────────────────────────────────────────────

router.get("/repos", async (req, res) => {
  const userId = req.user!.sub;
  const conn = await getConnection(userId, res);
  if (!conn) return;

  const page = Number(req.query["page"] ?? 1);
  const per_page = Number(req.query["per_page"] ?? 30);
  const type = (req.query["type"] as "all" | "public" | "private") ?? "all";

  const octokit = createClient(conn.token);
  const repos = await listRepositories(octokit, { perPage: per_page, page, type });

  res.json({ items: repos.map(fmtGitHubRepo), page, per_page });
});

// ─── GET /repos/search ────────────────────────────────────────────────────────

router.get("/repos/search", async (req, res) => {
  const userId = req.user!.sub;
  const { q } = req.query as z.infer<typeof searchReposSchema>;
  if (!q) {
    res.status(400).json({ error: "q (query) is required" });
    return;
  }

  const conn = await getConnection(userId, res);
  if (!conn) return;

  const octokit = createClient(conn.token);
  const repos = await searchRepositories(octokit, q);
  res.json({ items: repos.map(fmtGitHubRepo) });
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function getConnection(userId: string, res: import("express").Response): Promise<{ token: string; conn: typeof githubConnectionsTable.$inferSelect } | null> {
  const [conn] = await db
    .select()
    .from(githubConnectionsTable)
    .where(eq(githubConnectionsTable.userId, userId))
    .limit(1);

  if (!conn) {
    res.status(404).json({ error: "No GitHub connection found. Please connect your account first." });
    return null;
  }

  let token: string;
  try {
    token = decrypt(conn.encryptedToken);
  } catch {
    res.status(500).json({ error: "Failed to decrypt GitHub token" });
    return null;
  }

  return { token, conn };
}

/**
 * Convert a camelCase RepoInfo into the snake_case shape the frontend expects.
 */
function fmtGitHubRepo(r: RepoInfo) {
  return {
    id: r.id,
    name: r.name,
    full_name: r.fullName,
    description: r.description,
    private: r.isPrivate,
    language: r.language,
    stargazers_count: r.stargazersCount,
    updated_at: r.updatedAt ?? null,
    html_url: r.htmlUrl,
    default_branch: r.defaultBranch,
  };
}

export { getConnection };
export default router;
