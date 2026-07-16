---
name: Backend workflow waitForPort detection failure
description: Start Backend workflow with waitForPort=8080 always times out even though server starts correctly; fix is to remove waitForPort from the workflow config
---

## Rule
Remove `waitForPort` from the `Start Backend` workflow in `.replit`. The node backend starts correctly on port 8080 (logs confirm it), but the Replit platform's port-detection mechanism never fires the "port open" event for port 8080, causing WorkflowsRestart to SIGKILL the process after timeout.

**Why:** Replit's `waitForPort` detection for console-type (non-webview) workflows on port 8080 appears unreliable in this monorepo setup. The server binds 0.0.0.0:8080 correctly but the platform does not detect it. Without `waitForPort`, the workflow starts and stays running.

**How to apply:** In `.replit`, for `Start Backend`:
```toml
[[workflows.workflow.tasks]]
task = "shell.exec"
args = "PORT=8080 node --enable-source-maps ./artifacts/api-server/dist/index.mjs"
# NO waitForPort line
```
Always explicitly set `PORT=8080` in the args because Replit injects a random PORT env var into workflow environments (e.g. 23886).

Also add port 8080 to `[[ports]]` even if not externally exposed — may help platform detection.
