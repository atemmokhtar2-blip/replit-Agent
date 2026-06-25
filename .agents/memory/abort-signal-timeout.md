---
name: AbortSignal.timeout vs Promise.race for fetch timeouts
description: Promise.race+setTimeout does not abort a hanging fetch; AbortSignal.timeout does
---

## Rule
Always use `AbortSignal.timeout(ms)` passed directly to `fetch` for network timeouts. Never use `Promise.race([fetch(...), new Promise(reject via setTimeout)])`.

**Why:** `Promise.race` with a setTimeout races the OUTER promises, but the inner `fetch` continues running indefinitely. The setTimeout callback fires and rejects the outer race, but the underlying TCP connection stays open and the event loop is held. `AbortSignal.timeout(ms)` is a native signal that undici (Node.js fetch) monitors throughout the entire request lifecycle — headers wait AND body reading — and properly closes the connection when the timer fires.

**How to apply:**
```typescript
// WRONG — timer fires but fetch hangs forever behind the scenes
const data = await Promise.race([
  fetch(url, { signal }),
  new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 15_000)),
]);

// CORRECT — AbortSignal.timeout aborts fetch + body read after 15s
const combined = AbortSignal.any
  ? AbortSignal.any([externalSignal, AbortSignal.timeout(15_000)])
  : AbortSignal.timeout(15_000);
const response = await fetch(url, { signal: combined });
const json = await response.json(); // also aborted if combined fires mid-body
```

`AbortSignal.any` is available in Node.js 20.3+. In Node.js 20.20.0 (current Replit runtime), both `AbortSignal.timeout` and `AbortSignal.any` are available.
