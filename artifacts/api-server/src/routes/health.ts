import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /healthz
 *
 * Returns 200 when the server is running and DB is reachable.
 * Returns 503 when the DB is down (so load balancers / uptime monitors can detect it).
 *
 * Response body:
 *   { status: "ok" | "degraded", db: "ok" | "error", uptime: number }
 */
router.get("/healthz", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";

  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    dbStatus = "error";
  }

  const ok = dbStatus === "ok";

  res.status(ok ? 200 : 503).json({
    status:  ok ? "ok" : "degraded",
    db:      dbStatus,
    uptime:  Math.floor(process.uptime()),
    version: process.env["npm_package_version"] ?? "unknown",
  });
});

export default router;
