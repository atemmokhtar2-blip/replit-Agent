/**
 * AI Module — Conversations, Messages, and Provider Management
 *
 * Provider-agnostic. No vendor lock-in.
 * Routes messages through whichever provider the user has configured.
 * If no provider is active, a helpful placeholder response is returned.
 */

import { Router } from "express";
import { z } from "zod";
import {
  db,
  aiConversationsTable,
  aiMessagesTable,
  providerConfigsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { registry } from "@workspace/ai-provider";
import type { ProviderConfig } from "@workspace/ai-provider";
import { generateId } from "../../lib/auth.js";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";

const router = Router();
router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtConversation(c: typeof aiConversationsTable.$inferSelect) {
  return {
    id: c.id,
    project_id: c.projectId,
    user_id: c.userId,
    title: c.title,
    status: c.status,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

function fmtMessage(m: typeof aiMessagesTable.$inferSelect) {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    role: m.role,
    content: m.content,
    metadata: m.metadata,
    created_at: m.createdAt.toISOString(),
  };
}

async function getActiveProvider(
  userId: string
): Promise<{ config: ProviderConfig } | null> {
  const [row] = await db
    .select()
    .from(providerConfigsTable)
    .where(
      and(
        eq(providerConfigsTable.userId, userId),
        eq(providerConfigsTable.isActive, true)
      )
    )
    .limit(1);

  if (!row) return null;
  return {
    config: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      apiKey: row.apiKey,
      baseUrl: row.baseUrl,
      defaultModel: row.defaultModel,
      isActive: row.isActive,
      config: row.config as Record<string, unknown> | null,
    },
  };
}

// ─── Conversations ─────────────────────────────────────────────────────────────

// GET /ai/conversations
router.get("/conversations", async (req, res) => {
  const userId = req.user!.sub;
  const projectId = req.query["project_id"] as string | undefined;
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const perPage = Math.min(50, Math.max(1, Number(req.query["per_page"] ?? 20)));
  const offset = (page - 1) * perPage;

  const conditions = [eq(aiConversationsTable.userId, userId)];
  if (projectId) conditions.push(eq(aiConversationsTable.projectId, projectId));
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(aiConversationsTable)
      .where(where)
      .orderBy(desc(aiConversationsTable.updatedAt))
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiConversationsTable)
      .where(where),
  ]);

  res.json({ items: rows.map(fmtConversation), total: count, page, per_page: perPage });
});

// POST /ai/conversations
const createConversationSchema = z.object({
  title: z.string().max(200).optional(),
  project_id: z.string().optional(),
});

router.post("/conversations", validateBody(createConversationSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { title, project_id } = req.body as z.infer<typeof createConversationSchema>;

  const [row] = await db
    .insert(aiConversationsTable)
    .values({
      id: generateId(),
      userId,
      projectId: project_id ?? null,
      title: title ?? "New conversation",
      status: "active",
    })
    .returning();

  res.status(201).json(fmtConversation(row!));
});

// GET /ai/conversations/:id
router.get("/conversations/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [conversation] = await db
    .select()
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, id), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  const messages = await db
    .select()
    .from(aiMessagesTable)
    .where(eq(aiMessagesTable.conversationId, id))
    .orderBy(aiMessagesTable.createdAt);

  res.json({ ...fmtConversation(conversation), messages: messages.map(fmtMessage) });
});

// PATCH /ai/conversations/:id  (rename)
const renameConversationSchema = z.object({
  title: z.string().min(1).max(200),
});

router.patch("/conversations/:id", validateBody(renameConversationSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;
  const { title } = req.body as z.infer<typeof renameConversationSchema>;

  const [updated] = await db
    .update(aiConversationsTable)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(aiConversationsTable.id, id), eq(aiConversationsTable.userId, userId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.json(fmtConversation(updated));
});

// DELETE /ai/conversations/:id
router.delete("/conversations/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [deleted] = await db
    .delete(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, id), eq(aiConversationsTable.userId, userId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.json({ message: "Conversation deleted" });
});

// ─── Messages ─────────────────────────────────────────────────────────────────

// GET /ai/conversations/:id/messages
router.get("/conversations/:id/messages", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [conversation] = await db
    .select()
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, id), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  const messages = await db
    .select()
    .from(aiMessagesTable)
    .where(eq(aiMessagesTable.conversationId, id))
    .orderBy(aiMessagesTable.createdAt);

  res.json({ items: messages.map(fmtMessage), total: messages.length });
});

// POST /ai/conversations/:id/messages
const sendMessageSchema = z.object({
  content: z.string().min(1).max(32000),
  model: z.string().optional(),
});

router.post("/conversations/:id/messages", validateBody(sendMessageSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;
  const { content, model } = req.body as z.infer<typeof sendMessageSchema>;

  const [conversation] = await db
    .select()
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, id), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

  // 1. Persist user message
  const [userMsg] = await db
    .insert(aiMessagesTable)
    .values({ id: generateId(), conversationId: id, role: "user", content })
    .returning();

  // 2. Load full conversation history for context
  const history = await db
    .select()
    .from(aiMessagesTable)
    .where(eq(aiMessagesTable.conversationId, id))
    .orderBy(aiMessagesTable.createdAt);

  // 3. Route through active provider (or return helpful placeholder)
  const active = await getActiveProvider(userId);
  let assistantContent: string;
  let responseModel: string | undefined;

  if (!active) {
    assistantContent =
      "No AI provider is configured yet. Go to **Settings → AI Providers** to connect one of the supported free providers:\n\n" +
      "- **HuggingFace** — free public models, no API key required for many\n" +
      "- **OpenRouter** — 50+ free models with a free API key at openrouter.ai\n" +
      "- **DeepSeek** — free credits on sign-up at platform.deepseek.com\n" +
      "- **Local (Ollama)** — run models on your own machine, completely free\n" +
      "- **Custom endpoint** — any OpenAI-compatible server";
  } else {
    const provider = registry.get(active.config.slug);
    if (!provider) {
      assistantContent = `Provider "${active.config.slug}" is not registered. Please check your provider configuration.`;
    } else {
      try {
        const messages = history.slice(0, -1).map((m) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }));
        messages.push({ role: "user", content });
        const response = await provider.chat({ messages, model: model ?? undefined }, active.config);
        assistantContent = response.content;
        responseModel = response.model;
      } catch (err) {
        assistantContent = `Error from provider: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  // 4. Persist assistant reply
  const [assistantMsg] = await db
    .insert(aiMessagesTable)
    .values({
      id: generateId(),
      conversationId: id,
      role: "assistant",
      content: assistantContent,
      metadata: responseModel ? { model: responseModel } : null,
    })
    .returning();

  // 5. Bump conversation updatedAt
  await db
    .update(aiConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversationsTable.id, id));

  res.status(201).json({
    user_message: fmtMessage(userMsg!),
    assistant_message: fmtMessage(assistantMsg!),
  });
});

// ─── Provider Management ───────────────────────────────────────────────────────

// GET /ai/providers/available — built-in provider definitions (no auth needed for listing)
router.get("/providers/available", (_req, res) => {
  res.json(
    registry.list().map((e) => ({
      slug: e.meta.slug,
      name: e.meta.name,
      description: e.meta.description,
      capabilities: e.meta.capabilities,
      default_base_url: e.meta.defaultBaseUrl ?? null,
      default_model: e.meta.defaultModel ?? null,
      free_tier_note: e.meta.freeTierNote ?? null,
    }))
  );
});

// GET /ai/providers — user's configured providers
router.get("/providers", async (req, res) => {
  const userId = req.user!.sub;
  const rows = await db
    .select()
    .from(providerConfigsTable)
    .where(eq(providerConfigsTable.userId, userId))
    .orderBy(desc(providerConfigsTable.createdAt));

  res.json(
    rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      base_url: r.baseUrl,
      default_model: r.defaultModel,
      is_active: r.isActive,
      has_api_key: !!r.apiKey,
      config: r.config,
      created_at: r.createdAt.toISOString(),
      updated_at: r.updatedAt.toISOString(),
    }))
  );
});

// POST /ai/providers
const createProviderSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(100),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

router.post("/providers", validateBody(createProviderSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof createProviderSchema>;

  const [row] = await db
    .insert(providerConfigsTable)
    .values({
      id: generateId(),
      userId,
      slug: body.slug,
      name: body.name,
      apiKey: body.api_key ?? null,
      baseUrl: body.base_url || null,
      defaultModel: body.default_model ?? null,
      isActive: false,
      config: body.config ?? null,
    })
    .returning();

  res.status(201).json({
    id: row!.id, slug: row!.slug, name: row!.name, base_url: row!.baseUrl,
    default_model: row!.defaultModel, is_active: row!.isActive,
    has_api_key: !!row!.apiKey, config: row!.config,
    created_at: row!.createdAt.toISOString(), updated_at: row!.updatedAt.toISOString(),
  });
});

// PATCH /ai/providers/:id
const updateProviderSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  default_model: z.string().optional(),
  config: z.record(z.unknown()).optional(),
});

router.patch("/providers/:id", validateBody(updateProviderSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;
  const body = req.body as z.infer<typeof updateProviderSchema>;

  const update: Partial<typeof providerConfigsTable.$inferInsert> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.api_key !== undefined) update.apiKey = body.api_key;
  if (body.base_url !== undefined) update.baseUrl = body.base_url || null;
  if (body.default_model !== undefined) update.defaultModel = body.default_model;
  if (body.config !== undefined) update.config = body.config;

  const [row] = await db
    .update(providerConfigsTable)
    .set(update)
    .where(and(eq(providerConfigsTable.id, id), eq(providerConfigsTable.userId, userId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Provider not found" }); return; }

  res.json({
    id: row.id, slug: row.slug, name: row.name, base_url: row.baseUrl,
    default_model: row.defaultModel, is_active: row.isActive,
    has_api_key: !!row.apiKey, config: row.config,
    created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
  });
});

// DELETE /ai/providers/:id
router.delete("/providers/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [deleted] = await db
    .delete(providerConfigsTable)
    .where(and(eq(providerConfigsTable.id, id), eq(providerConfigsTable.userId, userId)))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Provider not found" }); return; }
  res.json({ message: "Provider deleted" });
});

// POST /ai/providers/:id/activate
router.post("/providers/:id/activate", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [target] = await db
    .select()
    .from(providerConfigsTable)
    .where(and(eq(providerConfigsTable.id, id), eq(providerConfigsTable.userId, userId)))
    .limit(1);

  if (!target) { res.status(404).json({ error: "Provider not found" }); return; }

  await db.update(providerConfigsTable).set({ isActive: false }).where(eq(providerConfigsTable.userId, userId));
  const [row] = await db
    .update(providerConfigsTable)
    .set({ isActive: true })
    .where(eq(providerConfigsTable.id, id))
    .returning();

  res.json({ id: row!.id, slug: row!.slug, name: row!.name, is_active: row!.isActive, message: `${row!.name} is now the active provider` });
});

// POST /ai/providers/:id/test
router.post("/providers/:id/test", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [row] = await db
    .select()
    .from(providerConfigsTable)
    .where(and(eq(providerConfigsTable.id, id), eq(providerConfigsTable.userId, userId)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Provider not found" }); return; }

  const provider = registry.get(row.slug);
  if (!provider) { res.status(400).json({ error: `Unknown provider slug: ${row.slug}` }); return; }

  const result = await provider.testConnection({
    id: row.id, slug: row.slug, name: row.name, apiKey: row.apiKey,
    baseUrl: row.baseUrl, defaultModel: row.defaultModel, isActive: row.isActive,
    config: row.config as Record<string, unknown> | null,
  });

  res.json(result);
});

// GET /ai/providers/:id/models
router.get("/providers/:id/models", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as Record<string, string>;

  const [row] = await db
    .select()
    .from(providerConfigsTable)
    .where(and(eq(providerConfigsTable.id, id), eq(providerConfigsTable.userId, userId)))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Provider not found" }); return; }

  const provider = registry.get(row.slug);
  if (!provider) { res.status(400).json({ error: `Unknown provider slug: ${row.slug}` }); return; }

  const models = await provider.listModels({
    id: row.id, slug: row.slug, name: row.name, apiKey: row.apiKey,
    baseUrl: row.baseUrl, defaultModel: row.defaultModel, isActive: row.isActive,
    config: row.config as Record<string, unknown> | null,
  });

  res.json({ items: models });
});

export default router;
