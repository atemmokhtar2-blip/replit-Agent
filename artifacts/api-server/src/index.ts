import app from "./app";
import { logger } from "./lib/logger";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Fire-and-forget startup model validation
  validatePlannerModels().catch((e) => {
    logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[STARTUP] Model validation error");
  });
});
