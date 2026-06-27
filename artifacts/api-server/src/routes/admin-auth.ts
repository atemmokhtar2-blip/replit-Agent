/**
 * Admin — OAuth Provider Configuration
 *
 * Allows admins to configure, test, and toggle OAuth providers (Google, etc.)
 * Client secrets are encrypted with AES-256-GCM before storage.
 */

import { Router } from "express";
import { z } from "zod";
import { db, oauthProviderConfigsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authenticate } from "../middlewares/authenticate";
import { requireRole } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";
import { encryptKey, decryptKey } from "../lib/provider-manager/key-vault";
import { generateId } from "../lib/auth";
import { oauthRegistry } from "../lib/oauth/registry";

const router = Router();
router.use(authenticate, requireRole("admin"));

const SUPPORTED_PROVIDERS = ["google"] as const;

function sanitizeConfig(row: typeof oauthProviderConfigsTable.$inferSelect) {
  return {
    provider: row.provider,
    client_id: row.clientId ?? null,
    has_client_secret: !!row.clientSecretEncrypted,
    redirect_uri: row.redirectUri ?? null,
    is_enabled: row.isEnabled,
    updated_at: row.updatedAt.toISOString(),
  };
}

// ─── GET /admin/auth/providers ──────────────────────────────────────────────

router.get("/providers", async (_req, res) => {
  const rows = await db.select().from(oauthProviderConfigsTable);
  const configured = new Map(rows.map((r) => [r.provider, r]));

  const result = SUPPORTED_PROVIDERS.map((p) => {
    const row = configured.get(p);
    if (!row) {
      return {
        provider: p,
        client_id: null,
        has_client_secret: false,
        redirect_uri: null,
        is_enabled: false,
        updated_at: null,
      };
    }
    return sanitizeConfig(row);
  });

  res.json({ providers: result });
});

// ─── GET /admin/auth/providers/:provider ────────────────────────────────────

router.get("/providers/:provider", async (req, res) => {
  const { provider } = req.params as { provider: string };

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }

  const [row] = await db
    .select()
    .from(oauthProviderConfigsTable)
    .where(eq(oauthProviderConfigsTable.provider, provider))
    .limit(1);

  if (!row) {
    res.json({
      provider,
      client_id: null,
      has_client_secret: false,
      redirect_uri: null,
      is_enabled: false,
      updated_at: null,
    });
    return;
  }

  res.json(sanitizeConfig(row));
});

// ─── PUT /admin/auth/providers/:provider ────────────────────────────────────

const upsertProviderSchema = z.object({
  client_id: z.string().min(1).optional(),
  client_secret: z.string().min(1).optional(),
  redirect_uri: z.string().url().optional(),
  is_enabled: z.boolean().optional(),
});

router.put("/providers/:provider", validateBody(upsertProviderSchema), async (req, res) => {
  const { provider } = req.params as { provider: string };
  const data = req.body as z.infer<typeof upsertProviderSchema>;

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }

  const [existing] = await db
    .select()
    .from(oauthProviderConfigsTable)
    .where(eq(oauthProviderConfigsTable.provider, provider))
    .limit(1);

  const secretEncrypted =
    data.client_secret ? encryptKey(data.client_secret) : existing?.clientSecretEncrypted ?? null;

  if (existing) {
    const [updated] = await db
      .update(oauthProviderConfigsTable)
      .set({
        clientId: data.client_id ?? existing.clientId,
        clientSecretEncrypted: secretEncrypted,
        redirectUri: data.redirect_uri ?? existing.redirectUri,
        isEnabled: data.is_enabled ?? existing.isEnabled,
        updatedAt: new Date(),
      })
      .where(eq(oauthProviderConfigsTable.provider, provider))
      .returning();
    res.json({ ...sanitizeConfig(updated!), message: "Configuration saved" });
  } else {
    const [created] = await db
      .insert(oauthProviderConfigsTable)
      .values({
        id: generateId(),
        provider,
        clientId: data.client_id ?? null,
        clientSecretEncrypted: secretEncrypted,
        redirectUri: data.redirect_uri ?? null,
        isEnabled: data.is_enabled ?? false,
      })
      .returning();
    res.status(201).json({ ...sanitizeConfig(created!), message: "Configuration saved" });
  }
});

// ─── POST /admin/auth/providers/:provider/test ──────────────────────────────

router.post("/providers/:provider/test", async (req, res) => {
  const { provider } = req.params as { provider: string };

  if (!(SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    res.status(400).json({ error: `Unknown provider: ${provider}` });
    return;
  }

  const [row] = await db
    .select()
    .from(oauthProviderConfigsTable)
    .where(eq(oauthProviderConfigsTable.provider, provider))
    .limit(1);

  if (!row?.clientId || !row.clientSecretEncrypted || !row.redirectUri) {
    res.status(400).json({ ok: false, message: "Provider is not fully configured" });
    return;
  }

  if (provider === "google") {
    try {
      const clientSecret = decryptKey(row.clientSecretEncrypted);
      if (!clientSecret) throw new Error("Failed to decrypt client secret");

      const googleClientIdPattern = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/;
      if (!googleClientIdPattern.test(row.clientId)) {
        res.json({ ok: false, message: "Client ID format is invalid. Expected: <numbers>-<alphanumeric>.apps.googleusercontent.com" });
        return;
      }

      const start = Date.now();
      const discRes = await fetch("https://accounts.google.com/.well-known/openid-configuration", {
        signal: AbortSignal.timeout(10_000),
      });

      if (!discRes.ok) {
        res.json({ ok: false, message: `Cannot reach Google OAuth servers (HTTP ${discRes.status})` });
        return;
      }

      const latencyMs = Date.now() - start;

      if (!oauthRegistry.has(provider)) {
        res.json({ ok: false, message: "Provider not registered in registry" });
        return;
      }

      res.json({
        ok: true,
        message: `Google OAuth reachable in ${latencyMs}ms. Client ID format is valid.`,
        latency_ms: latencyMs,
      });
    } catch (err) {
      res.json({ ok: false, message: (err as Error).message });
    }
    return;
  }

  res.json({ ok: false, message: `Test not implemented for provider: ${provider}` });
});

export default router;
