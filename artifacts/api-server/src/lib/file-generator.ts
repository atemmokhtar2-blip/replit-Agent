/**
 * Production-Grade Fault-Tolerant Batch File Generator
 *
 * Architecture:
 *  - 9 batches (Config → Backend Server → Auth → Entity Routes → DB → Frontend Core →
 *    Layout → Pages → Lib Utilities)
 *  - 6 provider tiers with automatic fallback and credit-aware token sizing
 *  - Full error classification (402, 429, 5xx, timeout, parse, network)
 *  - Progress persistence to disk — resume from any batch on restart
 *  - 30-second watchdog — detects stalls and reports to UI
 *  - Immediate disk write + verification after every batch
 *  - Granular SSE progress events so the UI always shows what is happening
 *  - Final execution report with per-batch stats
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { ExecutionSpec } from "@workspace/ai-orchestrator";
import { providerManager } from "./provider-manager/index.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PROJECT_DIR_BASE = process.env["PROJECT_FILES_BASE"] ??
  (() => {
    const p = new URL(import.meta.url).pathname;
    const root = p.slice(0, p.indexOf("/artifacts/"));
    return root ? `${root}/data/projects` : "/tmp/projects";
  })();
const PER_MODEL_TIMEOUT_MS  = 55_000;   // 55 s hard cap per single model call
const WATCHDOG_INTERVAL_MS  = 30_000;   // alert after 30 s of silence
const MAX_RETRIES_PER_BATCH = 4;        // max provider switches per batch
const RATE_LIMIT_WAIT_MS    = 6_000;
const PROGRESS_FILE         = ".batchProgress.json";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SendFn = (data: Record<string, unknown>) => void;

export type ProviderErrorKind =
  | "insufficient_credits"   // 402
  | "auth_failed"            // 401 | 403
  | "rate_limited"           // 429
  | "timeout"               // 408 | 504 | AbortError
  | "server_error"           // 500 | 502 | 503
  | "parse_error"            // bad JSON
  | "incomplete_response"    // content too short
  | "network_error"
  | "unknown";

interface ProviderError {
  kind: ProviderErrorKind;
  message: string;
  statusCode?: number;
  retryable: boolean;
  waitMs: number;
}

interface ProviderConfig {
  model: string;
  tier: 1 | 2 | 3;
  defaultMaxTokens: number;
  minTokens: number;
}

interface BatchContext {
  isTS: boolean;
  isReact: boolean;
  isTW: boolean;
  isExpress: boolean;
  isDrizzle: boolean;
  ext: string;
  rExt: string;
  mainEntity: string;
  page1: string;
  page2: string;
  pageRoutes: string;
}

interface BatchPromptDef {
  system: string;
  user: string;
  maxTokens: number;
}

interface BatchDef {
  id: string;
  displayName: string;
  category: "config" | "backend" | "frontend" | "components" | "pages" | "assets";
  isStatic?: boolean;
  skipWhen?: (spec: ExecutionSpec) => boolean;
  buildPrompt?: (spec: ExecutionSpec, ctx: BatchContext) => BatchPromptDef;
}

export interface BatchProgress {
  conversationId: string;
  startedAt: string;
  lastProgressAt: string;
  completedBatches: string[];
  writtenFiles: string[];
  skippedBatches: string[];
  retryCount: number;
  providerLog: Array<{ model: string; batch: string; status: "ok" | "failed"; error?: string }>;
}

export interface BatchResult {
  batchId: string;
  batchName: string;
  filesWritten: string[];
  skipped: boolean;
  durationMs: number;
  providerUsed: string;
  retries: number;
  errors: string[];
}

export interface GenerationReport {
  projectDir: string;
  totalFiles: number;
  filesGenerated: number;
  filesSkipped: number;
  totalRetries: number;
  batchResults: BatchResult[];
  providersUsed: string[];
  durationMs: number;
  verificationResult: { verified: string[]; missing: string[]; totalBytes: number };
}

// ── Provider list (ordered by preference) ─────────────────────────────────────

const PROVIDERS: ProviderConfig[] = [
  { model: "moonshotai/kimi-k2",                    tier: 1, defaultMaxTokens: 4096, minTokens: 1024 },
  { model: "deepseek/deepseek-chat-v3-0324",         tier: 1, defaultMaxTokens: 4096, minTokens: 1024 },
  { model: "qwen/qwen-2.5-coder-32b-instruct",      tier: 2, defaultMaxTokens: 3072, minTokens: 768  },
  { model: "google/gemma-3-27b-it:free",            tier: 2, defaultMaxTokens: 2048, minTokens: 512  },
  { model: "meta-llama/llama-3.3-70b-instruct",     tier: 3, defaultMaxTokens: 2048, minTokens: 512  },
  { model: "mistralai/mistral-7b-instruct:free",    tier: 3, defaultMaxTokens: 1536, minTokens: 384  },
];

// ── JSON system prompt (shared across all LLM batches) ────────────────────────

const JSON_SYSTEM = `You are an expert software engineer producing production-ready source files.

STRICT OUTPUT RULES:
1. Return ONLY a valid JSON object — nothing else.
2. Keys = relative file paths (e.g. "server/index.ts")
3. Values = the COMPLETE file content as a string (no truncation)
4. No markdown fences, no prose, no comments outside the JSON.
5. Every file must have real, working code. No TODOs. No placeholders.
6. Start your response with { and end with }`;

// ── Batch definitions ─────────────────────────────────────────────────────────

const BATCHES: BatchDef[] = [

  // ── B1: Config (static — no LLM) ───────────────────────────────────────────
  {
    id: "config",
    displayName: "Writing configuration files",
    category: "config",
    isStatic: true,
  },

  // ── B2: Backend server entry + app ─────────────────────────────────────────
  {
    id: "backend-server",
    displayName: "Generating backend server",
    category: "backend",
    skipWhen: (s) => s.understanding?.backend?.required === false,
    buildPrompt: (spec, ctx) => ({
      system: JSON_SYSTEM,
      user: `Generate exactly 2 backend files for this project.

PROJECT: ${spec.projectType}
SUMMARY: ${spec.summary.slice(0, 120)}
TECH: ${spec.techStack.slice(0, 4).join(", ")}
MAIN ENTITY: ${ctx.mainEntity}

{
  "server/index.${ctx.ext}": "${ctx.isTS ? "TypeScript" : "ESM JS"} Express entry: imports app from './app.js', reads PORT from process.env.PORT defaulting to 3000, calls app.listen, logs startup message.",
  "server/app.${ctx.ext}": "${ctx.isTS ? "TypeScript" : "ESM JS"} Express app: imports cors and express, imports authRouter from './routes/auth.js' and ${ctx.mainEntity}Router from './routes/${ctx.mainEntity}.js', applies cors() and express.json() middleware, mounts /api/auth and /api/${ctx.mainEntity} routes, adds catch-all error handler that returns JSON, exports default app."
}`,
      maxTokens: 2048,
    }),
  },

  // ── B3: Auth routes ─────────────────────────────────────────────────────────
  {
    id: "backend-auth",
    displayName: "Generating authentication routes",
    category: "backend",
    skipWhen: (s) => s.understanding?.backend?.required === false,
    buildPrompt: (spec, ctx) => ({
      system: JSON_SYSTEM,
      user: `Generate 1 file: the authentication router for this project.

PROJECT: ${spec.projectType}
TECH: ${ctx.isTS ? "TypeScript" : "ESM JavaScript"}, Express, bcryptjs, jsonwebtoken

{
  "server/routes/auth.${ctx.ext}": "Express Router with POST /register (hash password with bcryptjs, store user in memory array, return signed JWT) and POST /login (find user, compare password, return JWT). Uses JWT_SECRET env var. Import Router from express. Export default router. Include all required imports. Full working code."
}`,
      maxTokens: 3072,
    }),
  },

  // ── B4: Entity routes + auth middleware ─────────────────────────────────────
  {
    id: "backend-routes",
    displayName: "Generating API routes",
    category: "backend",
    skipWhen: (s) => s.understanding?.backend?.required === false,
    buildPrompt: (spec, ctx) => {
      const entity = ctx.mainEntity;
      const fields = spec.dbSchema[0]?.columns.slice(0, 5).map(c => c.name).join(", ") || "id, title, createdAt";
      return {
        system: JSON_SYSTEM,
        user: `Generate 2 backend files.

PROJECT: ${spec.projectType}
ENTITY: ${entity} (fields: ${fields})

{
  "server/routes/${entity}.${ctx.ext}": "${ctx.isTS ? "TypeScript" : "ESM JS"} Express Router with full CRUD: GET / (list all), POST / (create), GET /:id, PUT /:id (update), DELETE /:id. Uses in-memory array as data store. Applies authMiddleware imported from '../middleware/auth.js'. Export default router.",
  "server/middleware/auth.${ctx.ext}": "${ctx.isTS ? "TypeScript with Express Request augmentation declaring req.user" : "ESM JS"} JWT verification middleware: reads Authorization: Bearer <token>, verifies with jsonwebtoken using JWT_SECRET env, sets req.user to payload, calls next() on success, returns 401 JSON on failure."
}`,
        maxTokens: 3072,
      };
    },
  },

  // ── B5: DB schema + auth utilities ─────────────────────────────────────────
  {
    id: "backend-db",
    displayName: "Generating database layer",
    category: "backend",
    skipWhen: (s) => s.understanding?.backend?.required === false,
    buildPrompt: (spec, ctx) => {
      const tables = spec.dbSchema.slice(0, 3);
      const tableDesc = tables.length > 0
        ? tables.map(t => `${t.name}(${t.columns.slice(0, 4).map(c => c.name).join(",")})`).join("; ")
        : `${ctx.mainEntity}(id, title, userId, createdAt)`;
      return {
        system: JSON_SYSTEM,
        user: `Generate 2 utility files.

PROJECT: ${spec.projectType}
TABLES: ${tableDesc}

{
  "server/lib/auth.${ctx.ext}": "${ctx.isTS ? "TypeScript" : "ESM JS"} auth utilities: import bcryptjs and jsonwebtoken. Export async hashPassword(plain: string): Promise<string> using bcrypt.hash with 10 rounds. Export async comparePassword(plain: string, hash: string): Promise<boolean>. Export signToken(payload: object): string using jwt.sign with JWT_SECRET and 24h expiry. Export verifyToken(token: string): object using jwt.verify.",
  "server/db/schema.${ctx.ext}": "${ctx.isDrizzle ? "Drizzle ORM" : "Plain SQL"} schema definitions for tables: ${tableDesc}. ${ctx.isTS ? "TypeScript." : "ESM JS."} Include proper column types and primary keys."
}`,
        maxTokens: 2048,
      };
    },
  },

  // ── B6: Frontend core (main entry + App + global CSS) ──────────────────────
  {
    id: "frontend-core",
    displayName: "Generating frontend core",
    category: "frontend",
    skipWhen: (s) => s.understanding?.frontend?.required === false,
    buildPrompt: (spec, ctx) => ({
      system: JSON_SYSTEM,
      user: `Generate 3 frontend files.

PROJECT: ${spec.projectType}
PAGES: ${ctx.pageRoutes}
STYLING: ${ctx.isTW ? "Tailwind CSS" : "plain CSS"}

{
  "src/main.${ctx.rExt}": "${ctx.isTS ? "TypeScript React" : "JSX"} entry: import React, ReactDOM, BrowserRouter, App, './index.css'. Use ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>). Full working code.",
  "src/App.${ctx.rExt}": "${ctx.isTS ? "TypeScript React.FC" : "JSX"} App component: imports Routes, Route from react-router-dom, imports Layout, imports all page components. Creates routes for: ${ctx.pageRoutes}. Wraps all routes in <Layout>. Full working JSX.",
  "src/index.css": "${ctx.isTW ? "@tailwind base;\\n@tailwind components;\\n@tailwind utilities;\\n\\nbody { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }" : "body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; color: #111; } * { box-sizing: border-box; }"}"
}`,
      maxTokens: 3072,
    }),
  },

  // ── B7: Layout + Navbar ─────────────────────────────────────────────────────
  {
    id: "frontend-layout",
    displayName: "Generating layout components",
    category: "components",
    skipWhen: (s) => s.understanding?.frontend?.required === false,
    buildPrompt: (spec, ctx) => ({
      system: JSON_SYSTEM,
      user: `Generate 2 React component files.

PROJECT: ${spec.projectType}
NAV ROUTES: ${ctx.pageRoutes}
AUTH: ${spec.understanding?.auth?.required ? "yes — include login/logout" : "no"}
STYLING: ${ctx.isTW ? "Tailwind CSS utility classes" : "inline styles or plain CSS classes"}

{
  "src/components/Layout.${ctx.rExt}": "${ctx.isTS ? "TypeScript React.FC<{children: React.ReactNode}>" : "JSX function"} Layout: imports Navbar. Returns <div> with <Navbar /> and <main>{children}</main>. ${ctx.isTW ? "Tailwind: min-h-screen bg-gray-50. Main: max-w-7xl mx-auto px-4 py-6." : "Clean flex column layout."}",
  "src/components/Navbar.${ctx.rExt}": "${ctx.isTS ? "TypeScript React.FC" : "JSX function"} Navbar: imports Link from react-router-dom. Shows brand name '${spec.projectType}' on left. Nav links on right for each page: ${ctx.pageRoutes}. ${spec.understanding?.auth?.required ? "Login button that links to /login." : ""} ${ctx.isTW ? "Tailwind: bg-white border-b shadow-sm px-6 py-3 flex items-center justify-between." : "Simple horizontal nav with spacing."} Full working JSX."
}`,
      maxTokens: 3072,
    }),
  },

  // ── B8: Pages ────────────────────────────────────────────────────────────────
  {
    id: "frontend-pages",
    displayName: "Generating pages",
    category: "pages",
    skipWhen: (s) => s.understanding?.frontend?.required === false,
    buildPrompt: (spec, ctx) => ({
      system: JSON_SYSTEM,
      user: `Generate 2 React page components.

PROJECT: ${spec.projectType}
STYLING: ${ctx.isTW ? "Tailwind CSS utility classes" : "plain CSS"}

{
  "src/pages/${ctx.page1}Page.${ctx.rExt}": "${ctx.isTS ? "TypeScript React.FC" : "JSX function"} ${ctx.page1} page: Hero section with a bold heading relevant to ${spec.projectType}, subheading, and a prominent CTA button. Below that: a grid of 3-4 feature cards each with an icon emoji, title, and description relevant to the project. ${ctx.isTW ? "Tailwind: bg-gradient-to-br from-indigo-50 to-white, cards with rounded-xl shadow p-6." : "Real CSS with styled sections."} Full working JSX with real content.",
  "src/pages/${ctx.page2}Page.${ctx.rExt}": "${ctx.isTS ? "TypeScript React.FC" : "JSX function"} ${ctx.page2} page: Shows a stats row at top (3 stat cards: Total, Active, Recent). Below: a table or card list displaying ${spec.dbSchema[0]?.name ?? ctx.mainEntity} data with mock data array (3-5 rows). Each row shows key fields. ${ctx.isTW ? "Tailwind: bg-white rounded-xl shadow, table with divide-y." : "Clean table with borders."} Full working JSX."
}`,
      maxTokens: 3072,
    }),
  },

  // ── B9: Frontend utilities ───────────────────────────────────────────────────
  {
    id: "frontend-lib",
    displayName: "Generating frontend utilities",
    category: "assets",
    skipWhen: (s) => s.understanding?.frontend?.required === false,
    buildPrompt: (spec, ctx) => ({
      system: JSON_SYSTEM,
      user: `Generate 2 frontend utility files.

PROJECT: ${spec.projectType}

{
  "src/lib/api.${ctx.ext}": "${ctx.isTS ? "TypeScript" : "ESM JS"} API client: const API_BASE = '/api'. ${ctx.isTS ? "type Opts = RequestInit & { data?: unknown };" : ""} Export async function apiFetch${ctx.isTS ? "<T>(path: string, opts: Opts = {}): Promise<T>" : "(path, opts = {})"} { const token = localStorage.getItem('authToken'); const res = await fetch(API_BASE + path, { method: opts.method ?? 'GET', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...opts.headers }, body: opts.data ? JSON.stringify(opts.data) : undefined }); if (!res.ok) throw new Error(await res.text()); return res.json(); }. Export get, post, put, del helpers calling apiFetch.",
  "src/hooks/useAuth.${ctx.ext}": "${ctx.isTS ? "TypeScript" : "ESM JS"} React hook: import useState from react. ${ctx.isTS ? "interface User { id: string; email: string; username?: string }" : ""} const useAuth = () => { const [user, setUser] = ${ctx.isTS ? "useState<User | null>(null)" : "useState(null)"}; const login = (token${ctx.isTS ? ": string" : ""}, userData${ctx.isTS ? ": User" : ""}) => { localStorage.setItem('authToken', token); setUser(userData); }; const logout = () => { localStorage.removeItem('authToken'); setUser(null); }; return { user, login, logout, isAuthenticated: !!user }; }; export default useAuth;"
}`,
      maxTokens: 2048,
    }),
  },
];

// ── Error classification ──────────────────────────────────────────────────────

function classifyError(err: unknown, statusCode?: number): ProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (statusCode === 402) return { kind: "insufficient_credits", message: "Insufficient credits (402)", statusCode: 402, retryable: true, waitMs: 0 };
  if (statusCode === 401 || statusCode === 403) return { kind: "auth_failed",            message: `Auth error ${statusCode}`,   statusCode, retryable: false, waitMs: 0 };
  if (statusCode === 429) return { kind: "rate_limited",          message: "Rate limited (429)",           statusCode: 429, retryable: true,  waitMs: RATE_LIMIT_WAIT_MS };
  if (statusCode === 408 || statusCode === 504) return { kind: "timeout",               message: `Timeout ${statusCode}`,        statusCode, retryable: true,  waitMs: 0 };
  if (statusCode && statusCode >= 500) return { kind: "server_error",         message: `Server error ${statusCode}`,   statusCode, retryable: true,  waitMs: 1_000 };
  if (lower.includes("abort") || lower.includes("timeout"))      return { kind: "timeout",               message: msg, retryable: true,  waitMs: 0 };
  if (lower.includes("econnrefused") || lower.includes("fetch") || lower.includes("network")) return { kind: "network_error", message: msg, retryable: true,  waitMs: 2_000 };
  if (lower.includes("json") || lower.includes("parse"))         return { kind: "parse_error",           message: msg, retryable: true,  waitMs: 0 };
  return { kind: "unknown",                   message: msg, retryable: true,  waitMs: 1_000 };
}

// ── JSON extractor (resilient) ────────────────────────────────────────────────

function extractJsonFileMap(raw: string): Record<string, string> {
  const trimmed = raw.trim();

  // Direct parse
  try { const p = JSON.parse(trimmed); if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, string>; } catch { /**/ }

  // Strip markdown fences
  const stripped = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { const p = JSON.parse(stripped); if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, string>; } catch { /**/ }

  // Extract first balanced JSON object
  let depth = 0, start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const candidate = trimmed.slice(start, i + 1);
          const p = JSON.parse(candidate);
          if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, string>;
        } catch { /**/ }
        break;
      }
    }
  }

  return {};
}

// ── File writer (safe, creates parent dirs) ───────────────────────────────────

async function writeFiles(projectDir: string, files: Record<string, string>): Promise<string[]> {
  const written: string[] = [];
  for (const [filePath, content] of Object.entries(files)) {
    if (!filePath || typeof content !== "string" || content.length < 2) continue;
    const safe = filePath.replace(/\.\.[/\\]/g, "").replace(/^[/\\]+/, "").trim();
    if (!safe) continue;
    const full = path.join(projectDir, safe);
    if (!full.startsWith(projectDir + path.sep) && full !== projectDir) continue;
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
    written.push(safe);
  }
  return written;
}

// ── Verify files exist on disk ────────────────────────────────────────────────

async function verifyFiles(
  projectDir: string,
  files: string[],
): Promise<{ verified: string[]; missing: string[]; totalBytes: number }> {
  const verified: string[] = [], missing: string[] = [];
  let totalBytes = 0;
  for (const f of files) {
    try {
      const s = await fs.stat(path.join(projectDir, f));
      totalBytes += s.size;
      verified.push(f);
    } catch { missing.push(f); }
  }
  return { verified, missing, totalBytes };
}

// ── Progress persistence ──────────────────────────────────────────────────────

async function loadProgress(projectDir: string): Promise<BatchProgress | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir, PROGRESS_FILE), "utf8");
    return JSON.parse(raw) as BatchProgress;
  } catch { return null; }
}

async function saveProgress(projectDir: string, p: BatchProgress): Promise<void> {
  p.lastProgressAt = new Date().toISOString();
  await fs.writeFile(path.join(projectDir, PROGRESS_FILE), JSON.stringify(p, null, 2), "utf8")
    .catch(() => { /* non-fatal */ });
}

// ── Single provider call — providerManager first, direct OpenRouter fallback ───

interface LLMResult { content: string; model: string }

async function callProvider(provider: ProviderConfig, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  // Try providerManager first (uses DB-stored encrypted keys with health tracking).
  try {
    const result = await providerManager.complete(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { model: provider.model, maxTokens, temperature: 0.15, taskType: "code-gen" },
    );
    if (!result.content || result.content.length < 5) {
      const pe: ProviderError = { kind: "incomplete_response", message: "Response too short", retryable: true, waitMs: 0 };
      throw Object.assign(new Error("Incomplete response"), { providerError: pe });
    }
    return { content: result.content, model: result.model };
  } catch (_managerErr) {
    // Fall back to direct OpenRouter call using the OPENROUTER_API_KEY env var.
    // This works when no keys have been added via the UI yet.
    const apiKey = process.env["OPENROUTER_API_KEY"];
    if (!apiKey) throw _managerErr;

    let resp: Response;
    try {
      resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://ai-agent-platform.replit.app",
          "X-Title": "AI-Agent-File-Generator",
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: maxTokens,
          temperature: 0.15,
        }),
        signal: AbortSignal.timeout(PER_MODEL_TIMEOUT_MS),
      });
    } catch (fetchErr) {
      const pe: ProviderError = classifyError(fetchErr);
      throw Object.assign(
        fetchErr instanceof Error ? fetchErr : new Error(String(fetchErr)),
        { providerError: pe },
      );
    }

    if (!resp.ok) {
      const pe: ProviderError = classifyError(new Error(`HTTP ${resp.status}`), resp.status);
      const body = await resp.text().catch(() => "");
      throw Object.assign(
        new Error(`OpenRouter ${resp.status}: ${body.slice(0, 100)}`),
        { providerError: pe },
      );
    }

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      model?: string;
    };
    const content = data.choices?.[0]?.message?.content ?? "";

    if (!content || content.length < 5) {
      const pe: ProviderError = { kind: "incomplete_response", message: "Response too short", retryable: true, waitMs: 0 };
      throw Object.assign(new Error("Incomplete response from OpenRouter"), { providerError: pe });
    }

    return { content, model: data.model ?? provider.model };
  }
}

// ── BatchFileGenerator ────────────────────────────────────────────────────────

export class BatchFileGenerator {
  private readonly projectDir: string;
  private readonly conversationId: string;
  private readonly send: SendFn;
  private progress!: BatchProgress;
  private batchResults: BatchResult[] = [];

  // Watchdog state
  private lastTick = Date.now();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private currentBatchName = "initializing";

  // Provider state — credit exhaustion tracked per-provider per-session
  private providerMaxTokens: Map<string, number> = new Map(
    PROVIDERS.map(p => [p.model, p.defaultMaxTokens]),
  );
  private exhaustedProviders: Set<string> = new Set();

  constructor(conversationId: string, send: SendFn) {
    this.conversationId = conversationId;
    this.projectDir = path.join(PROJECT_DIR_BASE, conversationId);
    this.send = send;
  }

  // ── Public entry point ────────────────────────────────────────────────────

  async run(spec: ExecutionSpec): Promise<GenerationReport> {
    const t0 = Date.now();

    await fs.mkdir(this.projectDir, { recursive: true });

    // Resume support — load persisted progress
    const saved = await loadProgress(this.projectDir);
    if (saved?.conversationId === this.conversationId && saved.completedBatches.length > 0) {
      this.progress = saved;
      this.emit("file_gen_progress", {
        message: `Resuming from batch ${saved.completedBatches.length}/${BATCHES.length} already complete`,
      });
      console.log(`[FileGen] Resuming: ${saved.completedBatches.length} batches already done`);
    } else {
      this.progress = {
        conversationId: this.conversationId,
        startedAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        completedBatches: [],
        writtenFiles: [],
        skippedBatches: [],
        retryCount: 0,
        providerLog: [],
      };
    }

    const ctx = this.buildContext(spec);
    await this.ensureDirectories();
    this.startWatchdog();

    try {
      for (const batch of BATCHES) {
        await this.processBatch(batch, spec, ctx);
      }
    } finally {
      this.stopWatchdog();
    }

    // Final verification
    const allFiles = [...new Set(this.progress.writtenFiles)];
    const verification = await verifyFiles(this.projectDir, allFiles);

    const report: GenerationReport = {
      projectDir: this.projectDir,
      totalFiles: allFiles.length,
      filesGenerated: this.batchResults.reduce((s, b) => s + b.filesWritten.length, 0),
      filesSkipped: this.batchResults.filter(b => b.skipped).length,
      totalRetries: this.progress.retryCount,
      batchResults: this.batchResults,
      providersUsed: [...new Set(this.batchResults.map(b => b.providerUsed).filter(p => p !== "none" && p !== "static"))],
      durationMs: Date.now() - t0,
      verificationResult: verification,
    };

    this.emit("file_gen_report", { report });
    console.log(
      `[FileGen] Complete — ${report.filesGenerated} files · ${report.totalRetries} retries · ` +
      `${(report.durationMs / 1000).toFixed(1)}s · providers: ${report.providersUsed.join(", ")}`,
    );

    return report;
  }

  // ── Process one batch ─────────────────────────────────────────────────────

  private async processBatch(batch: BatchDef, spec: ExecutionSpec, ctx: BatchContext): Promise<void> {
    // Already done in a previous run → skip
    if (this.progress.completedBatches.includes(batch.id)) {
      console.log(`[FileGen] Batch ${batch.id}: already complete`);
      this.emit("file_gen_progress", { message: `Skipping ${batch.displayName} (already complete)` });
      return;
    }

    // Conditional skip
    if (batch.skipWhen?.(spec)) {
      console.log(`[FileGen] Batch ${batch.id}: skipped by condition`);
      this.progress.skippedBatches.push(batch.id);
      this.progress.completedBatches.push(batch.id);
      this.batchResults.push({ batchId: batch.id, batchName: batch.displayName, filesWritten: [], skipped: true, durationMs: 0, providerUsed: "none", retries: 0, errors: [] });
      await saveProgress(this.projectDir, this.progress);
      return;
    }

    const batchStart = Date.now();
    this.currentBatchName = batch.displayName;
    this.tick();

    this.emit("file_gen_batch_start", { batchId: batch.id, batchName: batch.displayName });
    console.log(`[FileGen] → ${batch.displayName}`);

    // Static batch — no LLM
    if (batch.isStatic) {
      const written = await this.runStaticBatch(spec, ctx);
      this.recordBatchDone(batch, written, Date.now() - batchStart, "static", 0, []);
      return;
    }

    // LLM batch
    if (!batch.buildPrompt) {
      console.warn(`[FileGen] Batch ${batch.id}: no buildPrompt — skipping`);
      this.recordBatchDone(batch, [], Date.now() - batchStart, "none", 0, ["no prompt"]);
      return;
    }

    const promptDef = batch.buildPrompt(spec, ctx);
    const { filesWritten, providerUsed, retries, errors } = await this.runLLMBatch(
      batch.id, promptDef.system, promptDef.user, promptDef.maxTokens,
    );

    this.recordBatchDone(batch, filesWritten, Date.now() - batchStart, providerUsed, retries, errors);
  }

  // ── LLM batch with full retry / fallback loop ─────────────────────────────

  private async runLLMBatch(
    batchId: string,
    system: string,
    user: string,
    initialMaxTokens: number,
  ): Promise<{ filesWritten: string[]; providerUsed: string; retries: number; errors: string[] }> {
    const errors: string[] = [];
    let retries = 0;
    let providerIndex = 0;

    while (providerIndex < PROVIDERS.length && retries < MAX_RETRIES_PER_BATCH) {
      const provider = PROVIDERS[providerIndex]!;

      if (this.exhaustedProviders.has(provider.model)) { providerIndex++; continue; }

      const maxTokens = Math.min(
        this.providerMaxTokens.get(provider.model) ?? provider.defaultMaxTokens,
        initialMaxTokens,
      );

      this.emit("file_gen_progress", { message: `${this.currentBatchName} via ${provider.model}...` });
      this.tick();

      let result: LLMResult;
      try {
        result = await callProvider(provider, system, user, maxTokens);
      } catch (rawErr) {
        const pe: ProviderError = (rawErr as { providerError?: ProviderError }).providerError
          ?? classifyError(rawErr);

        const label = `${provider.model}[${pe.kind}]: ${pe.message.slice(0, 60)}`;
        errors.push(label);
        this.progress.providerLog.push({ model: provider.model, batch: batchId, status: "failed", error: pe.message.slice(0, 100) });
        console.warn(`[FileGen] ✗ ${batchId} via ${provider.model}: ${pe.kind} — ${pe.message.slice(0, 80)}`);

        if (!pe.retryable || pe.kind === "auth_failed") {
          throw new Error(`Fatal provider error: ${pe.message}`);
        }

        if (pe.kind === "insufficient_credits") {
          const current = this.providerMaxTokens.get(provider.model) ?? provider.defaultMaxTokens;
          const reduced = Math.max(provider.minTokens, Math.floor(current * 0.55));
          if (reduced < current) {
            this.providerMaxTokens.set(provider.model, reduced);
            this.emit("file_gen_progress", {
              message: `Reducing generation size to ${reduced} tokens, retrying...`,
            });
            retries++;
            this.progress.retryCount++;
            continue; // retry same provider with fewer tokens
          }
          // Even min tokens rejected → mark exhausted, next provider
          this.exhaustedProviders.add(provider.model);
          this.emit("file_gen_progress", { message: `${provider.model} credits exhausted, switching provider...` });
          providerIndex++;
          continue;
        }

        if (pe.kind === "rate_limited") {
          this.emit("file_gen_progress", { message: `Rate limited — waiting ${pe.waitMs / 1000}s...` });
          await new Promise(r => setTimeout(r, pe.waitMs));
          retries++;
          this.progress.retryCount++;
          this.tick();
          continue;
        }

        // Timeout / server error / network / parse → try next provider
        retries++;
        this.progress.retryCount++;
        providerIndex++;
        this.emit("file_gen_progress", { message: `Switching to next provider (attempt ${retries})...` });
        continue;
      }

      // ── Success: parse, write, verify ────────────────────────────────────
      this.tick();
      const filesMap = extractJsonFileMap(result.content);
      const fileCount = Object.keys(filesMap).length;

      if (fileCount === 0) {
        // Unparseable response — treat as parse error and retry
        errors.push(`${provider.model}: empty file map (parse error)`);
        this.progress.providerLog.push({ model: provider.model, batch: batchId, status: "failed", error: "empty file map" });
        console.warn(`[FileGen] ✗ ${batchId} via ${provider.model}: no files parsed from response`);
        retries++;
        this.progress.retryCount++;
        providerIndex++;
        this.emit("file_gen_progress", { message: `Response unreadable — trying next provider...` });
        continue;
      }

      // Write immediately to disk
      const written = await writeFiles(this.projectDir, filesMap);
      this.progress.writtenFiles.push(...written);
      this.progress.providerLog.push({ model: provider.model, batch: batchId, status: "ok" });
      this.tick();

      // Verify each file exists
      const vResult = await verifyFiles(this.projectDir, written);
      if (vResult.missing.length > 0) {
        console.warn(`[FileGen] ✗ ${batchId}: ${vResult.missing.length} files missing after write`);
      }

      console.log(`[FileGen] ✓ ${batchId}: wrote ${written.length} files via ${provider.model} (${vResult.totalBytes} bytes)`);
      this.emit("file_gen_progress", { message: `✓ ${this.currentBatchName} — ${written.length} files written` });

      await saveProgress(this.projectDir, this.progress);
      return { filesWritten: written, providerUsed: provider.model, retries, errors };
    }

    // All providers exhausted for this batch
    console.warn(`[FileGen] ✗ Batch ${batchId} failed after ${retries} retries — continuing`);
    this.emit("file_gen_progress", {
      message: `⚠ ${this.currentBatchName} incomplete (all providers failed) — continuing`,
    });
    await saveProgress(this.projectDir, this.progress);
    return { filesWritten: [], providerUsed: "none", retries, errors };
  }

  // ── Static config batch (no LLM required) ────────────────────────────────

  private async runStaticBatch(spec: ExecutionSpec, ctx: BatchContext): Promise<string[]> {
    this.emit("file_gen_progress", { message: "Writing configuration files..." });
    const files: Record<string, string> = {};

    // ── package.json ────────────────────────────────────────────────────────
    const deps: Record<string, string> = {
      express: "^5.0.1",
      cors: "^2.8.5",
      bcryptjs: "^2.4.3",
      jsonwebtoken: "^9.0.2",
    };
    if (ctx.isDrizzle) deps["drizzle-orm"] = "^0.30.10";
    if (ctx.isReact) {
      deps["react"] = "^18.3.1";
      deps["react-dom"] = "^18.3.1";
      deps["react-router-dom"] = "^6.26.0";
    }
    const devDeps: Record<string, string> = { tsx: "^4.19.0" };
    if (ctx.isTS) {
      devDeps["typescript"]       = "^5.5.0";
      devDeps["@types/node"]      = "^22.0.0";
      devDeps["@types/express"]   = "^5.0.0";
      devDeps["@types/cors"]      = "^2.8.17";
      devDeps["@types/bcryptjs"]  = "^2.4.6";
      devDeps["@types/jsonwebtoken"] = "^9.0.7";
    }
    if (ctx.isReact) {
      devDeps["vite"]                = "^5.4.0";
      devDeps["@vitejs/plugin-react"] = "^4.3.0";
    }
    if (ctx.isTW) {
      devDeps["tailwindcss"] = "^3.4.0";
      devDeps["postcss"]     = "^8.4.0";
      devDeps["autoprefixer"] = "^10.4.0";
    }

    files["package.json"] = JSON.stringify({
      name: spec.projectType.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      version: "1.0.0",
      type: "module",
      scripts: {
        dev: ctx.isReact ? "vite" : `tsx watch server/index.${ctx.ext}`,
        build: ctx.isReact ? `tsc -b && vite build` : `tsc`,
        preview: "vite preview",
        start: `node dist/index.js`,
      },
      dependencies: deps,
      devDependencies: devDeps,
    }, null, 2);

    // ── tsconfig.json ────────────────────────────────────────────────────────
    if (ctx.isTS) {
      files["tsconfig.json"] = JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          skipLibCheck: true,
          outDir: "dist",
          ...(ctx.isReact ? { jsx: "react-jsx" } : {}),
        },
        include: ctx.isReact ? ["src"] : ["server"],
        exclude: ["node_modules", "dist"],
      }, null, 2);
    }

    // ── vite.config ──────────────────────────────────────────────────────────
    if (ctx.isReact) {
      files[`vite.config.${ctx.ext}`] =
        `import { defineConfig } from 'vite';\n` +
        `import react from '@vitejs/plugin-react';\n\n` +
        `export default defineConfig({\n` +
        `  plugins: [react()],\n` +
        `  server: {\n` +
        `    port: 5173,\n` +
        `    host: true,\n` +
        `    allowedHosts: true,\n` +
        `    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },\n` +
        `  },\n` +
        `});\n`;
    }

    // ── index.html ───────────────────────────────────────────────────────────
    if (ctx.isReact) {
      files["index.html"] =
        `<!DOCTYPE html>\n<html lang="en">\n<head>\n` +
        `  <meta charset="UTF-8" />\n` +
        `  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
        `  <title>${spec.projectType}</title>\n` +
        `</head>\n<body>\n` +
        `  <div id="root"></div>\n` +
        `  <script type="module" src="/src/main.${ctx.rExt}"></script>\n` +
        `</body>\n</html>\n`;
    }

    // ── tailwind + postcss ────────────────────────────────────────────────────
    if (ctx.isTW) {
      files[`tailwind.config.${ctx.ext}`] =
        `/** @type {import('tailwindcss').Config} */\n` +
        `export default {\n` +
        `  content: ['./index.html', './src/**/*.{${ctx.isTS ? "ts,tsx" : "js,jsx"}}'],\n` +
        `  theme: { extend: {} },\n` +
        `  plugins: [],\n` +
        `};\n`;
      files[`postcss.config.${ctx.ext}`] =
        `export default {\n` +
        `  plugins: { tailwindcss: {}, autoprefixer: {} },\n` +
        `};\n`;
    }

    // ── .env.example ─────────────────────────────────────────────────────────
    files[".env.example"] =
      `DATABASE_URL=postgresql://user:password@localhost:5432/app_db\n` +
      `JWT_SECRET=change-me-in-production\n` +
      `PORT=3000\n`;

    // ── .gitignore ────────────────────────────────────────────────────────────
    files[".gitignore"] = `node_modules/\ndist/\n.env\n*.log\n.DS_Store\ncoverage/\n`;

    // ── README.md ─────────────────────────────────────────────────────────────
    const techList = spec.techStack.slice(0, 6).join(", ");
    files["README.md"] =
      `# ${spec.summary.slice(0, 80)}\n\n` +
      `## Tech Stack\n${techList}\n\n` +
      `## Quick Start\n` +
      `\`\`\`bash\nnpm install\ncp .env.example .env\nnpm run dev\n\`\`\`\n\n` +
      `## Environment Variables\nSee \`.env.example\` for required variables.\n`;

    const written = await writeFiles(this.projectDir, files);
    this.progress.writtenFiles.push(...written);
    console.log(`[FileGen] Config batch: wrote ${written.length} files`);
    return written;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildContext(spec: ExecutionSpec): BatchContext {
    const isTS      = spec.techStack.some(t => /typescript/i.test(t));
    const isReact   = spec.techStack.some(t => /react/i.test(t));
    const isTW      = spec.techStack.some(t => /tailwind/i.test(t));
    const isExpress = spec.techStack.some(t => /express/i.test(t));
    const isDrizzle = spec.techStack.some(t => /drizzle/i.test(t));
    const ext       = isTS ? "ts" : "js";
    const rExt      = isReact && isTS ? "tsx" : isReact ? "jsx" : ext;

    const rawEntity  = spec.dbSchema[0]?.name ?? "item";
    const mainEntity = rawEntity.endsWith("s") ? rawEntity : `${rawEntity}s`;

    const page1 = spec.pages[0]?.name?.replace(/\s+/g, "") ?? "Home";
    const page2 = spec.pages[1]?.name?.replace(/\s+/g, "") ?? "Dashboard";

    const pageRoutes = spec.pages.length > 0
      ? spec.pages.slice(0, 3).map(p => `${p.route}→${p.name.replace(/\s+/g, "")}Page`).join(", ")
      : "/ → HomePage, /dashboard → DashboardPage";

    return { isTS, isReact, isTW, isExpress, isDrizzle, ext, rExt, mainEntity, page1, page2, pageRoutes };
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      "src", "src/components", "src/pages", "src/hooks", "src/lib", "src/types",
      "server", "server/routes", "server/middleware", "server/db", "server/lib",
      "public", "assets",
    ];
    await Promise.all(
      dirs.map(d => fs.mkdir(path.join(this.projectDir, d), { recursive: true }).catch(() => {})),
    );
  }

  private recordBatchDone(
    batch: BatchDef,
    filesWritten: string[],
    durationMs: number,
    providerUsed: string,
    retries: number,
    errors: string[],
  ): void {
    this.progress.completedBatches.push(batch.id);
    this.batchResults.push({
      batchId: batch.id, batchName: batch.displayName,
      filesWritten, skipped: false,
      durationMs, providerUsed, retries, errors,
    });
    saveProgress(this.projectDir, this.progress).catch(() => {});
    this.tick();
    this.emit("file_gen_batch_complete", {
      batchId: batch.id,
      batchName: batch.displayName,
      filesWritten: filesWritten.length,
      durationMs,
      providerUsed,
      retries,
    });
  }

  private emit(type: string, data: Record<string, unknown>): void {
    try { this.send({ type, ...data }); } catch { /**/ }
  }

  private tick(): void { this.lastTick = Date.now(); }

  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastTick;
      if (elapsed > WATCHDOG_INTERVAL_MS) {
        const elapsedSec = Math.round(elapsed / 1000);
        console.warn(`[FileGen] Watchdog: ${elapsedSec}s stall on "${this.currentBatchName}"`);
        this.emit("file_gen_progress", {
          message: `Still working on ${this.currentBatchName} (${elapsedSec}s)...`,
          isWatchdog: true,
          stalledBatch: this.currentBatchName,
          elapsedSeconds: elapsedSec,
        });
        this.tick(); // reset so we don't spam every second
      }
    }, 5_000); // check every 5s
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
  }
}
