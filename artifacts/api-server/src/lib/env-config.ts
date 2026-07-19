/**
 * Environment Variable Validation & Configuration
 *
 * Runs at server startup. Prints a clear report of which env vars are
 * present/missing, then hard-fails in production if any REQUIRED var is absent.
 *
 * Usage:
 *   import { validateEnv, getEnvReport } from "./env-config";
 *   validateEnv(); // call once at startup, before anything else
 */

export interface EnvVarSpec {
  key: string;
  required: boolean;
  description: string;
  group: string;
  /** True if the value should never be logged */
  secret?: boolean;
}

/** Master list of all environment variables used by the application */
export const ENV_VARS: EnvVarSpec[] = [
  // ── Database ────────────────────────────────────────────────────────────────
  { key: "DATABASE_URL",            required: true,  secret: true,  group: "Database",        description: "PostgreSQL connection string" },

  // ── Auth / Security ─────────────────────────────────────────────────────────
  { key: "JWT_SECRET",              required: true,  secret: true,  group: "Auth",            description: "JWT signing secret (access tokens)" },
  { key: "JWT_REFRESH_SECRET",      required: false, secret: true,  group: "Auth",            description: "JWT signing secret (refresh tokens, falls back to JWT_SECRET)" },
  { key: "SESSION_SECRET",          required: false, secret: true,  group: "Auth",            description: "Session cookie secret" },
  { key: "PROVIDER_ENCRYPTION_KEY", required: false, secret: true,  group: "Auth",            description: "AES-256 key for encrypting stored API keys (falls back to JWT_SECRET)" },

  // ── Google OAuth ─────────────────────────────────────────────────────────────
  { key: "GOOGLE_CLIENT_ID",        required: false, secret: false, group: "Google OAuth",    description: "Google OAuth2 client ID" },
  { key: "GOOGLE_CLIENT_SECRET",    required: false, secret: true,  group: "Google OAuth",    description: "Google OAuth2 client secret" },
  { key: "GOOGLE_REDIRECT_URI",     required: false, secret: false, group: "Google OAuth",    description: "Override Google OAuth redirect URI" },

  // ── GitHub OAuth ─────────────────────────────────────────────────────────────
  { key: "GITHUB_CLIENT_ID",        required: false, secret: false, group: "GitHub OAuth",    description: "GitHub OAuth app client ID" },
  { key: "GITHUB_CLIENT_SECRET",    required: false, secret: true,  group: "GitHub OAuth",    description: "GitHub OAuth app client secret" },

  // ── AI Providers ─────────────────────────────────────────────────────────────
  { key: "OPENROUTER_API_KEY",      required: false, secret: true,  group: "AI Providers",    description: "OpenRouter API key (primary planner LLM)" },
  { key: "GEMINI_API_KEY",          required: false, secret: true,  group: "AI Providers",    description: "Google Gemini API key" },
  { key: "OPENAI_API_KEY",          required: false, secret: true,  group: "AI Providers",    description: "OpenAI API key" },
  { key: "ANTHROPIC_API_KEY",       required: false, secret: true,  group: "AI Providers",    description: "Anthropic Claude API key" },
  { key: "GROQ_API_KEY",            required: false, secret: true,  group: "AI Providers",    description: "Groq API key" },
  { key: "XAI_API_KEY",             required: false, secret: true,  group: "AI Providers",    description: "xAI Grok API key" },
  { key: "MISTRAL_API_KEY",         required: false, secret: true,  group: "AI Providers",    description: "Mistral API key" },
  { key: "DEEPSEEK_API_KEY",        required: false, secret: true,  group: "AI Providers",    description: "DeepSeek API key" },
  { key: "COHERE_API_KEY",          required: false, secret: true,  group: "AI Providers",    description: "Cohere API key" },
  { key: "HF_TOKEN",                required: false, secret: true,  group: "AI Providers",    description: "Hugging Face API token" },

  // ── Networking / Hosting ─────────────────────────────────────────────────────
  { key: "PORT",                    required: false, secret: false, group: "Networking",      description: "HTTP server port (default: 8080)" },
  { key: "NODE_ENV",                required: false, secret: false, group: "Networking",      description: "Runtime environment (development | production)" },
  { key: "APP_URL",                 required: false, secret: false, group: "Networking",      description: "Canonical public URL of the app" },
  { key: "APP_CORS_ORIGINS",        required: false, secret: false, group: "Networking",      description: "Comma-separated allowed CORS origins" },
  { key: "REPLIT_DEV_DOMAIN",       required: false, secret: false, group: "Networking",      description: "Auto-set by Replit in dev workspace" },
  { key: "REPLIT_DOMAINS",          required: false, secret: false, group: "Networking",      description: "Auto-set by Replit in production deployments" },

  // ── Email / SMTP ─────────────────────────────────────────────────────────────
  { key: "SMTP_HOST",               required: false, secret: false, group: "Email",           description: "SMTP server hostname" },
  { key: "SMTP_PORT",               required: false, secret: false, group: "Email",           description: "SMTP server port (default: 587)" },
  { key: "SMTP_USER",               required: false, secret: false, group: "Email",           description: "SMTP authentication username" },
  { key: "SMTP_PASS",               required: false, secret: true,  group: "Email",           description: "SMTP authentication password" },
  { key: "SMTP_FROM",               required: false, secret: false, group: "Email",           description: "From address for outgoing emails" },
];

export interface EnvVarStatus {
  key: string;
  required: boolean;
  present: boolean;
  description: string;
  group: string;
  secret: boolean;
}

/** Build a status report for all known env vars */
export function getEnvReport(): EnvVarStatus[] {
  return ENV_VARS.map((spec) => ({
    key: spec.key,
    required: spec.required,
    present: !!process.env[spec.key],
    description: spec.description,
    group: spec.group,
    secret: spec.secret ?? false,
  }));
}

/** Validate env vars and print a startup report to console.
 *  Throws in production if any REQUIRED var is missing. */
export function validateEnv(): void {
  const report = getEnvReport();
  const missing = report.filter((v) => v.required && !v.present);
  const presentRequired = report.filter((v) => v.required && v.present);
  const presentOptional = report.filter((v) => !v.required && v.present);
  const missingOptional = report.filter((v) => !v.required && !v.present);

  const isProduction = process.env["NODE_ENV"] === "production";

  // Group by category for readable output
  const byGroup: Record<string, EnvVarStatus[]> = {};
  for (const item of report) {
    (byGroup[item.group] ??= []).push(item);
  }

  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│           Environment Variables — Startup Report        │");
  console.log("└─────────────────────────────────────────────────────────┘");

  for (const [group, vars] of Object.entries(byGroup)) {
    console.log(`\n  ${group}`);
    for (const v of vars) {
      const icon   = v.present ? "✓" : (v.required ? "✗" : "○");
      const status = v.present ? "SET" : "MISSING";
      const req    = v.required ? "[REQUIRED]" : "[optional]";
      console.log(`  ${icon} ${v.key.padEnd(28)} ${status.padEnd(8)} ${req}`);
    }
  }

  console.log(`\n  Summary:`);
  console.log(`  ✓ Required present  : ${presentRequired.length}/${presentRequired.length + missing.length}`);
  console.log(`  ✓ Optional present  : ${presentOptional.length}`);
  console.log(`  ○ Optional missing  : ${missingOptional.length}`);
  if (missing.length > 0) {
    console.log(`  ✗ Required MISSING  : ${missing.length} — ${missing.map((v) => v.key).join(", ")}`);
  }
  console.log("─────────────────────────────────────────────────────────\n");

  if (missing.length > 0 && isProduction) {
    throw new Error(
      `[env] FATAL: The following required environment variables are not set:\n` +
      missing.map((v) => `  ✗ ${v.key} — ${v.description}`).join("\n") +
      `\n\nThe server cannot start in production without these variables.`,
    );
  }

  if (missing.length > 0 && !isProduction) {
    console.warn(
      `[env] WARNING: ${missing.length} required variable(s) are missing. ` +
      `The server may fail. Set them before deploying to production.\n`,
    );
  }
}
