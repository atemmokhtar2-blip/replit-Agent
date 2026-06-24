/**
 * Memory Module — Project Key-Value Memory Store
 *
 * Persistent key-value memory scoped per project.
 * Used by AI agents for context continuity across sessions.
 * Supports scopes: global | session | agent
 */

import { Router } from "express";
import { z } from "zod";
import { db, projectMemoryTable, projectsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { generateId } from "../../lib/auth.js";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";

const router = Router();
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtEntry(e: typeof projectMemoryTable.$inferSelect) {
  return {
    id: e.id,
    project_id: e.projectId,
    key: e.key,
    value: e.value,
    scope: e.scope,
    expires_at: e.expiresAt?.toISOString() ?? null,
    created_at: e.createdAt.toISOString(),
    updated_at: e.updatedAt.toISOString(),
  };
}

async function assertProjectOwner(projectId: string, userId: string, res: any): Promise<boolean> {
  const [project] = await db
    .select({ userId: projectsTable.userId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return false; }
  if (project.userId !== userId) { res.status(403).json({ error: "Access denied" }); return false; }
  return true;
}

function isExpired(e: typeof projectMemoryTable.$inferSelect): boolean {
  return !!e.expiresAt && e.expiresAt < new Date();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /memory/projects/:projectId — list all non-expired entries
router.get("/projects/:projectId", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId } = req.params;
  const scope = req.query["scope"] as string | undefined;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const conditions = [eq(projectMemoryTable.projectId, projectId)];
  if (scope) conditions.push(eq(projectMemoryTable.scope, scope));

  const entries = await db
    .select()
    .from(projectMemoryTable)
    .where(and(...conditions));

  const active = entries.filter((e) => !isExpired(e));
  res.json({ items: active.map(fmtEntry), total: active.length });
});

// GET /memory/projects/:projectId/:key
router.get("/projects/:projectId/:key", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId, key } = req.params;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const [entry] = await db
    .select()
    .from(projectMemoryTable)
    .where(and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.key, key)))
    .limit(1);

  if (!entry || isExpired(entry)) { res.status(404).json({ error: "Memory key not found" }); return; }
  res.json(fmtEntry(entry));
});

// PUT /memory/projects/:projectId/:key — upsert
const setMemorySchema = z.object({
  value: z.unknown(),
  scope: z.enum(["global", "session", "agent"]).optional().default("global"),
  ttl_seconds: z.number().int().positive().optional(),
});

router.put("/projects/:projectId/:key", validateBody(setMemorySchema), async (req, res) => {
  const userId = req.user!.sub;
  const { projectId, key } = req.params;
  const body = req.body as z.infer<typeof setMemorySchema>;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const expiresAt = body.ttl_seconds
    ? new Date(Date.now() + body.ttl_seconds * 1000)
    : null;

  const [existing] = await db
    .select({ id: projectMemoryTable.id })
    .from(projectMemoryTable)
    .where(and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.key, key)))
    .limit(1);

  let entry;
  if (existing) {
    [entry] = await db
      .update(projectMemoryTable)
      .set({ value: body.value as any, scope: body.scope, expiresAt, updatedAt: new Date() })
      .where(eq(projectMemoryTable.id, existing.id))
      .returning();
  } else {
    [entry] = await db
      .insert(projectMemoryTable)
      .values({ id: generateId(), projectId, key, value: body.value as any, scope: body.scope, expiresAt })
      .returning();
  }

  res.json(fmtEntry(entry!));
});

// DELETE /memory/projects/:projectId/:key
router.delete("/projects/:projectId/:key", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId, key } = req.params;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const [deleted] = await db
    .delete(projectMemoryTable)
    .where(and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.key, key)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Memory key not found" }); return; }
  res.json({ message: "Memory entry deleted" });
});

// DELETE /memory/projects/:projectId — clear all memory for project
router.delete("/projects/:projectId", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId } = req.params;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  await db.delete(projectMemoryTable).where(eq(projectMemoryTable.projectId, projectId));
  res.json({ message: "Project memory cleared" });
});

export default router;
