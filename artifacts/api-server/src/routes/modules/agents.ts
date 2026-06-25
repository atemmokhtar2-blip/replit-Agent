/**
 * Agents Module — AI OS Agent Endpoints
 *
 * Endpoints:
 *   GET  /agents                  — list all registered agents + their capabilities
 *   GET  /agents/:agentType       — get one agent's full profile
 *   POST /agents/invoke           — invoke the AI OS (auto-selects agent by task type)
 *   POST /agents/:agentType/invoke — invoke a specific agent directly
 *   GET  /agents/registry/health  — get health status across all models
 *   GET  /agents/registry/models  — get the full model registry
 */

import { Router } from "express";
import { z } from "zod";
import {
  aiRouter,
  agentRegistry,
  modelRegistry,
  healthMonitor,
  AGENT_TYPES,
} from "@workspace/ai-orchestrator";
import type { AgentType } from "@workspace/ai-orchestrator";
import { authenticate } from "../../middlewares/authenticate.js";
import { validateBody } from "../../middlewares/validate.js";

const router = Router();
router.use(authenticate);

// ─── Schemas ──────────────────────────────────────────────────────────────────

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(100_000),
});

const invokeSchema = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  conversation_id: z.string().optional(),
  project_id: z.string().optional(),
  preferred_agent: z.enum(AGENT_TYPES as unknown as [string, ...string[]]).optional(),
  max_tokens: z.number().int().min(1).max(32000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

// ─── GET /agents — list all agents ────────────────────────────────────────────

router.get("/", (_req, res) => {
  const agents = agentRegistry.toSummary();
  const catalog = modelRegistry.listAll();
  const byId = new Map(catalog.map((e) => [e.id, e]));

  const items = agents.map((a) => ({
    agent_type: a.agentType,
    name: a.name,
    description: a.description,
    supported_task_types: a.supportedTaskTypes,
    preferred_models: a.preferredModelIds.map((id) => {
      const entry = byId.get(id);
      return entry
        ? { id: entry.id, name: entry.name, model_id: entry.modelId, is_free: entry.capabilities.isFree, status: entry.status }
        : { id, name: id, model_id: id, is_free: false, status: "unknown" };
    }),
  }));

  res.json({ items, total: items.length });
});

// ─── GET /agents/registry/models — full model registry ────────────────────────

router.get("/registry/models", (_req, res) => {
  const catalog = modelRegistry.listAll();
  const items = catalog.map((e) => ({
    id: e.id,
    name: e.name,
    provider_slug: e.providerSlug,
    model_id: e.modelId,
    task_affinity: e.taskAffinity,
    priority: e.priority,
    fallback_priority: e.fallbackPriority,
    enabled: e.enabled,
    status: e.status,
    capabilities: e.capabilities,
  }));
  res.json({ items, total: items.length });
});

// ─── GET /agents/registry/health — health dashboard ───────────────────────────

router.get("/registry/health", (_req, res) => {
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
      min_response_ms: r.minResponseMs,
      max_response_ms: r.maxResponseMs,
      total_requests: r.totalRequests,
      active_requests: r.activeRequests,
      last_success_at: r.lastSuccessAt?.toISOString() ?? null,
      last_failure_at: r.lastFailureAt?.toISOString() ?? null,
      last_error: r.lastError ?? null,
    };
  });

  const statusCounts = { available: 0, degraded: 0, offline: 0, unknown: 0 };
  for (const r of items) statusCounts[r.status as keyof typeof statusCounts]++;

  res.json({
    items,
    total: items.length,
    summary: statusCounts,
  });
});

// ─── PATCH /agents/registry/models/:id — toggle enable/disable ────────────────

router.patch("/registry/models/:id", (req, res) => {
  const { id } = req.params as { id: string };
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "Body must contain `enabled: boolean`" });
    return;
  }

  const success = modelRegistry.setEnabled(id, enabled);
  if (!success) {
    res.status(404).json({ error: `Model registry entry "${id}" not found` });
    return;
  }

  const entry = modelRegistry.findById(id);
  res.json({ id, enabled, name: entry?.name ?? id });
});

// ─── GET /agents/:agentType — single agent profile ────────────────────────────

router.get("/:agentType", (req, res) => {
  const { agentType } = req.params as { agentType: string };

  if (!AGENT_TYPES.includes(agentType as AgentType)) {
    res.status(404).json({ error: `Agent type "${agentType}" not found`, available: AGENT_TYPES });
    return;
  }

  const agent = agentRegistry.get(agentType as AgentType);
  if (!agent) {
    res.status(404).json({ error: `Agent "${agentType}" not registered` });
    return;
  }

  const catalog = modelRegistry.listAll();
  const byId = new Map(catalog.map((e) => [e.id, e]));

  res.json({
    agent_type: agent.agentType,
    name: agent.name,
    description: agent.description,
    supported_task_types: agent.supportedTaskTypes,
    preferred_models: agent.preferredModelIds.map((id) => {
      const entry = byId.get(id);
      if (!entry) return { id, model_id: id, status: "unknown" };
      const health = healthMonitor.getReport(entry.id, entry.providerSlug);
      return {
        id: entry.id,
        name: entry.name,
        model_id: entry.modelId,
        is_free: entry.capabilities.isFree,
        status: entry.status,
        avg_response_ms: health.avgResponseMs,
        success_rate: health.successRate,
        total_requests: health.totalRequests,
      };
    }),
  });
});

// ─── POST /agents/invoke — auto-routed invocation ─────────────────────────────

router.post("/invoke", validateBody(invokeSchema), async (req, res) => {
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof invokeSchema>;

  try {
    const result = await aiRouter.executeWithAgent({
      messages: body.messages,
      userId,
      conversationId: body.conversation_id,
      projectId: body.project_id,
      preferredAgentType: body.preferred_agent as AgentType | undefined,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
      signal: req.socket ? AbortSignal.timeout(120_000) : undefined,
    });

    res.json({
      content: result.content,
      agent_type: result.agentType,
      task_type: result.taskType,
      model_id: result.modelId,
      provider_slug: result.providerSlug,
      registry_entry_id: result.registryEntryId,
      latency_ms: result.latencyMs,
      retries: result.retries,
      failovers: result.failovers,
      rationale: result.rationale,
      execution_id: result.executionId,
      error: result.error ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[POST /agents/invoke] Error:", msg);
    res.status(500).json({ error: "Agent invocation failed", detail: msg });
  }
});

// ─── POST /agents/:agentType/invoke — invoke specific agent ───────────────────

router.post("/:agentType/invoke", validateBody(invokeSchema), async (req, res) => {
  const { agentType } = req.params as { agentType: string };
  const userId = req.user!.sub;
  const body = req.body as z.infer<typeof invokeSchema>;

  if (!AGENT_TYPES.includes(agentType as AgentType)) {
    res.status(404).json({ error: `Agent type "${agentType}" not found`, available: AGENT_TYPES });
    return;
  }

  try {
    const result = await aiRouter.executeWithAgent({
      messages: body.messages,
      userId,
      conversationId: body.conversation_id,
      projectId: body.project_id,
      preferredAgentType: agentType as AgentType,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
    });

    res.json({
      content: result.content,
      agent_type: result.agentType,
      task_type: result.taskType,
      model_id: result.modelId,
      provider_slug: result.providerSlug,
      registry_entry_id: result.registryEntryId,
      latency_ms: result.latencyMs,
      retries: result.retries,
      failovers: result.failovers,
      rationale: result.rationale,
      execution_id: result.executionId,
      error: result.error ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[POST /agents/${agentType}/invoke] Error:`, msg);
    res.status(500).json({ error: "Agent invocation failed", detail: msg });
  }
});

export default router;
