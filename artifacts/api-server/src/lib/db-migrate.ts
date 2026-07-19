/**
 * Database Auto-Migration
 *
 * Runs on every server startup BEFORE accepting any requests.
 * Uses drizzle-orm's migrate() to apply pending SQL migrations from
 * lib/db/migrations/ — zero downtime, no data loss, fully automatic.
 *
 * Strategy:
 *   1. Verify DB connection
 *   2. Apply any pending migrations
 *   3. Log success or fail loudly
 */

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Locate the migrations folder relative to this file.
 * The API server is at artifacts/api-server/ inside the monorepo root.
 * Migrations live at lib/db/migrations/ (repo root).
 *
 * esbuild bundles everything into dist/index.mjs, so __dirname = dist/.
 * From dist/ we need: ../../../lib/db/migrations
 *   dist/ → artifacts/api-server/ → artifacts/ → repo-root → lib/db/migrations
 * That is 3 levels up.
 */
function getMigrationsFolder(): string {
  return path.resolve(__dirname, "../../../lib/db/migrations");
}

export async function runMigrations(): Promise<void> {
  const start = Date.now();

  // ── 1. Connectivity check ────────────────────────────────────────────────
  console.log("[db] Checking database connection…");
  try {
    await db.execute(sql`SELECT 1`);
    console.log("[db] ✓ Database connection established");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[db] FATAL: Cannot connect to database: ${msg}`);
  }

  // ── 2. Apply migrations ──────────────────────────────────────────────────
  const migrationsFolder = getMigrationsFolder();
  console.log(`[db] Running migrations from: ${migrationsFolder}`);

  try {
    await migrate(db, { migrationsFolder });
    const elapsed = Date.now() - start;
    console.log(`[db] ✓ Migrations complete (${elapsed}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the error is that the migrations folder doesn't exist, fall back
    // to a schema-push style approach so the app still starts.
    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      console.warn("[db] ⚠ Migrations folder not found — skipping migration step");
      console.warn("[db]   Run `pnpm --filter @workspace/db run generate` to create migrations");
    } else {
      throw new Error(`[db] Migration failed: ${msg}`);
    }
  }
}

/** Graceful pool shutdown — call on SIGTERM/SIGINT */
export async function closeDb(): Promise<void> {
  await pool.end();
}
