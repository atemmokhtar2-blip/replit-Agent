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
import { requireAuth }    from "../../middleware/auth.js";
import { requireRole }    from "../../lib/rbac.js";
import { validateBody }   from "../../middleware/validate.js";
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
    await providerManager.enableProvider(req.params["slug"]!);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/disable ────────────────────────────────────────────

router.post("/:slug/disable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.disableProvider(req.params["slug"]!);
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
    await providerManager.updateRoutingStrategy(req.params["slug"]!, strategy);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/test — test connectivity ───────────────────────────

router.post("/:slug/test", async (req, res) => {
  try {
    const result = await providerManager.testProvider(req.params["slug"]!);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// ── GET /providers/:slug/keys — list keys (masked, never plaintext) ──────────

router.get("/:slug/keys", async (req, res) => {
  try {
    const report  = providerManager.getHealthReport();
    const provider = report.providers.find(p => p.slug === req.params["slug"]);
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
    const id = await providerManager.addKey(req.params["slug"]!, name, apiKey);
    res.json({ ok: true, data: { id } });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/enable ────────────────────────────────────

router.post("/:slug/keys/:id/enable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.enableKey(req.params["id"]!);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/disable ───────────────────────────────────

router.post("/:slug/keys/:id/disable", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.disableKey(req.params["id"]!);
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
    await providerManager.rotateKey(req.params["id"]!, newApiKey);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── DELETE /providers/:slug/keys/:id ─────────────────────────────────────────

router.delete("/:slug/keys/:id", requireRole("admin"), async (req, res) => {
  try {
    await providerManager.deleteKey(req.params["id"]!);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ ok: false, error: (err as Error).message });
  }
});

// ── POST /providers/:slug/keys/:id/test — test a specific key ───────────────

router.post("/:slug/keys/:id/test", async (req, res) => {
  try {
    const result = await providerManager.testKey(req.params["id"]!);
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

export default router;
