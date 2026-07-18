---
name: apiFetch double-prefix pattern
description: apiFetch auto-prepends /api/v1; page-level BASE consts must NOT include /api/v1
---

`apiFetch()` in `artifacts/ai-agent/src/lib/api.ts` prepends `/api/v1` to every path automatically:

```ts
const res = await fetch(`/api/v1${path}`, { ... });
```

**The trap:** pages that define `const BASE = "/api/v1/ai-providers"` and then call `apiFetch(\`${BASE}/models\`)` produce the URL `/api/v1/api/v1/ai-providers/models` → 404 or 401.

**Why:** This pattern is invisible at a glance — the page looks like it's constructing a valid API URL, but `apiFetch` doubles the prefix.

**How to apply:** Always define page-level BASE constants without `/api/v1`:
- ✅ `const BASE = "/ai-providers";`
- ❌ `const BASE = "/api/v1/ai-providers";`

Files that had this bug (fixed): `AIModelsPage.tsx`, `AIProvidersPage.tsx`, `ProviderMonitorWidget.tsx`.

Any future page that passes a full `/api/v1/...` path to `apiFetch` will silently double the prefix. Grep for `apiFetch.*api/v1` to find violations.
