/**
 * AI Control Center — Router Intelligence + Execution History
 *
 * Endpoints:
 *   GET  /ai/router/info        — routing intelligence overview (task types, agents, models)
 *   GET  /ai/router/models      — full model registry with live health
 *   GET  /ai/router/health      — health dashboard for all models
 *   GET  /ai/router/executions  — execution history with routing telemetry
 *   GET  /ai/router/executions/:id — single execution + routing events
 *   PATCH /ai/router/models/:id — enable/disable or update priority
 *   GET  /ai/router/classify    — classify a message (dry run, no execution)
 */

import { Router } from "express";
import { z } from "zod";
import { db, executionRecordsTable, routingEventsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  modelRegistry,
  agentRegistry,
  healthMonitor,
  classifyTask,
  TASK_TYPES,
  AGENT_TYPES,
} from "@workspace/ai-orchestrator";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";

const router = Router();
router.use(authenticate);

// ─── GET /ai/router/info ───────────────────────────────────────────────────────

router.get("/router/info", (_req, res) => {
  res.json({
    task_types: TASK_TYPES,
    agent_types: AGENT_TYPES,
    agents: agentRegistry.toSummary().map((a) => ({
      agent_type: a.agentType,
      name: a.name,
      description: a.description,
      supported_task_types: a.supportedTaskTypes,
    })),
    model_count: modelRegistry.listAll().filter((e) => e.enabled).length,
    total_models: modelRegistry.listAll().length,
  });
});

// ─── GET /ai/router/models ────────────────────────────────────────────────────

router.get("/router/models", (_req, res) => {
  const catalog = modelRegistry.listAll();
  const items = catalog.map((e) => {
    const health = healthMonitor.getReport(e.id, e.providerSlug);
    return {
      id: e.id,
      name: e.name,
      provider_slug: e.providerSlug,
      model_id: e.modelId,
      task_affinity: e.taskAffinity,
      priority: e.priority,
      fallback_priority: e.fallbackPriority,
      enabled: e.enabled,
      status: e.status,
      is_free: e.capabilities.isFree,
      max_tokens: e.capabilities.maxTokens,
      tags: e.capabilities.tags,
      health: {
        uptime_pct: health.uptimePct,
        success_rate: health.successRate,
        avg_response_ms: health.avgResponseMs,
        total_requests: health.totalRequests,
        active_requests: health.activeRequests,
      },
    };
  });
  res.json({ items, total: items.length });
});

// ─── GET /ai/router/health ────────────────────────────────────────────────────

router.get("/router/health", (_req, res) => {
  const reports = healthMonitor.getRegistryReports();
  const catalog = modelRegistry.listAll();
  const byId = new Map(catalog.map((e) => [e.id, e]));

  const items = reports.map((r) => {
    const entry = byId.get(r.registryEntryId);
    return {
      registry_entry_id: r.registryEntryId,
      name: entry?.name ?? r.registryEntryId,
      provider_slug: r.providerSlug,
      status: r.status,
      uptime_pct: r.uptimePct,
      success_rate: r.successRate,
      error_rate: r.errorRate,
      avg_response_ms: r.avgResponseMs,
      total_requests: r.totalRequests,
      active_requests: r.activeRequests,
      last_success_at: r.lastSuccessAt?.toISOString() ?? null,
      last_failure_at: r.lastFailureAt?.toISOString() ?? null,
    };
  });

  const summary = { available: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const r of items) summary[r.status as keyof typeof summary]++;

  res.json({ items, total: items.length, summary });
});

// ─── PATCH /ai/router/models/:id ─────────────────────────────────────────────

const updateModelSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

router.patch("/router/models/:id", validateBody(updateModelSchema), (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as z.infer<typeof updateModelSchema>;

  if (body.enabled !== undefined) {
    const ok = modelRegistry.setEnabled(id, body.enabled);
    if (!ok) { res.status(404).json({ error: `Model "${id}" not found` }); return; }
  }
  if (body.priority !== undefined) {
    const ok = modelRegistry.setPriority(id, body.priority);
    if (!ok) { res.status(404).json({ error: `Model "${id}" not found` }); return; }
  }

  const entry = modelRegistry.findById(id);
  res.json({ id, name: entry?.name ?? id, enabled: entry?.enabled, priority: entry?.priority });
});

// ─── GET /ai/router/executions ────────────────────────────────────────────────

router.get("/router/executions", async (req, res) => {
  const userId = req.user!.sub;
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const perPage = Math.min(50, Math.max(1, Number(req.query["per_page"] ?? 20)));
  const offset = (page - 1) * perPage;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select()
      .from(executionRecordsTable)
      .where(eq(executionRecordsTable.userId, userId))
      .orderBy(desc(executionRecordsTable.startedAt))
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(executionRecordsTable)
      .where(eq(executionRecordsTable.userId, userId)),
  ]);

  type ExecRow = typeof executionRecordsTable.$inferSelect;
  const items = rows.map((r: ExecRow) => ({
    id: r.id,
    agent_type: r.agentType,
    task_type: r.taskType,
    provider_slug: r.providerSlug,
    model_id: r.modelId,
    status: r.status,
    latency_ms: r.latencyMs,
    retries: r.retries,
    failovers: r.failovers,
    request_summary: r.requestSummary,
    routing_rationale: r.routingRationale,
    error_message: r.errorMessage,
    started_at: r.startedAt.toISOString(),
    completed_at: r.completedAt?.toISOString() ?? null,
  }));

  res.json({ items, total: count, page, per_page: perPage });
});

// ─── GET /ai/router/executions/:id ───────────────────────────────────────────

router.get("/router/executions/:id", async (req, res) => {
  const userId = req.user!.sub;
  const { id } = req.params as { id: string };

  const [record] = await db
    .select()
    .from(executionRecordsTable)
    .where(and(eq(executionRecordsTable.id, id), eq(executionRecordsTable.userId, userId)))
    .limit(1);

  if (!record) { res.status(404).json({ error: "Execution not found" }); return; }

  const events = await db
    .select()
    .from(routingEventsTable)
    .where(eq(routingEventsTable.executionId, id))
    .orderBy(routingEventsTable.createdAt);

  res.json({
    id: record.id,
    agent_type: record.agentType,
    task_type: record.taskType,
    provider_slug: record.providerSlug,
    model_id: record.modelId,
    status: record.status,
    latency_ms: record.latencyMs,
    retries: record.retries,
    failovers: record.failovers,
    request_summary: record.requestSummary,
    routing_rationale: record.routingRationale,
    error_type: record.errorType,
    error_message: record.errorMessage,
    started_at: record.startedAt.toISOString(),
    completed_at: record.completedAt?.toISOString() ?? null,
    routing_events: events.map((e: typeof routingEventsTable.$inferSelect) => ({
      id: e.id,
      event_type: e.eventType,
      from_model_id: e.fromModelId,
      to_model_id: e.toModelId,
      agent_type: e.agentType,
      task_type: e.taskType,
      reason: e.reason,
      created_at: e.createdAt.toISOString(),
    })),
  });
});

// ─── POST /ai/router/classify — dry run classifier ───────────────────────────

const classifySchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant", "system"]), content: z.string() })).min(1),
});

router.post("/router/classify", validateBody(classifySchema), (req, res) => {
  const { messages } = req.body as z.infer<typeof classifySchema>;
  const classification = classifyTask(messages);
  const agent = agentRegistry.findForTask(classification.taskType);
  const bestModels = modelRegistry.getFallbackChain(classification.taskType, "openrouter").slice(0, 3);

  res.json({
    task_type: classification.taskType,
    confidence: classification.confidence,
    signals: classification.signals,
    selected_agent: {
      agent_type: agent.agentType,
      name: agent.name,
    },
    top_models: bestModels.map((m) => ({
      id: m.id,
      name: m.name,
      model_id: m.modelId,
      priority: m.priority,
      status: m.status,
    })),
  });
});

export default router;
