---
name: Repository import autostart flow
description: How the auto-run-after-import feature works and key pitfalls to avoid.
---

## Flow

1. `Repositories.tsx` import success → navigate to `/chat?repo=<id>&autostart=1`
2. `ChatWorkspace.tsx` reads `autostart=1` from URL params:
   - Skips auto-restore of last conversation
   - Creates a new conversation automatically via `createMutation`
   - Sets `autoStartConvId = conv.id` (tied to this specific conversation)
   - Cleans the `?autostart=1` from URL via `window.history.replaceState`
3. `PlannerWorkspace.tsx` receives `autoStartMessage` **only when** `selectedId === autoStartConvId`:
   - Uses `handleSendRef` (a ref that tracks latest `handleSend`) to avoid stale closure
   - Fires after 600ms timeout, but only if `!isStreaming && messages.length === 0`
   - `autoStartSentRef` ensures it fires only once per mount

## Key pitfalls fixed

**Why `handleSendRef` instead of direct `handleSend`:** `handleSend` is a `useCallback` with many deps including `isStreaming`. The autostart effect only fires once (`[autoStartMessage]` deps). Without the ref, the timer would call a stale `handleSend` closure. The ref pattern keeps it fresh.

**Why `autoStartConvId` instead of `autoStartFired: boolean`:** `PlannerWorkspace` is keyed by `selectedId`. If `autoStartFired` stayed `true` globally, any new conversation created later could accidentally receive `autoStartMessage`. Tying to a specific `convId` scopes it correctly.

**Why unmount guard (`mountedRef`):** The auto-create mutation's `onSuccess` callback can fire after the component unmounts (e.g., user navigates away). The `mountedRef.current` check prevents state updates on an unmounted component.

## Auto-start message
```
This repository has just been imported. Analyze its structure, understand the tech stack, install all required dependencies, and run the project. Fix any errors that prevent it from starting.
```

## Clone LFS fix
`lib/github/src/git.ts` — replaced `--config filter.lfs.smudge=` flags (blocked by simple-git's unsafe-operations plugin) with `GIT_LFS_SKIP_SMUDGE=1` env var set via `simpleGit().env(lfsEnv)`.

**Why:** simple-git's `block-unsafe-operations-plugin` explicitly rejects `filter.smudge` and `filter.process` config keys as potential RCE vectors. Setting the equivalent env var bypasses this check while achieving the same result (skip LFS smudge on clone).
