/**
 * Intelligent Secrets Detector
 *
 * Scans a repository's analysis results and code to determine
 * exactly which credentials are required — no unnecessary prompts.
 */

import type { DetectedEnvVar, ProjectAnalysis } from "./types.js";

export interface SecretRequirement {
  key: string;
  description: string;
  category: DetectedEnvVar["category"];
  isRequired: boolean;
  reason: string;
  exampleValue: string;
}

const KNOWN_SECRETS: Array<{
  pattern: RegExp;
  key: string;
  description: string;
  category: DetectedEnvVar["category"];
  example: string;
  reason: string;
}> = [
  // AI Providers
  { pattern: /openai/i, key: "OPENAI_API_KEY", description: "OpenAI API key", category: "ai", example: "sk-...", reason: "OpenAI dependency detected" },
  { pattern: /anthropic/i, key: "ANTHROPIC_API_KEY", description: "Anthropic/Claude API key", category: "ai", example: "sk-ant-...", reason: "Anthropic dependency detected" },
  { pattern: /openrouter/i, key: "OPENROUTER_API_KEY", description: "OpenRouter API key", category: "ai", example: "sk-or-...", reason: "OpenRouter dependency detected" },
  { pattern: /google-genai|@google\/generative-ai|gemini/i, key: "GEMINI_API_KEY", description: "Google Gemini API key", category: "ai", example: "AIzaSy...", reason: "Google AI dependency detected" },
  { pattern: /groq-sdk|groq/i, key: "GROQ_API_KEY", description: "Groq API key", category: "ai", example: "gsk_...", reason: "Groq dependency detected" },
  { pattern: /cohere/i, key: "COHERE_API_KEY", description: "Cohere API key", category: "ai", example: "...", reason: "Cohere dependency detected" },

  // Databases
  { pattern: /pg|postgres/i, key: "DATABASE_URL", description: "PostgreSQL connection string", category: "database", example: "postgresql://user:pass@host:5432/db", reason: "PostgreSQL dependency detected" },
  { pattern: /mysql2|mysql/i, key: "DATABASE_URL", description: "MySQL connection string", category: "database", example: "mysql://user:pass@host:3306/db", reason: "MySQL dependency detected" },
  { pattern: /mongoose|mongodb/i, key: "MONGODB_URI", description: "MongoDB connection string", category: "database", example: "mongodb+srv://...", reason: "MongoDB dependency detected" },
  { pattern: /redis|ioredis/i, key: "REDIS_URL", description: "Redis connection string", category: "database", example: "redis://localhost:6379", reason: "Redis dependency detected" },
  { pattern: /@supabase\/supabase-js/i, key: "SUPABASE_URL", description: "Supabase project URL", category: "database", example: "https://xxx.supabase.co", reason: "Supabase dependency detected" },
  { pattern: /@supabase\/supabase-js/i, key: "SUPABASE_ANON_KEY", description: "Supabase anon key", category: "database", example: "eyJ...", reason: "Supabase dependency detected" },
  { pattern: /prisma/i, key: "DATABASE_URL", description: "Database connection string (Prisma)", category: "database", example: "postgresql://...", reason: "Prisma ORM detected" },

  // Payments
  { pattern: /stripe/i, key: "STRIPE_SECRET_KEY", description: "Stripe secret key", category: "payment", example: "sk_live_...", reason: "Stripe dependency detected" },
  { pattern: /stripe/i, key: "STRIPE_PUBLISHABLE_KEY", description: "Stripe publishable key", category: "payment", example: "pk_live_...", reason: "Stripe dependency detected" },

  // Email
  { pattern: /resend/i, key: "RESEND_API_KEY", description: "Resend API key", category: "email", example: "re_...", reason: "Resend dependency detected" },
  { pattern: /nodemailer|@sendgrid/i, key: "SENDGRID_API_KEY", description: "SendGrid API key", category: "email", example: "SG...", reason: "SendGrid dependency detected" },
  { pattern: /mailgun/i, key: "MAILGUN_API_KEY", description: "Mailgun API key", category: "email", example: "...", reason: "Mailgun dependency detected" },

  // Messaging
  { pattern: /twilio/i, key: "TWILIO_ACCOUNT_SID", description: "Twilio Account SID", category: "messaging", example: "AC...", reason: "Twilio dependency detected" },
  { pattern: /telegraf|node-telegram/i, key: "TELEGRAM_BOT_TOKEN", description: "Telegram Bot token", category: "messaging", example: "1234:ABC...", reason: "Telegram dependency detected" },

  // Storage
  { pattern: /@aws-sdk|aws-sdk/i, key: "AWS_ACCESS_KEY_ID", description: "AWS access key ID", category: "storage", example: "AKIA...", reason: "AWS SDK detected" },
  { pattern: /@aws-sdk|aws-sdk/i, key: "AWS_SECRET_ACCESS_KEY", description: "AWS secret access key", category: "storage", example: "...", reason: "AWS SDK detected" },
  { pattern: /cloudflare/i, key: "CLOUDFLARE_API_TOKEN", description: "Cloudflare API token", category: "deployment", example: "...", reason: "Cloudflare dependency detected" },
  { pattern: /firebase/i, key: "FIREBASE_PROJECT_ID", description: "Firebase project ID", category: "storage", example: "my-project", reason: "Firebase dependency detected" },

  // Auth
  { pattern: /jsonwebtoken|jose|jwt/i, key: "JWT_SECRET", description: "JWT signing secret", category: "other", example: "a-long-random-string", reason: "JWT library detected" },
  { pattern: /next-auth|@auth\/core/i, key: "NEXTAUTH_SECRET", description: "NextAuth secret", category: "other", example: "a-long-random-string", reason: "NextAuth detected" },
  { pattern: /next-auth|@auth\/core/i, key: "NEXTAUTH_URL", description: "NextAuth canonical URL", category: "other", example: "https://example.com", reason: "NextAuth detected" },
];

/**
 * Determine which secrets are required based on analysis results.
 * Only returns secrets that are actually needed by the project.
 */
export function detectRequiredSecrets(analysis: ProjectAnalysis): SecretRequirement[] {
  const results: SecretRequirement[] = [];
  const seenKeys = new Set<string>();

  const allDeps = {
    ...analysis.dependencies,
    ...analysis.devDependencies,
  };

  // 1. Cross-reference known secrets with detected dependencies
  for (const known of KNOWN_SECRETS) {
    const depMatch = Object.keys(allDeps).some((dep) => known.pattern.test(dep));
    if (!depMatch) continue;

    if (seenKeys.has(known.key)) continue;
    seenKeys.add(known.key);

    results.push({
      key: known.key,
      description: known.description,
      category: known.category,
      isRequired: true,
      reason: known.reason,
      exampleValue: known.example,
    });
  }

  // 2. Include env vars already detected from .env.example files
  for (const envVar of analysis.detectedEnvVars) {
    if (seenKeys.has(envVar.key)) continue;
    // Skip common non-secrets
    if (["PORT", "NODE_ENV", "HOST", "BASE_URL", "PUBLIC_URL", "NEXT_PUBLIC_URL"].includes(envVar.key)) continue;
    seenKeys.add(envVar.key);

    results.push({
      key: envVar.key,
      description: envVar.description,
      category: envVar.category,
      isRequired: envVar.isRequired,
      reason: `Found in ${envVar.source}`,
      exampleValue: envVar.exampleValue,
    });
  }

  // 3. Database-specific additions
  if (analysis.hasDatabase && !seenKeys.has("DATABASE_URL")) {
    results.push({
      key: "DATABASE_URL",
      description: "Database connection string",
      category: "database",
      isRequired: true,
      reason: "Database usage detected in repository",
      exampleValue: "postgresql://user:password@host:5432/database",
    });
  }

  // 4. Deployment platform secrets
  if (analysis.deploymentConfig) {
    for (const envKey of analysis.deploymentConfig.envVarsRequired) {
      if (seenKeys.has(envKey)) continue;
      seenKeys.add(envKey);
      results.push({
        key: envKey,
        description: `Required by ${analysis.deploymentConfig.platform} deployment`,
        category: "deployment",
        isRequired: false,
        reason: `${analysis.deploymentConfig.platform} deployment config detected`,
        exampleValue: "",
      });
    }
  }

  return results;
}

/**
 * Generate a .env.example file content from a list of secret requirements.
 */
export function generateEnvExample(secrets: SecretRequirement[]): string {
  const lines: string[] = [
    "# Environment Variables",
    "# Copy this file to .env and fill in the values",
    "# Generated by AI Agent Platform — Repository Agent",
    "",
  ];

  const byCategory = groupBy(secrets, (s) => s.category);
  const categoryOrder: SecretRequirement["category"][] = [
    "database", "ai", "github", "payment", "email", "messaging",
    "storage", "deployment", "monitoring", "other",
  ];

  for (const cat of categoryOrder) {
    const group = byCategory.get(cat);
    if (!group || group.length === 0) continue;

    lines.push(`# ${categoryLabel(cat)}`);
    for (const secret of group) {
      lines.push(`# ${secret.description}`);
      lines.push(`${secret.key}=${secret.exampleValue}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    github: "GitHub",
    ai: "AI Providers",
    database: "Database",
    storage: "Storage",
    payment: "Payments",
    email: "Email",
    messaging: "Messaging",
    deployment: "Deployment",
    monitoring: "Monitoring",
    other: "Other",
  };
  return labels[cat] ?? cat;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}
