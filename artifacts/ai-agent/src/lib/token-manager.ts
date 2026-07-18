/**
 * Token Manager
 *
 * Centralises access-token lifecycle:
 *  - Reads / writes access_token + refresh_token in localStorage
 *  - Proactively refreshes when the access token is within 60 s of expiry
 *  - Deduplicates concurrent refresh calls (one in-flight promise)
 *  - Exposes getAccessToken() for use by every fetch layer
 */

const ACCESS_KEY  = "access_token";
const REFRESH_KEY = "refresh_token";

// ── JWT helpers (no verification — just decode the payload) ──────────────────

function jwtExp(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function isExpiredOrSoon(token: string, bufferSeconds = 60): boolean {
  const exp = jwtExp(token);
  if (!exp) return true; // can't decode → treat as expired
  return Date.now() / 1000 >= exp - bufferSeconds;
}

// ── Storage helpers ──────────────────────────────────────────────────────────

export function getStoredTokens(): { access: string; refresh: string } | null {
  const access  = localStorage.getItem(ACCESS_KEY);
  const refresh = localStorage.getItem(REFRESH_KEY);
  if (access && refresh) return { access, refresh };
  return null;
}

export function storeTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// ── Refresh (with in-flight dedup) ───────────────────────────────────────────

let _refreshPromise: Promise<string | null> | null = null;

async function doRefresh(): Promise<string | null> {
  const stored = getStoredTokens();
  if (!stored) return null;

  try {
    const res = await fetch("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: stored.refresh }),
    });

    if (!res.ok) {
      clearTokens();
      return null;
    }

    const data = (await res.json()) as {
      data?: { access_token?: string; refresh_token?: string };
      access_token?: string;
      refresh_token?: string;
    };

    // Support both wrapped { data: { access_token } } and flat { access_token }
    const newAccess  = data?.data?.access_token  ?? data?.access_token;
    const newRefresh = data?.data?.refresh_token ?? data?.refresh_token;

    if (!newAccess || !newRefresh) {
      clearTokens();
      return null;
    }

    storeTokens(newAccess, newRefresh);
    return newAccess;
  } catch {
    clearTokens();
    return null;
  }
}

function refreshOnce(): Promise<string | null> {
  if (!_refreshPromise) {
    _refreshPromise = doRefresh().finally(() => {
      _refreshPromise = null;
    });
  }
  return _refreshPromise;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a valid access token, refreshing if needed.
 * Returns null if the user is not logged in or refresh failed.
 */
export async function getAccessToken(): Promise<string | null> {
  const stored = getStoredTokens();
  if (!stored) return null;

  if (!isExpiredOrSoon(stored.access)) {
    return stored.access;
  }

  return refreshOnce();
}

/**
 * Force a token refresh regardless of expiry.
 * Used after a 401 to recover from clock-skew or edge cases.
 */
export async function forceRefresh(): Promise<string | null> {
  return refreshOnce();
}
