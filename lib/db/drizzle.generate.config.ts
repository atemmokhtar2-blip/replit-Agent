/**
 * Drizzle Kit config for `generate` (schema → SQL migrations).
 *
 * Unlike drizzle.config.ts, this file does NOT require DATABASE_URL because
 * `drizzle-kit generate` only reads TypeScript schema files — it never
 * connects to the database.
 *
 * Usage:
 *   pnpm --filter @workspace/db run generate
 */

import { defineConfig } from "drizzle-kit";
import path from "path";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./migrations"),
  dialect: "postgresql",
  // No dbCredentials needed for generate — only for push/migrate
});
