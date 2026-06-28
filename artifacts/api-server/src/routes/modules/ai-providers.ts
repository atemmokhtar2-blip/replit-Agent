/**
 * AI Provider Manager — REST API
 *
 * Endpoints:
 *   GET    /providers                  — list all providers + health
 *   GET    /providers/health           — full health report
 *   GET    /providers/stats            — aggregate stats
 *   GET    /providers/requests         — recent request log
 *   POST   /providers/:slug/enable     — enable provider
 *   POST   /providers/:slug/disable    — disable provider
 *   POST   /providers/:slug/strategy   — update routing strategy
 *   POST   /providers/:slug/test       — test provider connectivity
 *   GET    /providers/:slug/keys       — list keys (masked)
 *   POST   /providers/:slug/keys       — add key
 *   POST   /providers/:slug/keys/:id/enable  — enable key
 *   POST   /providers/:slug/keys/:id/disable — disable key
 *   POST   /providers/:slug/keys/:id/rotate  — rotate key
 *   DELETE /providers/:slug/keys/:id         — delete key
 *   POST   /providers/:slug/keys/:id/test    — test single key
 *   POST   /providers/health-check           — run health monitor now
 */

import { Router } from "express";
import { z } from "zod/v4";
import { authenticate as requireAuth } from "../../middlewares/authenticate.js";
import { requireRole }    from "../../middlewares/authorize.js";
import { validateBody }   from "../../middlewares/validate.js";
import { providerManager } from "../../lib/provider-manager/index.js";
import type { RoutingStrategy } from "../../lib/provider-manager/types.js";

const router = Router();

// All provider-manager endpoints require authentication
router.use(requireAuth);

// ── GET /providers — list all providers with live health ─────────────────────

router.get("/", async (_req, res) => {
  try {
    const report = providerManager.getHealthReport();
    res.json({ ok: true, data: report });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── GET /providers/health — full health report ───────────────────────────────

router.get("/health", async (_req, res) => {
  try {
    const report = providerManager.getHealthReport();
    res.json({ ok: true, data: report });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── GET /providers/stats — aggregate usage stats ─────────────────────────────

router.get("/stats", async (_req, res) => {
  try {
    const report = providerManager.getHealthReport();
    res.json({
      ok: true,
      data: {
        activeProviders:  report.activeProviders,
        totalProviders:   report.totalProviders,
        totalKeys:        report.totalKeys,
        activeKeys:       report.activeKeys,
        totalRequests:    report.totalRequests,
        overallSuccess:   report.overallSuccess,
        avgLatencyMs:     report.avgLatencyMs,
        currentStrategy:  report.currentStrategy,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── GET /providers/requests — recent request log ─────────────────────────────

router.get("/requests", async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query["limit"] ?? 50), 200);
    const rows   = await providerManager.getRecentRequests(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/health-check — trigger immediate health check ─────────────

router.post("/health-check", requireRole("admin"), async (_req, res) => {
  try {
    await providerManager.runHealthCheck();
    const report = providerManager.getHealthReport();
    res.json({ ok: true, data: report });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/enable ─────────────────────────────────────────────

router.post("/:slug/enable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.enableProvider(String(req.params["slug"]));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/disable ────────────────────────────────────────────

router.post("/:slug/disable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.disableProvider(String(req.params["slug"]));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/strategy — update routing strategy ─────────────────

const strategySchema = z.object({
  strategy: z.enum(["round-robin", "least-recently-used", "lowest-latency", "random", "priority", "least-failures"]),
});

router.post("/:slug/strategy", requireRole("admin"), validateBody(strategySchema), async (req, res) => {
  try {
    const { strategy } = req.body as { strategy: RoutingStrategy };
    await providerManager.updateRoutingStrategy(String(req.params["slug"]), strategy);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/test — test connectivity ───────────────────────────

router.post("/:slug/test", async (req, res) => {
  try {
    const result = await providerManager.testProvider(String(req.params["slug"]));
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── GET /providers/:slug/keys — list keys (masked, never plaintext) ──────────

router.get("/:slug/keys", async (req, res) => {
  try {
    const slug = String(req.params["slug"]);
    const report  = providerManager.getHealthReport();
    const provider = report.providers.find(p => p.slug === slug);
    if (!provider) return res.status(404).json({ ok: false, error: "Provider not found" });
    return res.json({ ok: true, data: provider.keys });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys — add a new key ───────────────────────────────

const addKeySchema = z.object({
  name:   z.string().min(1).max(100),
  apiKey: z.string().min(8),
});

router.post("/:slug/keys", requireRole("admin"), validateBody(addKeySchema), async (req, res) => {
  try {
    const { name, apiKey } = req.body as { name: string; apiKey: string };
    const id = await providerManager.addKey(String(req.params["slug"]), name, apiKey);
    res.json({ ok: true, data: { id } });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/enable ────────────────────────────────────

router.post("/:slug/keys/:id/enable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.enableKey(String(req.params["id"]));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/disable ───────────────────────────────────

router.post("/:slug/keys/:id/disable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.disableKey(String(req.params["id"]));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/rotate — replace key value ───────────────

const rotateKeySchema = z.object({ newApiKey: z.string().min(8) });

router.post("/:slug/keys/:id/rotate", requireRole("admin"), validateBody(rotateKeySchema), async (req, res) => {
  try {
    const { newApiKey } = req.body as { newApiKey: string };
    await providerManager.rotateKey(String(req.params["id"]), newApiKey);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── DELETE /providers/:slug/keys/:id ─────────────────────────────────────────

router.delete("/:slug/keys/:id", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.deleteKey(String(req.params["id"]));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/test — test a specific key ───────────────

router.post("/:slug/keys/:id/test", async (req, res) => {
  try {
    const result = await providerManager.testKey(String(req.params["id"]));
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── Model Discovery endpoints ─────────────────────────────────────────────────

// GET /providers/models — list discovered models with filtering
router.get("/models", async (req, res) => {
  try {
    const { provider, free, category, limit, offset } = req.query as Record<string, string | undefined>;
    const result = await providerManager.getDiscoveredModels({
      providerSlug: provider,
      onlyFree:     free === "true",
      category,
      limit:        limit  ? Math.min(Number(limit),  500) : 100,
      offset:       offset ? Number(offset) : 0,
    });
    res.json({ ok: true, data: result.models, total: result.total });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /providers/models/discovery-status — last run metadata
router.get("/models/discovery-status", async (_req, res) => {
  try {
    res.json({ ok: true, data: providerManager.getDiscoveryStatus() });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /providers/models/best — best model for a task
router.get("/models/best", async (req, res) => {
  try {
    const { task, free } = req.query as Record<string, string | undefined>;
    const model = await providerManager.getBestModel(task ?? "general", free === "true");
    res.json({ ok: true, data: model });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /providers/models/discover — trigger manual refresh (admin only)
router.post("/models/discover", requireRole("admin"), async (_req, res) => {
  try {
    const results = await providerManager.discoverModels();
    res.json({ ok: true, data: results });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
