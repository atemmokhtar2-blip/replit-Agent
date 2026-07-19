import app from "./app";
import { logger } from "./lib/logger";
import { validateEnv } from "./lib/env-config";
import { runMigrations, closeDb } from "./lib/db-migrate";

const rawPort = process.env["PORT"];
const port = Number(rawPort ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Startup model validation ────────────────────────────────────────────────────
// Validates the primary planner model on boot. Runs async to not block server startup.
const PLANNER_MODELS_STARTUP = [
  "moonshotai/kimi-k2",
  "deepseek/deepseek-chat-v3-0324",
  "meta-llama/llama-3.1-8b-instruct:free",
] as const;

async function validatePlannerModels(): Promise<void> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    logger.warn("OPENROUTER_API_KEY is not set — planner will use static fallbacks");
    return;
  }

  for (const model of PLANNER_MODELS_STARTUP) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Title": "AI Agent",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.status === 401 || resp.status === 403) {
        logger.error({ model, status: resp.status }, "[STARTUP] OpenRouter API key is invalid");
        return;
      }
      if (resp.status === 400) {
        const body = await resp.text().catch(() => "");
        logger.error({ model, status: resp.status, body: body.slice(0, 120) }, `[STARTUP] Model ${model} is INVALID — will fall back to next in chain`);
        continue;
      }
      if (resp.ok || resp.status === 429) {
        logger.info({ model, status: resp.status }, `[STARTUP] Model ${model} validated OK (${resp.status === 429 ? "rate limited but valid" : "ready"})`);
        return;
      }
      logger.warn({ model, status: resp.status }, `[STARTUP] Model ${model} returned unexpected status`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ model, err: msg }, `[STARTUP] Model ${model} validation failed — ${msg.slice(0, 80)}`);
    }
  }
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Received shutdown signal — closing gracefully");
  try {
    await closeDb();
    logger.info("Database connections closed");
  } catch (err) {
    logger.warn({ err }, "Error closing DB connections");
  }
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));

// ── Main startup sequence ──────────────────────────────────────────────────────

async function startServer(): Promise<void> {
  // 1. Validate environment variables — prints full report, throws in production if required vars missing
  validateEnv();

  // 2. Run database migrations — creates tables, applies schema changes, zero data loss
  await runMigrations();

  // 3. Start HTTP server
  await new Promise<void>((resolve, reject) => {
    app.listen(port, (err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  logger.info({ port, env: process.env["NODE_ENV"] ?? "development" }, "✓ Server listening");

  // 4. Post-startup checks (fire-and-forget — don't block serving traffic)
  setTimeout(() => {
    validatePlannerModels().catch((e) => {
      logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[STARTUP] Planner model validation error");
    });
  }, 1000);
}

startServer().catch((err) => {
  logger.error({ err }, "FATAL: Server failed to start");
  process.exit(1);
});
