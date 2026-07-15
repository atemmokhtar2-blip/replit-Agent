---
name: OpenRouter provider auto-discovery
description: ProviderManager seeds OPENROUTER_API_KEY from env into DB automatically at startup; no manual DB insert needed.
---

ProviderManager automatically scans env vars for known provider keys (e.g. OPENROUTER_API_KEY, OPENAI_API_KEY) and seeds them into the `ai_provider_registry` table on startup. Log line: `[ProviderManager] Seeded N new env key(s) for provider 'openrouter'`.

**Why:** Without a key in DB, ProviderManager reports "0 keys" and all providerManager.complete() calls fail. The fix is simply to set OPENROUTER_API_KEY as a secret — no code change or manual DB insert needed.

**How to apply:** If "0 keys" is reported at startup, check that OPENROUTER_API_KEY (or another provider key) is set in Replit Secrets. Restart the API server after adding a secret — the seeding happens at startup.
