---
name: Workflow runner PORT injection
description: Replit's workflow runner injects a dynamic PORT env var that overrides vite config defaults
---

## Rule
Vite configs that read `process.env.PORT` will pick up Replit's dynamically injected PORT (e.g. 23886) instead of 5000. The webview is always mapped to localPort 5000, so Vite must be hardcoded to 5000.

**Why:** Replit's workflow runner sets PORT to a random dynamic value. If vite reads it, it starts on that port and the webview (expecting 5000) gets a connection refused.

**How to apply:** In vite.config.ts, do not read process.env.PORT. Hardcode port 5000 (or use it as an unconditional default, not a fallback).
