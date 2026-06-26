/**
 * Repository Analyzer
 *
 * Performs static analysis on a cloned repository to detect:
 * framework, language, package manager, build system, database,
 * Docker, CI, routes, components, env vars, and deployment config.
 */

import { readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import { join, extname, relative } from "path";
import type {
  ProjectAnalysis,
  Framework,
  Language,
  PackageManager,
  BuildSystem,
  DetectedEnvVar,
  FolderNode,
  DeploymentConfig,
} from "./types.js";

const MAX_FILE_SIZE = 512 * 1024; // 512 KB

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function analyzeRepository(repoPath: string): Promise<ProjectAnalysis> {
  const [pkg, envVars, folderTree, readmeSummary] = await Promise.all([
    readPackageJson(repoPath),
    detectEnvVars(repoPath),
    buildFolderTree(repoPath, 4),
    readReadme(repoPath),
  ]);

  const language = detectLanguage(repoPath, pkg);
  const packageManager = detectPackageManager(repoPath, pkg);
  const framework = detectFramework(pkg, repoPath);
  const buildSystem = detectBuildSystem(pkg, repoPath);
  const hasDocker = existsSync(join(repoPath, "Dockerfile")) || existsSync(join(repoPath, "docker-compose.yml")) || existsSync(join(repoPath, "docker-compose.yaml"));
  const hasCI = existsSync(join(repoPath, ".github/workflows")) || existsSync(join(repoPath, ".gitlab-ci.yml")) || existsSync(join(repoPath, ".circleci"));
  const hasTests = hasTestFiles(repoPath, pkg);
  const hasTypeScript = existsSync(join(repoPath, "tsconfig.json")) || ((pkg?.devDependencies as Record<string, string> | undefined)?.["typescript"] != null);
  const isMonorepo = existsSync(join(repoPath, "pnpm-workspace.yaml")) || existsSync(join(repoPath, "lerna.json")) || existsSync(join(repoPath, "nx.json")) || pkg?.workspaces != null;
  const hasDatabase = detectDatabase(pkg, repoPath);
  const deploymentConfig = detectDeploymentConfig(repoPath, pkg);
  const components = await detectComponents(repoPath);
  const routes = await detectRoutes(repoPath, framework);
  const apis = await detectApiEndpoints(repoPath, framework);

  return {
    framework,
    language,
    packageManager,
    buildSystem,
    hasDatabase,
    hasDocker,
    hasCI,
    hasTests,
    hasTypeScript,
    isMonorepo,
    dependencies: (pkg?.dependencies as Record<string, string> | undefined) ?? {},
    devDependencies: (pkg?.devDependencies as Record<string, string> | undefined) ?? {},
    scripts: (pkg?.scripts as Record<string, string> | undefined) ?? {},
    detectedEnvVars: envVars,
    folderTree,
    routes,
    components,
    apis,
    deploymentConfig,
    readmeSummary,
  };
}

// ─── Package.json ──────────────────────────────────────────────────────────────

async function readPackageJson(repoPath: string): Promise<Record<string, unknown> | null> {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = await readFile(pkgPath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Language detection ────────────────────────────────────────────────────────

function detectLanguage(repoPath: string, pkg: Record<string, unknown> | null): Language {
  if (pkg != null) {
    const deps = { ...(pkg.dependencies as Record<string, string> ?? {}), ...(pkg.devDependencies as Record<string, string> ?? {}) };
    if ("typescript" in deps) return "typescript";
    return "javascript";
  }
  if (existsSync(join(repoPath, "requirements.txt")) || existsSync(join(repoPath, "pyproject.toml")) || existsSync(join(repoPath, "setup.py"))) return "python";
  if (existsSync(join(repoPath, "Gemfile"))) return "ruby";
  if (existsSync(join(repoPath, "composer.json"))) return "php";
  if (existsSync(join(repoPath, "Cargo.toml"))) return "rust";
  if (existsSync(join(repoPath, "go.mod"))) return "go";
  if (existsSync(join(repoPath, "pom.xml")) || existsSync(join(repoPath, "build.gradle"))) return "java";
  return "unknown";
}

// ─── Package manager detection ─────────────────────────────────────────────────

function detectPackageManager(repoPath: string, pkg: Record<string, unknown> | null): PackageManager {
  if (existsSync(join(repoPath, "pnpm-lock.yaml")) || existsSync(join(repoPath, "pnpm-workspace.yaml"))) return "pnpm";
  if (existsSync(join(repoPath, "bun.lockb"))) return "bun";
  if (existsSync(join(repoPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(repoPath, "package-lock.json"))) return "npm";
  if (pkg != null) return "npm";
  if (existsSync(join(repoPath, "Pipfile"))) return "pipenv";
  if (existsSync(join(repoPath, "pyproject.toml"))) return "poetry";
  if (existsSync(join(repoPath, "requirements.txt"))) return "pip";
  if (existsSync(join(repoPath, "Cargo.toml"))) return "cargo";
  if (existsSync(join(repoPath, "go.mod"))) return "go";
  return "unknown";
}

// ─── Framework detection ───────────────────────────────────────────────────────

function detectFramework(pkg: Record<string, unknown> | null, repoPath: string): Framework {
  if (!pkg) {
    if (existsSync(join(repoPath, "manage.py"))) return "django";
    if (existsSync(join(repoPath, "app.py")) || existsSync(join(repoPath, "main.py"))) return "flask";
    if (existsSync(join(repoPath, "Gemfile")) && existsSync(join(repoPath, "config/routes.rb"))) return "rails";
    return "unknown";
  }
  const deps = {
    ...(pkg.dependencies as Record<string, string> ?? {}),
    ...(pkg.devDependencies as Record<string, string> ?? {}),
  };
  if ("next" in deps) return "next";
  if ("nuxt" in deps || "@nuxt/core" in deps) return "nuxt";
  if ("@nestjs/core" in deps) return "nestjs";
  if ("fastify" in deps) return "fastify";
  if ("@sveltejs/kit" in deps || "svelte" in deps) return "svelte";
  if ("@angular/core" in deps) return "angular";
  if ("vue" in deps) return "vue";
  if ("react" in deps || "react-dom" in deps) return "react";
  if ("express" in deps) return "express";
  if ("koa" in deps) return "koa";
  if ("hono" in deps) return "hono";
  return "unknown";
}

// ─── Build system detection ────────────────────────────────────────────────────

function detectBuildSystem(pkg: Record<string, unknown> | null, repoPath: string): BuildSystem {
  if (!pkg) {
    if (existsSync(join(repoPath, "Cargo.toml"))) return "cargo";
    if (existsSync(join(repoPath, "go.mod"))) return "go";
    return "unknown";
  }
  const deps = {
    ...(pkg.dependencies as Record<string, string> ?? {}),
    ...(pkg.devDependencies as Record<string, string> ?? {}),
  };
  if ("vite" in deps) return "vite";
  if ("next" in deps) return "next";
  if ("nuxt" in deps) return "nuxt";
  if ("@parcel/core" in deps || "parcel" in deps) return "parcel";
  if ("esbuild" in deps) return "esbuild";
  if ("webpack" in deps) return "webpack";
  if ("rollup" in deps) return "rollup";
  if ("@swc/core" in deps) return "swc";
  if ("typescript" in deps && !("vite" in deps)) return "tsc";
  return "unknown";
}

// ─── Database detection ────────────────────────────────────────────────────────

function detectDatabase(pkg: Record<string, unknown> | null, repoPath: string): boolean {
  const dbIndicators = [
    "pg", "postgres", "mysql", "mysql2", "mongodb", "mongoose",
    "prisma", "drizzle-orm", "sequelize", "typeorm", "knex",
    "sqlite3", "better-sqlite3", "redis", "ioredis",
    "supabase", "@supabase/supabase-js", "firebase",
  ];
  if (pkg) {
    const deps = { ...(pkg.dependencies as Record<string, string> ?? {}) };
    if (dbIndicators.some((d) => d in deps)) return true;
  }
  return existsSync(join(repoPath, "prisma")) ||
    existsSync(join(repoPath, "drizzle.config.ts")) ||
    existsSync(join(repoPath, "drizzle.config.js")) ||
    existsSync(join(repoPath, "migrations"));
}

// ─── Test detection ────────────────────────────────────────────────────────────

function hasTestFiles(repoPath: string, pkg: Record<string, unknown> | null): boolean {
  const testDirs = ["test", "tests", "__tests__", "spec", "specs"];
  if (testDirs.some((d) => existsSync(join(repoPath, d)))) return true;
  if (pkg) {
    const scripts = pkg.scripts as Record<string, string> ?? {};
    if ("test" in scripts && scripts["test"] !== "echo \"Error: no test specified\" && exit 1") return true;
  }
  return false;
}

// ─── Env var detection ─────────────────────────────────────────────────────────

async function detectEnvVars(repoPath: string): Promise<DetectedEnvVar[]> {
  const envFiles = [".env.example", ".env.sample", ".env.template", ".env.local.example"];
  const results: DetectedEnvVar[] = [];
  const seen = new Set<string>();

  for (const filename of envFiles) {
    const filePath = join(repoPath, filename);
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [key] = trimmed.split("=");
        if (!key || seen.has(key.trim())) continue;
        const k = key.trim();
        seen.add(k);
        results.push({
          key: k,
          description: extractComment(content, k),
          category: categorizeSecret(k),
          isRequired: !trimmed.includes("=") || trimmed.endsWith("=") || trimmed.endsWith("=''") || trimmed.endsWith('=""'),
          exampleValue: trimmed.split("=").slice(1).join("=") || "",
          source: filename,
        });
      }
    } catch {
      // skip unreadable files
    }
  }

  // Also scan source files for common env var patterns
  const codePatterns = await scanCodeForEnvVars(repoPath, seen);
  results.push(...codePatterns);

  return results;
}

async function scanCodeForEnvVars(repoPath: string, seen: Set<string>): Promise<DetectedEnvVar[]> {
  const results: DetectedEnvVar[] = [];
  const patterns = [
    /process\.env\["([A-Z_][A-Z0-9_]+)"\]/g,
    /process\.env\.([A-Z_][A-Z0-9_]+)/g,
    /import\.meta\.env\.([A-Z_][A-Z0-9_]+)/g,
    /os\.environ(?:\.get)?\("([A-Z_][A-Z0-9_]+)"\)/g,
    /os\.getenv\("([A-Z_][A-Z0-9_]+)"\)/g,
  ];

  const exts = [".ts", ".tsx", ".js", ".jsx", ".py", ".env"];
  const files = await collectFiles(repoPath, exts, 3);

  for (const filePath of files.slice(0, 50)) {
    try {
      const s = await stat(filePath);
      if (s.size > MAX_FILE_SIZE) continue;
      const content = await readFile(filePath, "utf8");
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
          const key = match[1]!;
          if (seen.has(key) || key === "NODE_ENV" || key === "PORT") continue;
          seen.add(key);
          results.push({
            key,
            description: `Referenced in ${relative(repoPath, filePath)}`,
            category: categorizeSecret(key),
            isRequired: true,
            exampleValue: "",
            source: relative(repoPath, filePath),
          });
        }
      }
    } catch {
      // skip
    }
  }

  return results;
}

function extractComment(content: string, key: string): string {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.includes(`${key}=`)) {
      if (i > 0 && lines[i - 1]?.startsWith("#")) {
        return lines[i - 1]!.replace(/^#\s*/, "");
      }
    }
  }
  return describeKey(key);
}

function describeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("database_url") || lower.includes("db_url")) return "Database connection string";
  if (lower.includes("api_key")) return "API key";
  if (lower.includes("secret")) return "Secret key";
  if (lower.includes("token")) return "Access token";
  if (lower.includes("password") || lower.includes("passwd")) return "Password";
  if (lower.includes("url") || lower.includes("host")) return "Service URL / hostname";
  if (lower.includes("port")) return "Service port";
  return key.toLowerCase().replace(/_/g, " ");
}

function categorizeSecret(key: string): import("./types.js").SecretCategory {
  const k = key.toUpperCase();
  if (k.includes("GITHUB") || k.includes("GITLAB") || k.includes("BITBUCKET")) return "github";
  if (k.includes("OPENAI") || k.includes("ANTHROPIC") || k.includes("OPENROUTER") || k.includes("GEMINI") || k.includes("GROQ")) return "ai";
  if (k.includes("DATABASE") || k.includes("DB_") || k.includes("POSTGRES") || k.includes("MYSQL") || k.includes("MONGO") || k.includes("REDIS") || k.includes("SUPABASE")) return "database";
  if (k.includes("S3") || k.includes("STORAGE") || k.includes("CLOUDFLARE") || k.includes("R2") || k.includes("FIREBASE")) return "storage";
  if (k.includes("STRIPE") || k.includes("PAYPAL") || k.includes("PAYMENT")) return "payment";
  if (k.includes("EMAIL") || k.includes("SMTP") || k.includes("SENDGRID") || k.includes("RESEND") || k.includes("MAILGUN")) return "email";
  if (k.includes("TELEGRAM") || k.includes("SLACK") || k.includes("DISCORD") || k.includes("TWILIO")) return "messaging";
  if (k.includes("VERCEL") || k.includes("NETLIFY") || k.includes("RAILWAY") || k.includes("FLY") || k.includes("HEROKU")) return "deployment";
  if (k.includes("SENTRY") || k.includes("DATADOG") || k.includes("LOGTAIL")) return "monitoring";
  return "other";
}

// ─── Folder tree ───────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", "dist", "build",
  "__pycache__", ".venv", "venv", ".cache", "coverage",
  ".turbo", ".pnpm", "out", ".svelte-kit",
]);

const IGNORE_FILES = new Set([
  ".DS_Store", "Thumbs.db", "*.pyc",
]);

async function buildFolderTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<FolderNode> {
  const name = dirPath.split("/").pop() ?? dirPath;

  if (currentDepth >= maxDepth) {
    return { name, path: dirPath, type: "directory", children: [] };
  }

  let entries: string[] = [];
  try {
    entries = await readdir(dirPath);
  } catch {
    return { name, path: dirPath, type: "directory" };
  }

  const children: FolderNode[] = [];

  for (const entry of entries.sort()) {
    if (IGNORE_FILES.has(entry)) continue;

    const fullPath = join(dirPath, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        if (IGNORE_DIRS.has(entry) || entry.startsWith(".")) continue;
        children.push(await buildFolderTree(fullPath, maxDepth, currentDepth + 1));
      } else {
        children.push({ name: entry, path: fullPath, type: "file", size: s.size });
      }
    } catch {
      // skip
    }
  }

  return { name, path: dirPath, type: "directory", children };
}

// ─── Deployment config ─────────────────────────────────────────────────────────

function detectDeploymentConfig(repoPath: string, pkg: Record<string, unknown> | null): DeploymentConfig | null {
  if (existsSync(join(repoPath, "vercel.json"))) {
    return { platform: "vercel", configFile: "vercel.json", buildCommand: null, outputDir: null, envVarsRequired: ["VERCEL_TOKEN"] };
  }
  if (existsSync(join(repoPath, "netlify.toml"))) {
    return { platform: "netlify", configFile: "netlify.toml", buildCommand: null, outputDir: null, envVarsRequired: ["NETLIFY_AUTH_TOKEN"] };
  }
  if (existsSync(join(repoPath, "fly.toml"))) {
    return { platform: "fly", configFile: "fly.toml", buildCommand: null, outputDir: null, envVarsRequired: ["FLY_API_TOKEN"] };
  }
  if (existsSync(join(repoPath, "railway.json")) || existsSync(join(repoPath, "railway.toml"))) {
    return { platform: "railway", configFile: "railway.json", buildCommand: null, outputDir: null, envVarsRequired: ["RAILWAY_TOKEN"] };
  }
  if (existsSync(join(repoPath, "Procfile"))) {
    return { platform: "heroku", configFile: "Procfile", buildCommand: null, outputDir: null, envVarsRequired: [] };
  }
  if (pkg) {
    const scripts = pkg.scripts as Record<string, string> ?? {};
    if ("build" in scripts) {
      return { platform: "unknown", configFile: "package.json", buildCommand: scripts["build"] ?? null, outputDir: null, envVarsRequired: [] };
    }
  }
  return null;
}

// ─── Components/routes/api detection ──────────────────────────────────────────

async function detectComponents(repoPath: string): Promise<string[]> {
  const componentDirs = ["src/components", "components", "src/pages", "pages", "app"];
  const results: string[] = [];
  for (const dir of componentDirs) {
    const fullPath = join(repoPath, dir);
    if (!existsSync(fullPath)) continue;
    try {
      const files = await collectFiles(fullPath, [".tsx", ".jsx", ".vue", ".svelte"], 3);
      results.push(...files.map((f) => relative(repoPath, f)));
    } catch {
      // skip
    }
  }
  return results.slice(0, 50);
}

async function detectRoutes(repoPath: string, framework: Framework): Promise<string[]> {
  const results: string[] = [];
  if (framework === "next" || framework === "nuxt") {
    const routeDir = existsSync(join(repoPath, "app")) ? "app" : "pages";
    try {
      const files = await collectFiles(join(repoPath, routeDir), [".tsx", ".jsx", ".js", ".ts"], 4);
      results.push(...files.map((f) => relative(repoPath, f)));
    } catch {
      // skip
    }
  }
  return results.slice(0, 30);
}

async function detectApiEndpoints(repoPath: string, framework: Framework): Promise<string[]> {
  const results: string[] = [];
  const apiDirs = ["src/routes", "src/api", "api", "routes", "src/app/api", "app/api"];
  for (const dir of apiDirs) {
    const fullPath = join(repoPath, dir);
    if (!existsSync(fullPath)) continue;
    try {
      const files = await collectFiles(fullPath, [".ts", ".js"], 4);
      results.push(...files.map((f) => relative(repoPath, f)));
    } catch {
      // skip
    }
  }
  return results.slice(0, 30);
}

// ─── README ────────────────────────────────────────────────────────────────────

async function readReadme(repoPath: string): Promise<string | null> {
  const readmeFiles = ["README.md", "readme.md", "README.txt", "README"];
  for (const filename of readmeFiles) {
    const filePath = join(repoPath, filename);
    if (!existsSync(filePath)) continue;
    try {
      const content = await readFile(filePath, "utf8");
      return content.slice(0, 1000).replace(/\n+/g, " ").trim();
    } catch {
      // skip
    }
  }
  return null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function collectFiles(dirPath: string, extensions: string[], maxDepth: number, currentDepth = 0): Promise<string[]> {
  if (currentDepth >= maxDepth) return [];
  const results: string[] = [];
  let entries: string[] = [];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith(".")) continue;
    const fullPath = join(dirPath, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        results.push(...await collectFiles(fullPath, extensions, maxDepth, currentDepth + 1));
      } else if (extensions.includes(extname(entry))) {
        results.push(fullPath);
      }
    } catch {
      // skip
    }
  }
  return results;
}
