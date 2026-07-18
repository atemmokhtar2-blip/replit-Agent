import { getAccessToken, forceRefresh } from "./token-manager";

async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeader()),
    ...(init.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`/api/v1${path}`, { ...init, headers });

  // On 401, try refreshing once and retry
  if (res.status === 401) {
    const newToken = await forceRefresh();
    if (newToken) {
      const retryHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${newToken}`,
        ...(init.headers as Record<string, string> | undefined),
      };
      const retry = await fetch(`/api/v1${path}`, { ...init, headers: retryHeaders });
      if (!retry.ok) {
        const body = await retry.json().catch(() => ({}));
        throw Object.assign(new Error(body?.error ?? `HTTP ${retry.status}`), {
          status: retry.status,
          data: body,
        });
      }
      return retry.json() as Promise<T>;
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(body?.error ?? `HTTP ${res.status}`), {
      status: res.status,
      data: body,
    });
  }
  return res.json() as Promise<T>;
}
