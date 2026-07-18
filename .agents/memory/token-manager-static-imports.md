---
name: Token-manager static imports required
description: Stream files must use static top-level imports for token-manager, not dynamic imports inside async functions
---

`planner-stream.ts`, `execution-stream.ts`, and `planner-api.ts` initially used dynamic `await import("./token-manager")` inside async functions to get `getAccessToken`/`forceRefresh`.

**Problem:** Vite HMR does not invalidate module caches for dynamic imports inside async functions during hot-reload. After code changes, the async function continues to use the OLD cached module reference, not the updated code.

**Fix:** Use static top-level imports at the file's head:
```ts
import { getAccessToken, forceRefresh } from "./token-manager";
```

**Why:** Static imports are tracked by Vite's module graph and properly invalidated/replaced during HMR. Dynamic imports inside async functions are resolved at call time and may reference stale module instances.
