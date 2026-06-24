/**
 * Storage Module — Project File Management
 *
 * Stores file content directly in the database (Phase 2).
 * Supports create, read, update, delete for project files.
 * Content stored as text; binary support via base64 in a future phase.
 */

import { Router } from "express";
import { z } from "zod";
import { db, projectFilesTable, projectsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { generateId } from "../../lib/auth.js";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";

const router = Router();
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtFile(f: typeof projectFilesTable.$inferSelect) {
  return {
    id: f.id,
    project_id: f.projectId,
    path: f.path,
    content: f.content,
    mime_type: f.mimeType,
    size: f.size,
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

async function assertProjectOwner(projectId: string, userId: string, res: ReturnType<typeof Router>['response'] | any): Promise<boolean> {
  const [project] = await db
    .select({ userId: projectsTable.userId })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return false;
  }
  if (project.userId !== userId) {
    res.status(403).json({ error: "Access denied" });
    return false;
  }
  return true;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /storage/projects/:projectId/files
router.get("/projects/:projectId/files", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId } = req.params;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const files = await db
    .select()
    .from(projectFilesTable)
    .where(eq(projectFilesTable.projectId, projectId))
    .orderBy(projectFilesTable.path);

  res.json({ items: files.map(fmtFile), total: files.length });
});

// POST /storage/projects/:projectId/files
const createFileSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().optional(),
  mime_type: z.string().optional(),
});

router.post("/projects/:projectId/files", validateBody(createFileSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { projectId } = req.params;
  const body = req.body as z.infer<typeof createFileSchema>;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const content = body.content ?? "";
  const [file] = await db
    .insert(projectFilesTable)
    .values({
      id: generateId(),
      projectId,
      path: body.path,
      content,
      mimeType: body.mime_type ?? "text/plain",
      size: Buffer.byteLength(content, "utf8"),
    })
    .returning();

  res.status(201).json(fmtFile(file!));
});

// GET /storage/projects/:projectId/files/:fileId
router.get("/projects/:projectId/files/:fileId", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId, fileId } = req.params;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const [file] = await db
    .select()
    .from(projectFilesTable)
    .where(and(eq(projectFilesTable.id, fileId), eq(projectFilesTable.projectId, projectId)))
    .limit(1);

  if (!file) { res.status(404).json({ error: "File not found" }); return; }
  res.json(fmtFile(file));
});

// PUT /storage/projects/:projectId/files/:fileId
const updateFileSchema = z.object({
  path: z.string().min(1).max(500).optional(),
  content: z.string().optional(),
  mime_type: z.string().optional(),
});

router.put("/projects/:projectId/files/:fileId", validateBody(updateFileSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { projectId, fileId } = req.params;
  const body = req.body as z.infer<typeof updateFileSchema>;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const update: Partial<typeof projectFilesTable.$inferInsert> = {};
  if (body.path !== undefined) update.path = body.path;
  if (body.mime_type !== undefined) update.mimeType = body.mime_type;
  if (body.content !== undefined) {
    update.content = body.content;
    update.size = Buffer.byteLength(body.content, "utf8");
  }

  const [file] = await db
    .update(projectFilesTable)
    .set(update)
    .where(and(eq(projectFilesTable.id, fileId), eq(projectFilesTable.projectId, projectId)))
    .returning();

  if (!file) { res.status(404).json({ error: "File not found" }); return; }
  res.json(fmtFile(file));
});

// DELETE /storage/projects/:projectId/files/:fileId
router.delete("/projects/:projectId/files/:fileId", async (req, res) => {
  const userId = req.user!.sub;
  const { projectId, fileId } = req.params;

  if (!(await assertProjectOwner(projectId, userId, res))) return;

  const [deleted] = await db
    .delete(projectFilesTable)
    .where(and(eq(projectFilesTable.id, fileId), eq(projectFilesTable.projectId, projectId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "File not found" }); return; }
  res.json({ message: "File deleted" });
});

export default router;
