/**
 * Validation Pipeline
 *
 * Runs build, typecheck, lint, and dependency checks
 * inside a workspace directory before any commit is made.
 *
 * All checks are run in the workspace's shell environment.
 * A commit is BLOCKED if any required check fails.
 */

import { execa } from "execa";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import type { ValidationResult, ValidationCheck } from "./types.js";

export interface RunValidationOptions {
  workspacePath: string;
  packageManager?: string;
  skipChecks?: Array<"build" | "typecheck" | "lint" | "deps">;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 120_000; // 2 minutes per check

/**
 * Run the full validation pipeline.
 * Returns results without throwing — callers inspect the `passed` field.
 */
export async function runValidation(options: RunValidationOptions): Promise<ValidationResult> {
  const { workspacePath, packageManager = "npm", skipChecks = [], timeoutMs = DEFAULT_TIMEOUT } = options;

  const pkg = await readPackageScripts(workspacePath);
  const checks: ValidationCheck[] = [];
  const start = Date.now();

  // ── Dependency validation ──────────────────────────────────────────────────
  if (!skipChecks.includes("deps")) {
    checks.push(await runCheck({
      name: "Dependency Validation",
      command: getInstallCommand(packageManager),
      cwd: workspacePath,
      timeoutMs,
    }));
  }

  // ── Type checking ──────────────────────────────────────────────────────────
  if (!skipChecks.includes("typecheck") && hasTypecheck(workspacePath, pkg)) {
    const cmd = pkg?.typecheck
      ? `${packageManager} run typecheck`
      : pkg?.tsc
        ? `${packageManager} run tsc`
        : "npx tsc --noEmit";
    checks.push(await runCheck({
      name: "Type Check",
      command: cmd,
      cwd: workspacePath,
      timeoutMs,
    }));
  }

  // ── Lint ───────────────────────────────────────────────────────────────────
  if (!skipChecks.includes("lint") && hasLint(pkg)) {
    checks.push(await runCheck({
      name: "Lint",
      command: `${packageManager} run lint`,
      cwd: workspacePath,
      timeoutMs,
    }));
  }

  // ── Build ──────────────────────────────────────────────────────────────────
  if (!skipChecks.includes("build") && hasBuild(pkg)) {
    checks.push(await runCheck({
      name: "Build",
      command: `${packageManager} run build`,
      cwd: workspacePath,
      timeoutMs,
    }));
  }

  const totalDuration = Date.now() - start;
  const passed = checks.every((c) => c.status === "passed" || c.status === "skipped");

  return { passed, checks, totalDuration };
}

// ─── Individual check runner ───────────────────────────────────────────────────

async function runCheck(options: {
  name: string;
  command: string | null;
  cwd: string;
  timeoutMs: number;
}): Promise<ValidationCheck> {
  const { name, command, cwd, timeoutMs } = options;
  const start = Date.now();

  if (!command) {
    return { name, status: "skipped", command: null, output: "No command configured", duration: 0, error: null };
  }

  try {
    const [bin, ...args] = command.split(" ");
    const result = await execa(bin!, args, {
      cwd,
      timeout: timeoutMs,
      all: true,
      reject: false,
      env: {
        ...process.env,
        CI: "true",
        NODE_ENV: "production",
      },
    });

    const duration = Date.now() - start;
    const output = (result.all ?? result.stdout ?? "").slice(-4000); // last 4KB

    if (result.exitCode === 0) {
      return { name, status: "passed", command, output, duration, error: null };
    }

    return {
      name,
      status: "failed",
      command,
      output,
      duration,
      error: `Exit code ${result.exitCode}: ${(result.stderr ?? "").slice(-1000)}`,
    };
  } catch (err) {
    const duration = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { name, status: "failed", command, output: "", duration, error: msg };
  }
}

// ─── Script detection helpers ──────────────────────────────────────────────────

async function readPackageScripts(workspacePath: string): Promise<Record<string, string> | null> {
  const pkgPath = join(workspacePath, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return pkg.scripts ?? null;
  } catch {
    return null;
  }
}

function getInstallCommand(pm: string): string {
  switch (pm) {
    case "pnpm": return "pnpm install --frozen-lockfile";
    case "yarn": return "yarn install --frozen-lockfile";
    case "bun": return "bun install --frozen-lockfile";
    default: return "npm ci";
  }
}

function hasTypecheck(workspacePath: string, scripts: Record<string, string> | null): boolean {
  if (scripts && ("typecheck" in scripts || "type-check" in scripts || "tsc" in scripts)) return true;
  return existsSync(join(workspacePath, "tsconfig.json"));
}

function hasLint(scripts: Record<string, string> | null): boolean {
  if (!scripts) return false;
  return "lint" in scripts || "eslint" in scripts;
}

function hasBuild(scripts: Record<string, string> | null): boolean {
  if (!scripts) return false;
  return "build" in scripts;
}
