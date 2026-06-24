---
name: Replit migration setup
description: How this pnpm monorepo is configured to run on Replit — ports, proxy, DB setup.
---

# Replit migration setup

**Why:** Replit webview ALWAYS routes the public URL to port 5000 (hardwired). API must run on port 8000. The artifact system injects its own PORT values (e.g. 23886, 8080) which break the webview — override them explicitly.

**How to apply:**
- Frontend workflow: name="Start application", command=`PORT=5000 pnpm --filter @workspace/ai-agent run dev`, waitForPort=5000, outputType="webview"
- Backend workflow: name="Start Backend", command=`PORT=8000 pnpm --filter @workspace/api-server run dev`, waitForPort=8000, outputType="console"
- Vite config proxies `/api` → `http://localhost:8000` (see vite.config.ts `server.proxy`)
- DB schema: `pnpm --filter @workspace/db run push` (uses DATABASE_URL from Replit secrets)
- Auth is custom JWT (bcrypt + jsonwebtoken) — no external auth provider
- AI provider keys are user-supplied (OpenRouter, HuggingFace, DeepSeek, Local) — request via secrets when needed

**Critical gotcha:** The artifact system (artifacts/ai-agent: web, artifacts/api-server: API Server) injects PORT=23886 and PORT=8080 respectively. These artifact workflows run alongside the standard "Start application" / "Start Backend" workflows. The artifact workflows are unmodifiable. Always create/maintain the standard named workflows on ports 5000 and 8000 — those are what the Replit webview uses.
