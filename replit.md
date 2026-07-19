# AI Agent Platform

A professional AI-powered development platform where users describe software they want to build and receive complete architecture blueprints generated across 8 real execution stages via OpenRouter LLMs.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8000)
- `pnpm --filter @workspace/ai-agent run dev` — run the frontend (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `OPENROUTER_API_KEY` — for LLM calls

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, Tailwind 4, Framer Motion, TanStack Query v5, Wouter
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ai-agent/src/pages/` — top-level pages (Dashboard, ChatWorkspace, auth pages)
- `artifacts/ai-agent/src/components/` — shared components (AppLayout, PlannerWorkspace, Logo)
- `artifacts/ai-agent/src/components/design-system/` — animated SVG icons (AIPulse, AgentTimeline, BlueprintCore, etc.)
- `artifacts/api-server/src/routes/modules/ai.ts` — AI conversation + planner streaming routes
- `lib/db/src/schema/future.ts` — AI conversations + messages schema (aiConversationsTable, aiMessagesTable)
- `lib/api-spec/` — OpenAPI spec (source of truth for API contracts)
- `lib/api-client-react/src/generated/` — auto-generated hooks + Zod schemas (do NOT edit by hand)

## Architecture decisions

- Planner uses SSE streaming (POST body) via `streamToPlannerEngine()` in `artifacts/ai-agent/src/lib/planner-stream.ts`
- SSE disconnect detection uses `res.on("close")` not `req.on("close")` (req fires immediately when body is consumed)
- OpenRouter model fallback chain: `moonshotai/kimi-k2 → deepseek/deepseek-chat-v3-0324 → openai/gpt-oss-20b:free`
- Pin state is client-side localStorage only (no backend pin field on conversations)
- Vite proxies `/api` to `localhost:8000`; frontend runs on port 5000

## Product

- **AI Planner**: 8-stage pipeline that generates architecture blueprints (parsed sections with file trees + execution summaries)
- **Chat Workspace**: sidebar with search, pin, timestamps, and rename/delete per conversation
- **Dashboard**: conversation stats (total plans, blueprints generated, this-week activity), recent AI plans + projects
- **Auth**: register, login, forgot/reset password flows
- **Landing**: marketing page with branding, features, pricing sections

## Environment setup (required secrets)

- `DATABASE_URL` — auto-injected by Replit PostgreSQL module (postgresql-16 in .replit)
- `OPENROUTER_API_KEY` — from openrouter.ai/keys
- `JWT_SECRET` + `JWT_REFRESH_SECRET` — random 32-byte hex secrets
- `ENCRYPTION_KEY` — 32-byte hex, for GitHub OAuth token encryption
- `PROVIDER_ENCRYPTION_KEY` — 32-byte hex, for AI provider key encryption
- Run `pnpm --filter @workspace/db run push` after fresh setup or schema changes

## Gotchas

- HTTP headers must be ASCII-only — em dashes crash OpenRouter requests with a ByteString error
- `AbortSignal.timeout()` properly aborts hanging fetches; `Promise.race` + `setTimeout` does NOT
- Generated API hooks: `getListConversationsQueryKey()` takes optional params — pass none for the base key
- `AIConversationList` returns `{ items, total, page, per_page }` (not just an array)
- Vite config must guard `process.env.PORT` / `BASE_PATH` with an `isBuild` flag to avoid CI build failures
- `Start Backend` workflow must NOT use `waitForPort = 8080` — platform port detection for this port is unreliable; always set `PORT=8080` explicitly in the workflow args

## Admin

- Admin account: `atemmokhtar2@gmail.com` / role: `super_admin` (password set at setup — use forgot-password flow to reset)
- Admin panel: `/admin` — user management, auth providers, audit logs
- AI Providers Manager: `/ai-providers` — bulk key import, pool management, validation, routing

## AI Providers Manager

- Full bulk key paste (hundreds at once), auto-classifies by prefix into OpenRouter/Gemini/OpenAI/Groq/xAI/etc.
- Validate All (SSE stream, background, parallel concurrency-8) + Validate Selected for a subset
- Move To Provider — reassign selected keys to a different provider pool instantly (no restart needed)
- Backup (download JSON snapshot) + Restore (upload text file → auto-populates Import panel)
- Export/Import/Delete Invalid/Delete Duplicates buttons
- Routing strategies per provider: Round Robin, Least Used, Fastest Response, Random, Priority, Least Failures
- Per-key stats: requests, success rate, avg latency, last used, consecutive failures, errors
- Keys stored AES-256-GCM encrypted; only last 4 chars shown in UI

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._
