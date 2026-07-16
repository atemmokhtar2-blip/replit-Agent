---
name: Execution pipeline fixes
description: What was broken and how each of the 5 root fixes was applied
---

## Fix 1 — OPENROUTER_API_KEY pre-flight guard

**Rule:** Before Stage 2, `runExecutionPipeline` now checks `process.env["OPENROUTER_API_KEY"]` AND queries `aiProviderKeysTable` for DB-stored keys. If neither exists, emits `{ type: "exec_error", retryable: false }` with a clear message pointing the user to Secrets panel. No silent 0-file generation.

**Why:** Without a key ALL 9 LLM batches in `BatchFileGenerator` fail silently, producing only static config files (package.json, README).

**How to apply:** The guard is at the top of `runExecutionPipeline` in `execution-engine.ts`, after Stage 1.

---

## Fix 2 — Preview: Vite base './' + binary asset serving

**Rule:** Generated `vite.config.ts` must include `base: './'` so Vite outputs relative asset paths that survive being served from any URL prefix. The `preview-asset` endpoint now reads binary files (images, fonts, wasm) as Buffer (not UTF-8) to avoid corruption. Text files keep UTF-8.

**Why:** Without `base: './'`, Vite outputs `/assets/...` absolute paths; the URL-rewriting regex in the preview endpoint rewrites `src="/..."` in HTML but NOT in JS chunks — so dynamic imports break. Binary files read as UTF-8 produce corrupted output.

**Where:** `file-generator.ts` `runStaticBatch()` for vite config; `ai.ts` `preview-asset` route.

---

## Fix 3 — Fake verification checks → honest skipped/real

**Rule:** 12 checks that always returned hardcoded `{ ok: true }` now return `{ ok: true, skipped: true, detail: "..." }` if they can't be verified, or use real stage outcomes (`outcomes.buildOk`, `outcomes.installOk`, `outcomes.typeCheckOk`). The health score only counts non-skipped checks.

**Changed checks:** `missing_imports`, `missing_exports`, `circular_imports`, `react_warnings`, `console_errors`, `hydration_errors` → always skipped. `broken_components`, `assets_loaded`, `api_failures` → use `outcomes.buildOk`. `missing_deps` → uses `outcomes.installOk` (now set in Stage 3). `ts_errors` → uses `outcomes.typeCheckOk`.

---

## Fix 4 — Math.random() removed from healCheck

**Rule:** `healCheck` no longer uses `Math.random()` to decide success. It returns `{ healed: false }` for everything except `runtime_errors` (which probes our own API server — always running). All other checks that reach `healCheck` represent real build/system failures requiring manual intervention.

**Why:** The old code randomly claimed 85%+ of fixes "worked" without touching any source files — pure theater.

---

## Fix 5 — Deployment module: real DB implementation

**Rule:** `deployment.ts` now creates real records in `deploymentsTable` via `POST /api/v1/deployments`. The `deployUrl` = preview URL of the generated project. Lists deployments per user. `conversation_id` stored in `buildLog` JSON. `deploymentsTable.projectId` is nullable — not required.

**Note:** Deployment does NOT run a new build — it "publishes" the existing generated files by creating a permanent DB record pointing to the preview URL.
