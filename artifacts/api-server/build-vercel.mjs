/**
 * Vercel serverless handler build script.
 *
 * Builds `src/app.ts` (Express app, no listen()) into a self-contained CJS
 * bundle at `dist/vercel/handler.cjs`.  This bundle is imported by
 * `api/[...path].ts` on Vercel so that Vercel's own builder does not need to
 * re-compile the entire TypeScript workspace (pnpm workspace deps + pino
 * workers).  bcryptjs is pure-JS so it bundles cleanly without native bindings.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir } from "node:fs/promises";

globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.resolve(artifactDir, "dist/vercel");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await esbuild({
  entryPoints: [path.resolve(artifactDir, "src/app.ts")],
  platform: "node",
  bundle: true,
  format: "cjs",
  outdir,
  outExtension: { ".js": ".cjs" },
  logLevel: "info",
  // Only exclude actual native binary blobs — everything else (incl. bcryptjs) bundles cleanly.
  external: [
    "*.node",
    "fsevents",
    "sharp",
    "canvas",
    "argon2",
    "re2",
    "farmhash",
    "bufferutil",
    "utf-8-validate",
    "ssh2",
    "cpu-features",
    "dtrace-provider",
    "isolated-vm",
    "pg-native",
  ],
  sourcemap: false,
  plugins: [
    esbuildPluginPino({ transports: ["pino-pretty"] }),
  ],
});

console.log(`✓ Vercel handler built → ${outdir}/app.cjs`);
