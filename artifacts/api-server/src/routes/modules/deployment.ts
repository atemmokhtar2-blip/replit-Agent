/**
 * Deployment Module — Publish generated projects as accessible hosted sites
 *
 * A "deployment" is the act of publishing a generated project's preview URL
 * as a stable, named record so the user can share or return to it later.
 *
 * The generated project files already live on disk; this module creates DB
 * records that track each published project and exposes their preview URLs.
 *
 * Routes:
 *   POST   /               — deploy a generated project (by conversation_id)
 *   GET    /               — list all deployments for the current user
 *   GET    /:id            — get a single deployment record
 *   GET    /:id/logs       — return the build log for a deployment
 *   POST   /:id/cancel     — cancel a pending or building deployment
 *   POST   /:id/rollback   — not supported (returns 422)
 */

import { Router } from "express";
import { z } from "zod";
import { db, deploymentsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";
import { generateId } from "../../lib/auth.js";
import { PROJECT_FILES_BASE } from "../../lib/execution-engine.js";
import fs from "node:fs/promises";
import path from "node:path";

const router = Router();
router.use(authenticate);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseUrl(): string {
  // In Replit the dev domain is injected; fall back to a relative path token.
  const domain = process.env["REPLIT_DEV_DOMAIN"];
  return domain ? `https://${domain}` : "";
}

function previewUrl(conversationId: string): string {
  return `${baseUrl()}/api/v1/ai/projects/${conversationId}/preview`;
}

function fmtDeployment(d: typeof deploymentsTable.$inferSelect) {
  return {
    id:          d.id,
    status:      d.status,
    environment: d.environment,
    deploy_url:  d.deployUrl,
    started_at:  d.startedAt?.toISOString() ?? null,
    finished_at: d.finishedAt?.toISOString() ?? null,
    created_at:  d.createdAt.toISOString(),
    // conversationId is stored in buildLog as a JSON prefix for simplicity
    conversation_id: (() => {
      try { return (JSON.parse(d.buildLog ?? "{}") as Record<string, string>).conversationId ?? null; }
      catch { return null; }
    })(),
  };
}

// ─── POST / — Deploy a generated project ─────────────────────────────────────

const deploySchema = z.object({
  conversation_id: z.string().min(1),
  project_name:    z.string().optional(),
});

router.post("/", validateBody(deploySchema), async (req, res) => {
  const userId = req.user!.sub;
  const { conversation_id, project_name } = req.body as z.infer<typeof deploySchema>;

  // Sanitise the conversation ID the same way the preview route does
  const safeId = conversation_id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId) {
    res.status(400).json({ error: "Invalid conversation_id" });
    return;
  }

  // Verify the project directory exists and has at least one file
  const projectDir = path.join(PROJECT_FILES_BASE, safeId);
  let fileCount = 0;
  try {
    const entries = await fs.readdir(projectDir, { recursive: true });
    fileCount = entries.length;
  } catch {
    res.status(404).json({
      error: "No generated files found for this conversation. Run the execution pipeline first.",
    });
    return;
  }

  if (fileCount === 0) {
    res.status(422).json({
      error: "Project directory is empty. Run the execution pipeline to generate files first.",
    });
    return;
  }

  // Prefer dist/index.html (built React app) — fallback to raw files
  const deployedUrl = previewUrl(safeId);
  const hasDist = await fs.access(path.join(projectDir, "dist", "index.html"))
    .then(() => true).catch(() => false);

  const buildNote = hasDist
    ? `Built React/Vite project (dist/ present). ${fileCount} files.`
    : `Static project — no build step detected. ${fileCount} files.`;

  const now = new Date();
  const [deployment] = await db
    .insert(deploymentsTable)
    .values({
      id:          generateId(),
      triggeredBy: userId,
      status:      "deployed",
      environment: "production",
      deployUrl:   deployedUrl,
      buildLog:    JSON.stringify({
        conversationId: safeId,
        projectName:    project_name ?? safeId.slice(0, 12),
        note:           buildNote,
        deployedAt:     now.toISOString(),
      }),
      startedAt:   now,
      finishedAt:  now,
    })
    .returning();

  res.status(201).json({
    ...fmtDeployment(deployment!),
    message: hasDist
      ? "Project deployed. The preview URL serves your compiled React app."
      : "Project published. The preview URL serves your generated files.",
  });
});

// ─── GET / — List deployments for the current user ───────────────────────────

router.get("/", async (req, res) => {
  const userId = req.user!.sub;

  const rows = await db
    .select()
    .from(deploymentsTable)
    .where(eq(deploymentsTable.triggeredBy, userId))
    .orderBy(desc(deploymentsTable.createdAt))
    .limit(50);

  res.json({ deployments: rows.map(fmtDeployment) });
});

// ─── GET /:id — Single deployment ─────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [row] = await db
    .select()
    .from(deploymentsTable)
    .where(and(eq(deploymentsTable.id, id), eq(deploymentsTable.triggeredBy, userId)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Deployment not found" }); return; }
  res.json(fmtDeployment(row));
});

// ─── GET /:id/logs — Build log ────────────────────────────────────────────────

router.get("/:id/logs", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [row] = await db
    .select({ buildLog: deploymentsTable.buildLog })
    .from(deploymentsTable)
    .where(and(eq(deploymentsTable.id, id), eq(deploymentsTable.triggeredBy, userId)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Deployment not found" }); return; }

  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(row.buildLog ?? "{}") as Record<string, unknown>; } catch { /* ok */ }

  res.json({ logs: parsed });
});

// ─── POST /:id/cancel — Cancel a pending/building deployment ──────────────────

router.post("/:id/cancel", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [row] = await db
    .select()
    .from(deploymentsTable)
    .where(and(eq(deploymentsTable.id, id), eq(deploymentsTable.triggeredBy, userId)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Deployment not found" }); return; }
  if (!["pending", "building"].includes(row.status)) {
    res.status(422).json({ error: `Cannot cancel a deployment with status '${row.status}'` });
    return;
  }

  const [updated] = await db
    .update(deploymentsTable)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(eq(deploymentsTable.id, id))
    .returning();

  res.json(fmtDeployment(updated!));
});

// ─── POST /:id/rollback — Not supported ───────────────────────────────────────

router.post("/:id/rollback", (_req, res) => {
  res.status(422).json({
    error: "Rollback is not supported for static project deployments. Re-run the execution pipeline to regenerate the project.",
  });
});

export default router;
