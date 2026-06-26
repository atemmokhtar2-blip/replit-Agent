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
  repositoryImportsTable,
  repoAnalysisResultsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { registry } from "@workspace/ai-provider";
import type { ProviderConfig } from "@workspace/ai-provider";
import { aiRouter, modelRegistry, TASK_TYPES, runPlanner, runPlannerStream } from "@workspace/ai-orchestrator";
import type { PlannerStreamEvent } from "@workspace/ai-orchestrator";
import { generateId } from "../../lib/auth.js";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";
import { runExecutionPipeline, PROJECT_FILES_BASE } from "../../lib/execution-engine.js";
import fs from "node:fs/promises";
import path from "node:path";

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

  // 3. Route through the AI orchestrator (or return helpful placeholder)
  const active = await getActiveProvider(userId);
  let assistantContent: string;
  let responseModel: string | undefined;
  let routingMetadata: Record<string, unknown> | null = null;

  if (!active) {
    assistantContent =
      "No AI provider is configured yet. Go to **Settings → AI Providers** to connect one of the supported providers:\n\n" +
      "- **OpenRouter** — 200+ models, many free, get a free API key at openrouter.ai\n" +
      "- **DeepSeek** — free credits on sign-up at platform.deepseek.com\n" +
      "- **Local (Ollama)** — run models on your own machine, completely free\n" +
      "- **Custom endpoint** — any OpenAI-compatible server";
  } else {
    try {
      const chatMessages = history.slice(0, -1).map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      }));
      chatMessages.push({ role: "user", content });

      const orchestration = aiRouter.route({
        messages: chatMessages,
        userProviderConfig: active.config,
        requestedModel: model ?? undefined,
      });

      const response = await orchestration.provider.chat(
        { messages: chatMessages },
        orchestration.resolvedConfig,
      );

      assistantContent = response.content;
      responseModel = response.model ?? orchestration.decision.selectedModelId;
      routingMetadata = {
        taskType: orchestration.decision.taskType,
        rationale: orchestration.decision.rationale,
        fallback: orchestration.decision.fallback,
        registryEntryId: orchestration.decision.selectedRegistryEntryId,
        confidence: orchestration.decision.classification.confidence,
        signals: orchestration.decision.classification.signals,
      };
    } catch (err) {
      assistantContent = `Error from provider: ${err instanceof Error ? err.message : String(err)}`;
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
      metadata: responseModel || routingMetadata
        ? { model: responseModel ?? null, routing: routingMetadata }
        : null,
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

// ─── Planner Engine ───────────────────────────────────────────────────────────

const plannerSchema = z.object({
  message: z.string().min(1).max(32000),
  conversation_id: z.string().optional(),
  repository_id: z.string().optional(),
});

// POST /ai/planner
router.post("/planner", validateBody(plannerSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { message, conversation_id } = req.body as z.infer<typeof plannerSchema>;

  // Resolve or create conversation
  let conversationId = conversation_id;
  if (!conversationId) {
    const [conv] = await db
      .insert(aiConversationsTable)
      .values({ id: generateId(), userId, title: "New conversation", status: "active" })
      .returning();
    conversationId = conv!.id;
  } else {
    const [existing] = await db
      .select({ id: aiConversationsTable.id })
      .from(aiConversationsTable)
      .where(and(eq(aiConversationsTable.id, conversationId), eq(aiConversationsTable.userId, userId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "Conversation not found" }); return; }
  }

  // Persist user message
  const [userMsg] = await db
    .insert(aiMessagesTable)
    .values({ id: generateId(), conversationId, role: "user", content: message })
    .returning();

  // Load recent history for context (excluding the message we just inserted)
  const rawHistory = await db
    .select()
    .from(aiMessagesTable)
    .where(eq(aiMessagesTable.conversationId, conversationId))
    .orderBy(aiMessagesTable.createdAt);

  const historyForPlanner = rawHistory
    .slice(0, -1)
    .map((m) => ({ role: m.role, content: m.content }));

  // Run planner engine — never throws; errors returned as friendly content
  const result = await runPlanner(message, historyForPlanner);

  // Persist planner response
  const [assistantMsg] = await db
    .insert(aiMessagesTable)
    .values({
      id: generateId(),
      conversationId,
      role: "assistant",
      content: result.content,
      metadata: {
        module: "planner",
        model: result.model ?? null,
        error: result.error ?? null,
      },
    })
    .returning();

  // Bump conversation updatedAt
  await db
    .update(aiConversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversationsTable.id, conversationId));

  res.status(201).json({
    success: true,
    plan: result.content,
    conversation_id: conversationId,
    user_message: fmtMessage(userMsg!),
    assistant_message: fmtMessage(assistantMsg!),
  });
});

// POST /ai/planner/stream — Server-Sent Events streaming endpoint
// Every event emitted here corresponds to real execution inside runPlannerStream.
// No fake timers. No artificial delays. Stages advance as actual work completes.
router.post("/planner/stream", validateBody(plannerSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { message, conversation_id, repository_id } = req.body as z.infer<typeof plannerSchema>;

  // Set SSE headers before any async work so the client gets the stream ASAP
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (data: PlannerStreamEvent | { type: string; [k: string]: unknown }) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  // Track client disconnect — abort the OpenRouter fetch if the browser closes.
  // IMPORTANT: use res.on("close") NOT req.on("close") — for POST requests,
  // req emits "close" when the request body is fully consumed (immediately after
  // body parsing), which would pre-abort the signal before any LLM call.
  // res.on("close") only fires when the response connection is terminated.
  let aborted = false;
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      // Connection was terminated before the response finished — genuine disconnect
      aborted = true;
      abortController.abort();
    }
  });

  try {
    // ── Resolve or create conversation ──────────────────────────────────────
    let conversationId = conversation_id;
    if (!conversationId) {
      const [conv] = await db
        .insert(aiConversationsTable)
        .values({ id: generateId(), userId, title: "New conversation", status: "active" })
        .returning();
      conversationId = conv!.id;
    } else {
      const [existing] = await db
        .select({ id: aiConversationsTable.id })
        .from(aiConversationsTable)
        .where(and(eq(aiConversationsTable.id, conversationId), eq(aiConversationsTable.userId, userId)))
        .limit(1);
      if (!existing) {
        sendEvent({ type: "error", message: "Conversation not found" });
        res.end();
        return;
      }
    }

    // ── Persist user message ────────────────────────────────────────────────
    const [userMsg] = await db
      .insert(aiMessagesTable)
      .values({ id: generateId(), conversationId, role: "user", content: message })
      .returning();

    // ── Load recent history (excluding message just inserted) ───────────────
    const rawHistory = await db
      .select()
      .from(aiMessagesTable)
      .where(eq(aiMessagesTable.conversationId, conversationId))
      .orderBy(aiMessagesTable.createdAt);

    const historyForPlanner = rawHistory
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    // ── Inject repository context if provided ───────────────────────────────
    let effectiveMessage = message;
    if (repository_id) {
      const [repo] = await db
        .select()
        .from(repositoryImportsTable)
        .where(and(eq(repositoryImportsTable.id, repository_id), eq(repositoryImportsTable.userId, userId)))
        .limit(1);
      if (repo) {
        const [analysis] = await db
          .select()
          .from(repoAnalysisResultsTable)
          .where(eq(repoAnalysisResultsTable.repositoryImportId, repository_id))
          .limit(1);
        const lines: string[] = [`## Repository Context: ${repo.fullName}`];
        if (analysis?.language) lines.push(`- Language: ${analysis.language}`);
        if (analysis?.framework) lines.push(`- Framework: ${analysis.framework}`);
        if (analysis?.packageManager) lines.push(`- Package Manager: ${analysis.packageManager}`);
        if (analysis?.buildSystem) lines.push(`- Build System: ${analysis.buildSystem}`);
        if (analysis?.hasDatabase) lines.push(`- Has Database: yes`);
        if (analysis?.hasDocker) lines.push(`- Has Docker: yes`);
        if (analysis?.hasCI) lines.push(`- Has CI: yes`);

        // Detected components
        const comps = analysis?.components as { name?: string }[] | null;
        if (Array.isArray(comps) && comps.length > 0) {
          const names = comps.slice(0, 8).map((c) => c.name).filter(Boolean);
          if (names.length > 0) lines.push(`- Key Components: ${names.join(", ")}`);
        }

        // Detected routes
        const routeList = analysis?.routes as { path?: string; method?: string }[] | null;
        if (Array.isArray(routeList) && routeList.length > 0) {
          const paths = routeList.slice(0, 8)
            .map((r) => (r.method ? `${r.method} ${r.path}` : r.path))
            .filter(Boolean);
          if (paths.length > 0) lines.push(`- API Routes: ${paths.join(", ")}`);
        }

        // Detected dependencies (top-level package names)
        const deps = analysis?.dependencies as Record<string, string> | null;
        if (deps && typeof deps === "object") {
          const names = Object.keys(deps).slice(0, 12);
          if (names.length > 0) lines.push(`- Dependencies: ${names.join(", ")}`);
        }

        effectiveMessage = `${lines.join("\n")}\n\n---\n\n${message}`;
      }
    }

    // ── Run streaming planner ───────────────────────────────────────────────
    let finalContent = "";
    let finalModel = "";
    let isConversation = false;

    await runPlannerStream(
      effectiveMessage,
      historyForPlanner,
      (event) => {
        if (aborted) return;
        // Intercept done/conversation to capture content for DB persistence
        if (event.type === "done") {
          finalContent = event.content;
          finalModel = event.model;
        } else if (event.type === "conversation") {
          finalContent = event.content;
          isConversation = true;
        }
        sendEvent(event);
      },
      abortController.signal,
    );

    if (aborted) return;

    // ── Persist assistant reply ─────────────────────────────────────────────
    if (finalContent) {
      const [assistantMsg] = await db
        .insert(aiMessagesTable)
        .values({
          id: generateId(),
          conversationId,
          role: "assistant",
          content: finalContent,
          metadata: isConversation
            ? { module: "planner-conversation" }
            : { module: "planner", model: finalModel || null },
        })
        .returning();

      // Bump conversation updatedAt
      await db
        .update(aiConversationsTable)
        .set({ updatedAt: new Date() })
        .where(eq(aiConversationsTable.id, conversationId));

      // Send enriched final event so the client has IDs for cache invalidation
      if (!res.writableEnded) {
        if (isConversation) {
          res.write(`data: ${JSON.stringify({
            type: "conversation",
            content: finalContent,
            conversationId,
            messageId: assistantMsg!.id,
          })}\n\n`);
        } else {
          // Stage 8 complete
          res.write(`data: ${JSON.stringify({ type: "stage_complete", stage: 8 })}\n\n`);
          res.write(`data: ${JSON.stringify({
            type: "done",
            content: finalContent,
            model: finalModel,
            conversationId,
            messageId: assistantMsg!.id,
          })}\n\n`);
        }
      }
    }

    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    if (aborted) return;
    const msg = err instanceof Error ? err.message : "Internal server error";
    sendEvent({ type: "error", message: msg });
    if (!res.writableEnded) res.end();
  }
});

// ─── Autonomous Execution Pipeline ────────────────────────────────────────────
//
// POST /ai/execute/stream
//
// SSE endpoint. Receives a blueprint (generated by the planner) and runs:
//   1. 8 execution stages  (analyze → install → build → lint → typecheck → test → start → verify)
//   2. Strict verification engine (build, typecheck, runtime, API, DB, frontend, tests, preview)
//   3. Auto-fix loop       (detect error → locate fix → apply → re-verify)
//
// Chat sees only: Planning → Building → Verifying → Ready.
// All internal detail goes only to the TaskExecutionPanel, not to chat.

const executeSchema = z.object({
  conversation_id: z.string().min(1),
  blueprint: z.string().min(1),
});

router.post("/execute/stream", validateBody(executeSchema), async (req, res) => {
  const userId = req.user!.sub;
  const { conversation_id, blueprint } = req.body as z.infer<typeof executeSchema>;

  // Verify conversation belongs to user
  const [conv] = await db
    .select({ id: aiConversationsTable.id })
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, conversation_id), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  let aborted = false;
  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      aborted = true;
      abortController.abort();
    }
  });

  try {
    await runExecutionPipeline(blueprint, conversation_id, userId, send, abortController.signal);
    if (!aborted && !res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    if (aborted) return;
    const msg = err instanceof Error ? err.message : "Execution pipeline error";
    console.error("[execute/stream] Pipeline error", err);
    send({ type: "exec_error", message: msg });
    if (!res.writableEnded) res.end();
  }
});

// ─── Generated Project Files ───────────────────────────────────────────────────

// GET /ai/projects/:conversationId/files — HTML explorer for generated scaffold files
router.get("/projects/:conversationId/files", async (req, res) => {
  const userId = req.user!.sub;
  const { conversationId } = req.params as { conversationId: string };

  const [conv] = await db
    .select({ id: aiConversationsTable.id })
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, conversationId), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const projectDir = path.join(PROJECT_FILES_BASE, conversationId);

  async function listFilesRecursive(dir: string, base: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results.push(...await listFilesRecursive(path.join(dir, entry.name), rel));
        } else {
          results.push(rel);
        }
      }
    } catch { /* dir may not exist */ }
    return results;
  }

  const files = await listFilesRecursive(projectDir, "");

  if (files.length === 0) {
    res.json({ conversationId, files: [], message: "No generated files yet. Run an execution first." });
    return;
  }

  const fileLinks = files
    .map(f => `<li><a href="/api/v1/ai/projects/${conversationId}/file?path=${encodeURIComponent(f)}" target="_blank">${f}</a></li>`)
    .join("\n");

  res.setHeader("Content-Type", "text/html");
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Generated Project — ${conversationId.slice(0, 8)}</title>
  <style>
    body { font-family: monospace; background: #0f1117; color: #e2e8f0; padding: 2rem; }
    h1 { color: #7c3aed; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.25rem 0; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .badge { background: #1e1b4b; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.8rem; margin-left: 0.5rem; color: #a5b4fc; }
  </style>
</head>
<body>
  <h1>Generated Project Files</h1>
  <p>Conversation: <code>${conversationId}</code><span class="badge">${files.length} files</span></p>
  <ul>
    ${fileLinks}
  </ul>
  <p style="margin-top:2rem;color:#64748b">Generated by AI Agent Platform · <a href="/api/v1/ai/projects/${conversationId}/files/download" style="color:#a5b4fc">Download JSON manifest</a></p>
</body>
</html>`);
});

// GET /ai/projects/:conversationId/files/download — JSON manifest of generated files + content
router.get("/projects/:conversationId/files/download", async (req, res) => {
  const userId = req.user!.sub;
  const { conversationId } = req.params as { conversationId: string };

  const [conv] = await db
    .select({ id: aiConversationsTable.id })
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, conversationId), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const projectDir = path.join(PROJECT_FILES_BASE, conversationId);
  const manifest: Record<string, string> = {};

  async function readAll(dir: string, base: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await readAll(path.join(dir, entry.name), rel);
        } else {
          manifest[rel] = await fs.readFile(path.join(dir, entry.name), "utf8").catch(() => "");
        }
      }
    } catch { /* dir may not exist */ }
  }

  await readAll(projectDir, "");
  res.json({ conversationId, files: manifest });
});

// GET /ai/projects/:conversationId/file/* — serve individual generated file
router.get("/projects/:conversationId/file/{*filePath}", async (req, res) => {
  const userId = req.user!.sub;
  const { conversationId } = req.params as { conversationId: string };
  const filePath = (req.params as unknown as { filePath?: string })["filePath"] ?? "";

  const [conv] = await db
    .select({ id: aiConversationsTable.id })
    .from(aiConversationsTable)
    .where(and(eq(aiConversationsTable.id, conversationId), eq(aiConversationsTable.userId, userId)))
    .limit(1);

  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }

  const safeFilePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PROJECT_FILES_BASE, conversationId, safeFilePath);

  if (!fullPath.startsWith(path.join(PROJECT_FILES_BASE, conversationId))) {
    res.status(400).json({ error: "Invalid file path" });
    return;
  }

  try {
    const content = await fs.readFile(fullPath, "utf8");
    const ext = path.extname(fullPath).slice(1).toLowerCase();
    const mimeMap: Record<string, string> = {
      ts: "text/plain", tsx: "text/plain", js: "text/javascript",
      json: "application/json", md: "text/markdown", html: "text/html",
      css: "text/css", txt: "text/plain",
    };
    res.setHeader("Content-Type", mimeMap[ext] ?? "text/plain");
    res.send(content);
  } catch {
    res.status(404).json({ error: "File not found" });
  }
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

// ─── Orchestrator Info ─────────────────────────────────────────────────────────

// GET /ai/orchestrator/info — model catalog + supported task types (no auth needed)
router.get("/orchestrator/info", (_req, res) => {
  res.json({
    taskTypes: TASK_TYPES,
    models: modelRegistry.listAll().map((e) => ({
      id: e.id,
      name: e.name,
      providerSlug: e.providerSlug,
      modelId: e.modelId,
      taskAffinity: e.taskAffinity,
      priority: e.priority,
      capabilities: {
        maxTokens: e.capabilities.maxTokens,
        supportsStreaming: e.capabilities.supportsStreaming,
        isFree: e.capabilities.isFree,
        tags: e.capabilities.tags,
      },
    })),
  });
});

export default router;
