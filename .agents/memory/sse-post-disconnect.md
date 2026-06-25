---
name: SSE POST route disconnect detection
description: req.on("close") fires too early in POST SSE routes — use res.on("close") instead
---

## Rule
In Express SSE endpoints served via POST, always listen for client disconnect on `res.on("close")`, NOT `req.on("close")`.

**Why:** For POST requests, Node.js fires `req.on("close")` as soon as the request body is fully consumed — which happens immediately after Express parses the JSON body (milliseconds into the request). Listening to `req` therefore pre-aborts any AbortController before a single LLM fetch starts, causing the fetch to throw "This operation was aborted" instantly. The symptoms are: `[MODEL_SELECTED]` logged, `[MODEL_FAILED]` logged (fetch error), 0 bytes of SSE data received by the client, and the response hanging open for the full client timeout.

**How to apply:**
```typescript
// WRONG — fires when POST body is consumed, not when client disconnects
req.on("close", () => { aborted = true; abortController.abort(); });

// CORRECT — fires only when the TCP connection is actually terminated
res.on("close", () => {
  if (!res.writableEnded) {
    // writableEnded guard: normal res.end() also fires "close", skip that case
    aborted = true;
    abortController.abort();
  }
});
```
