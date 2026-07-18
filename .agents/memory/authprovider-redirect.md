---
name: AuthProvider aggressive redirect
description: AuthProvider architecture for handling expired/revoked tokens and redirecting to login reliably
---

## Pattern

The AuthProvider does two passes for token validation:

**Pass 1 (on mount):** `getAccessToken()` is called immediately. If the token is expired, it tries to refresh automatically. If refresh fails (revoked tokens), `clearStoredTokens()` + `setTokens(null)` + `queryClient.clear()`. This prevents a wasted round-trip to `/api/v1/users/me`.

**Pass 2 (on useGetMe error):** If `/api/v1/users/me` still returns 401 (token was valid but backend restarted, secret changed, etc.), `forceRefresh()` is called. If it returns null, full logout is performed.

**Key safeguards:**
- `refreshingRef` (useRef) prevents concurrent refresh loops when multiple components trigger auth errors simultaneously
- `queryClient.clear()` on logout prevents stale query data from keeping the user "logged in" in React state
- `staleTime: 5 * 60 * 1000` on useGetMe prevents constant re-fetching

**Root cause of "stuck in 401 loop":** After backend restart + JWT_SECRET change, old tokens from localStorage became invalid. The `doRefresh()` in token-manager clears localStorage but the React state `tokens` still had the old value, causing useGetMe to keep firing. The fix: `setTokens(null)` + `queryClient.clear()` when refresh fails.

**Why:** `isAuthenticated: !!user` — when useGetMe fails (error state), user is undefined → false → ProtectedRoute redirects. But timing between async refresh and React re-renders could cause transient stale state. The two-pass approach + queryClient.clear() makes the redirect deterministic.
