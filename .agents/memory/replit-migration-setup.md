---
name: Replit migration setup
description: How this pnpm monorepo is configured to run on Replit — ports, proxy, DB setup.
---

# Replit migration setup

**Why:** Replit webview requires port 5000; API must run on a separate port (8000) with Vite proxying /api.

**How to apply:**
- Frontend (ai-agent): `PORT=5000 pnpm --filter @workspace/ai-agent dev` — webview outputType
- API server: `PORT=8000 pnpm --filter @workspace/api-server run dev` — console outputType
- Vite config proxies `/api` → `http://localhost:8000`
- DB schema: `pnpm --filter @workspace/db run push` (uses DATABASE_URL from Replit secrets)
- Both workflows run in parallel under the "Project" parent workflow
- Auth is custom JWT (bcrypt + jsonwebtoken) — no external auth provider
- AI provider keys are user-supplied (OpenRouter, HuggingFace, DeepSeek, Local) — request via secrets when needed
