/**
 * System Status API — Admin only
 *
 * GET /api/v1/admin/system/status
 *   Returns health status of all major system components.
 *   Used by the Production Status admin page.
 *
 * GET /api/v1/admin/system/env
 *   Returns env var status (present/missing) — secrets masked.
 *   Used by the Deployment Guide admin page.
 *
 * GET /api/v1/admin/system/info
 *   Returns version, build, uptime, commit info.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { authenticate } from "../../middlewares/authenticate";
import { requireRole } from "../../middlewares/authorize";
import { getEnvReport } from "../../lib/env-config";
import { GoogleOAuthProvider } from "../../lib/oauth/google";

const router = Router();
router.use(authenticate, requireRole("admin"));

// ── Component health check helpers ────────────────────────────────────────────

type HealthStatus = "healthy" | "warning" | "error";

interface ComponentHealth {
  name: string;
  status: HealthStatus;
  message: string;
  latency_ms?: number;
}

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    return { name: "Database", status: "healthy", message: "PostgreSQL connected", latency_ms: Date.now() - start };
  } catch (err) {
    return { name: "Database", status: "error", message: `Connection failed: ${err instanceof Error ? err.message : String(err)}`, latency_ms: Date.now() - start };
  }
}

function checkAuthentication(): ComponentHealth {
  const jwtSet    = !!process.env["JWT_SECRET"];
  const sessionSet = !!process.env["SESSION_SECRET"];
  const googleReady = GoogleOAuthProvider.isEnvConfigured();

  if (!jwtSet) {
    return { name: "Authentication", status: "error", message: "JWT_SECRET is not set" };
  }
  if (!sessionSet) {
    return { name: "Authentication", status: "warning", message: "SESSION_SECRET missing (using insecure fallback in dev)" };
  }
  if (!googleReady) {
    return { name: "Authentication", status: "warning", message: "Local auth ready. Google OAuth not configured (optional)" };
  }
  return { name: "Authentication", status: "healthy", message: "JWT + Google OAuth configured" };
}

function checkAiProviders(): ComponentHealth {
  const providers = [
    { key: "OPENROUTER_API_KEY", name: "OpenRouter" },
    { key: "OPENAI_API_KEY",     name: "OpenAI" },
    { key: "ANTHROPIC_API_KEY",  name: "Anthropic" },
    { key: "GEMINI_API_KEY",     name: "Gemini" },
    { key: "GROQ_API_KEY",       name: "Groq" },
    { key: "XAI_API_KEY",        name: "xAI" },
    { key: "MISTRAL_API_KEY",    name: "Mistral" },
    { key: "DEEPSEEK_API_KEY",   name: "DeepSeek" },
    { key: "COHERE_API_KEY",     name: "Cohere" },
    { key: "HF_TOKEN",           name: "Hugging Face" },
  ];

  const configured = providers.filter((p) => !!process.env[p.key]);

  if (configured.length === 0) {
    return {
      name: "AI Providers",
      status: "error",
      message: "No AI provider API keys configured. AI features will not work.",
    };
  }
  if (!process.env["OPENROUTER_API_KEY"]) {
    return {
      name: "AI Providers",
      status: "warning",
      message: `${configured.length} provider(s) configured. OPENROUTER_API_KEY (primary planner) is missing.`,
    };
  }
  return {
    name: "AI Providers",
    status: "healthy",
    message: `${configured.length} provider(s) configured: ${configured.map((p) => p.name).join(", ")}`,
  };
}

function checkStorage(): ComponentHealth {
  // Storage is backed by PostgreSQL — if DB is reachable, storage works.
  const dbUrl = !!process.env["DATABASE_URL"];
  if (!dbUrl) {
    return { name: "Storage", status: "error", message: "DATABASE_URL not set — storage unavailable" };
  }
  return { name: "Storage", status: "healthy", message: "PostgreSQL-backed storage (no external file storage)" };
}

function checkEnvironment(): ComponentHealth {
  const report = getEnvReport();
  const missing = report.filter((v) => v.required && !v.present);
  if (missing.length > 0) {
    return {
      name: "Environment",
      status: "error",
      message: `${missing.length} required env var(s) missing: ${missing.map((v) => v.key).join(", ")}`,
    };
  }
  return { name: "Environment", status: "healthy", message: "All required environment variables are set" };
}

function checkSessions(): ComponentHealth {
  const jwtSet    = !!process.env["JWT_SECRET"];
  const refreshSet = !!process.env["JWT_REFRESH_SECRET"];

  if (!jwtSet) {
    return { name: "Sessions", status: "error", message: "JWT_SECRET not configured — sessions broken" };
  }
  if (!refreshSet) {
    return { name: "Sessions", status: "warning", message: "JWT_REFRESH_SECRET missing — using JWT_SECRET as fallback" };
  }
  return { name: "Sessions", status: "healthy", message: "JWT access + refresh tokens configured" };
}

function checkDeployment(): ComponentHealth {
  const isProduction = process.env["NODE_ENV"] === "production";
  const replitDomains = process.env["REPLIT_DOMAINS"];
  const appUrl = process.env["APP_URL"];
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];

  if (isProduction && !replitDomains && !appUrl) {
    return {
      name: "Deployment",
      status: "warning",
      message: "Running in production but no REPLIT_DOMAINS or APP_URL set (CORS may be restricted)",
    };
  }

  const env = isProduction ? "production" : "development";
  const domain = replitDomains ?? appUrl ?? devDomain ?? "unknown";
  return {
    name: "Deployment",
    status: "healthy",
    message: `Running in ${env} mode. Domain: ${domain}`,
  };
}

// ── GET /system/status ────────────────────────────────────────────────────────

router.get("/system/status", async (_req, res) => {
  const [dbHealth, ...syncChecks] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkAuthentication()),
    Promise.resolve(checkAiProviders()),
    Promise.resolve(checkStorage()),
    Promise.resolve(checkSessions()),
    Promise.resolve(checkEnvironment()),
    Promise.resolve(checkDeployment()),
  ]);

  const checks: ComponentHealth[] = [dbHealth, ...syncChecks];

  const overall: HealthStatus =
    checks.some((c) => c.status === "error")   ? "error" :
    checks.some((c) => c.status === "warning") ? "warning" :
    "healthy";

  res.json({
    overall,
    uptime_seconds: Math.floor(process.uptime()),
    node_version: process.version,
    node_env: process.env["NODE_ENV"] ?? "development",
    checks,
  });
});

// ── GET /system/env ───────────────────────────────────────────────────────────

router.get("/system/env", (_req, res) => {
  const report = getEnvReport();

  // Group by category
  const byGroup: Record<string, typeof report> = {};
  for (const item of report) {
    (byGroup[item.group] ??= []).push(item);
  }

  const groups = Object.entries(byGroup).map(([name, vars]) => ({
    name,
    vars: vars.map((v) => ({
      key: v.key,
      required: v.required,
      present: v.present,
      description: v.description,
      // Never reveal the actual value — only presence
    })),
  }));

  const missing   = report.filter((v) => v.required && !v.present);
  const present   = report.filter((v) => v.present);

  res.json({
    groups,
    summary: {
      total: report.length,
      present: present.length,
      missing_required: missing.length,
      missing_required_keys: missing.map((v) => v.key),
    },
  });
});

// ── GET /system/info ──────────────────────────────────────────────────────────

router.get("/system/info", (_req, res) => {
  res.json({
    version:      process.env["npm_package_version"] ?? "unknown",
    node_version: process.version,
    node_env:     process.env["NODE_ENV"] ?? "development",
    platform:     process.platform,
    arch:         process.arch,
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb:    Math.round(process.memoryUsage().rss / 1024 / 1024),
    // Build/commit info (injected at build time via env vars by CI)
    commit:       process.env["GIT_COMMIT"]    ?? process.env["VERCEL_GIT_COMMIT_SHA"] ?? "unknown",
    build_time:   process.env["BUILD_TIME"]    ?? "unknown",
    replit_slug:  process.env["REPL_SLUG"]     ?? process.env["REPLIT_SLUG"] ?? "unknown",
    deploy_url:   process.env["REPLIT_DOMAINS"] ?? process.env["APP_URL"] ?? process.env["VERCEL_URL"] ?? "unknown",
  });
});

export default router;
