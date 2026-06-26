/**
 * Secrets Center Routes
 *
 * GET    /                        — List secrets (optionally filtered by repo)
 * POST   /                        — Add a secret
 * PUT    /:id                     — Update a secret
 * DELETE /:id                     — Delete a secret
 * POST   /:id/verify              — Verify / mark secret as verified
 * GET    /env-example             — Generate .env.example
 * GET    /detected                — Get detected secrets from repo analysis
 */

import { Router } from "express";
import { z } from "zod";
import { db, repoSecretsTable, repoAnalysisResultsTable, repositoryImportsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { encrypt, decrypt } from "@workspace/github";
import { generateEnvExample } from "@workspace/repo-agent";
import type { SecretRequirement } from "@workspace/repo-agent";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";
import { generateId } from "../../lib/auth.js";
import { logger } from "../../lib/logger.js";

const router = Router();
router.use(authenticate);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSecretSchema = z.object({
  key: z.string().min(1).regex(/^[A-Z_][A-Z0-9_]*$/, "Key must be uppercase with underscores (e.g. DATABASE_URL)"),
  value: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(["github", "ai", "database", "storage", "payment", "email", "messaging", "deployment", "monitoring", "other"]).default("other"),
  is_required: z.boolean().default(false),
  usage_info: z.string().optional(),
  repository_import_id: z.string().optional(),
});

const updateSecretSchema = z.object({
  value: z.string().optional(),
  description: z.string().optional(),
  category: z.enum(["github", "ai", "database", "storage", "payment", "email", "messaging", "deployment", "monitoring", "other"]).optional(),
  is_required: z.boolean().optional(),
  usage_info: z.string().optional(),
});

// ─── GET / ────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const userId = req.user!.sub;
  const repoId = req.query["repository_import_id"] as string | undefined;

  const conditions = [eq(repoSecretsTable.userId, userId)];
  if (repoId) conditions.push(eq(repoSecretsTable.repositoryImportId, repoId));

  const secrets = await db.select()
    .from(repoSecretsTable)
    .where(and(...conditions))
    .orderBy(desc(repoSecretsTable.createdAt));

  res.json({ items: secrets.map(fmtSecret) });
});

// ─── POST / ───────────────────────────────────────────────────────────────────

router.post("/", validateBody(createSecretSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof createSecretSchema>;

  let encryptedValue: string | undefined;
  if (body.value) {
    try {
      encryptedValue = encrypt(body.value);
    } catch (err) {
      res.status(500).json({ error: "Failed to encrypt secret. Ensure ENCRYPTION_KEY is configured." });
      return;
    }
  }

  const [secret] = await db.insert(repoSecretsTable).values({
    id: generateId(),
    userId,
    repositoryImportId: body.repository_import_id,
    key: body.key,
    encryptedValue,
    description: body.description,
    category: body.category,
    isRequired: body.is_required,
    usageInfo: body.usage_info,
  }).returning();

  res.status(201).json({ secret: fmtSecret(secret!) });
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

router.put("/:id", validateBody(updateSecretSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };
  const body = req.body as z.infer<typeof updateSecretSchema>;

  const [existing] = await db.select({ id: repoSecretsTable.id })
    .from(repoSecretsTable)
    .where(and(eq(repoSecretsTable.id, id), eq(repoSecretsTable.userId, userId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }

  const updates: Partial<typeof repoSecretsTable.$inferInsert> = {};
  if (body.description !== undefined) updates.description = body.description;
  if (body.category !== undefined) updates.category = body.category;
  if (body.is_required !== undefined) updates.isRequired = body.is_required;
  if (body.usage_info !== undefined) updates.usageInfo = body.usage_info;

  if (body.value !== undefined) {
    try {
      updates.encryptedValue = encrypt(body.value);
      updates.isVerified = false;
      updates.lastVerifiedAt = undefined;
    } catch {
      res.status(500).json({ error: "Failed to encrypt secret" });
      return;
    }
  }

  const [updated] = await db.update(repoSecretsTable)
    .set(updates)
    .where(eq(repoSecretsTable.id, id))
    .returning();

  res.json({ secret: fmtSecret(updated!) });
});

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [existing] = await db.select({ id: repoSecretsTable.id })
    .from(repoSecretsTable)
    .where(and(eq(repoSecretsTable.id, id), eq(repoSecretsTable.userId, userId)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }

  await db.delete(repoSecretsTable).where(eq(repoSecretsTable.id, id));
  res.json({ deleted: true });
});

// ─── POST /:id/verify ─────────────────────────────────────────────────────────

router.post("/:id/verify", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [secret] = await db.select()
    .from(repoSecretsTable)
    .where(and(eq(repoSecretsTable.id, id), eq(repoSecretsTable.userId, userId)))
    .limit(1);

  if (!secret) {
    res.status(404).json({ error: "Secret not found" });
    return;
  }

  if (!secret.encryptedValue) {
    res.status(400).json({ error: "Secret has no value set. Please add a value first." });
    return;
  }

  let plainValue: string;
  try {
    plainValue = decrypt(secret.encryptedValue);
  } catch {
    res.status(500).json({ error: "Failed to decrypt secret for verification" });
    return;
  }

  // Basic verification: check the value is non-empty and looks like a valid credential
  const isNonEmpty = plainValue.trim().length > 0;
  const seemsValid = isNonEmpty && plainValue.length >= 8;

  await db.update(repoSecretsTable).set({
    isVerified: seemsValid,
    lastVerifiedAt: seemsValid ? new Date() : undefined,
  }).where(eq(repoSecretsTable.id, id));

  res.json({
    verified: seemsValid,
    key: secret.key,
    last_verified_at: seemsValid ? new Date().toISOString() : null,
    message: seemsValid ? "Secret value is set and appears valid" : "Secret value appears to be empty or too short",
  });
});

// ─── GET /env-example ─────────────────────────────────────────────────────────

router.get("/env-example", async (req, res) => {
  const userId = req.user!.sub;
  const repoId = req.query["repository_import_id"] as string | undefined;

  const conditions = [eq(repoSecretsTable.userId, userId)];
  if (repoId) conditions.push(eq(repoSecretsTable.repositoryImportId, repoId));

  const secrets = await db.select()
    .from(repoSecretsTable)
    .where(and(...conditions));

  const requirements: SecretRequirement[] = secrets.map((s) => ({
    key: s.key,
    description: s.description ?? s.key,
    category: s.category as SecretRequirement["category"],
    isRequired: s.isRequired,
    reason: s.usageInfo ?? "",
    exampleValue: "",
  }));

  // Also include detected secrets from repo analysis if repoId provided
  if (repoId) {
    const [analysis] = await db.select()
      .from(repoAnalysisResultsTable)
      .where(eq(repoAnalysisResultsTable.repositoryImportId, repoId))
      .limit(1);

    if (analysis?.detectedSecrets) {
      const detectedKeys = new Set(requirements.map((r) => r.key));
      const detected = analysis.detectedSecrets as unknown as SecretRequirement[];
      for (const d of detected) {
        if (!detectedKeys.has(d.key)) {
          requirements.push(d);
        }
      }
    }
  }

  const content = generateEnvExample(requirements);

  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", "attachment; filename=.env.example");
  res.send(content);
});

// ─── GET /detected ────────────────────────────────────────────────────────────

router.get("/detected", async (req, res) => {
  const userId = req.user!.sub;
  const repoId = req.query["repository_import_id"] as string | undefined;

  if (!repoId) {
    res.status(400).json({ error: "repository_import_id is required" });
    return;
  }

  // Verify ownership
  const [repo] = await db.select({ id: repositoryImportsTable.id })
    .from(repositoryImportsTable)
    .where(and(eq(repositoryImportsTable.id, repoId), eq(repositoryImportsTable.userId, userId)))
    .limit(1);

  if (!repo) {
    res.status(404).json({ error: "Repository not found" });
    return;
  }

  const [analysis] = await db.select({ detectedSecrets: repoAnalysisResultsTable.detectedSecrets })
    .from(repoAnalysisResultsTable)
    .where(eq(repoAnalysisResultsTable.repositoryImportId, repoId))
    .limit(1);

  res.json({ detected: analysis?.detectedSecrets ?? [] });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSecret(s: typeof repoSecretsTable.$inferSelect) {
  return {
    id: s.id,
    key: s.key,
    has_value: s.encryptedValue != null,
    description: s.description,
    category: s.category,
    is_required: s.isRequired,
    is_verified: s.isVerified,
    last_verified_at: s.lastVerifiedAt?.toISOString() ?? null,
    usage_info: s.usageInfo,
    repository_import_id: s.repositoryImportId,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

export default router;
