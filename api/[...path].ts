/**
 * Vercel catch-all serverless handler for all /api/* routes.
 *
 * Imports the pre-built CJS bundle produced by
 * `pnpm --filter @workspace/api-server run build:vercel`
 * instead of raw TypeScript source.  This guarantees:
 *   - pino worker threads are bundled correctly via esbuild-plugin-pino
 *   - no native modules (bcryptjs is pure JS)
 *   - no pnpm workspace re-resolution at Vercel build time
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const _require = createRequire(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const mod = _require("../artifacts/api-server/dist/vercel/app.cjs");
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
export default (mod.default ?? mod) as object;
