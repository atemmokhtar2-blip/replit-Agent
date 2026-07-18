import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import type { User, TokenPair } from "@workspace/api-client-react";
import {
  getAccessToken,
  forceRefresh,
  storeTokens,
  clearTokens as clearStoredTokens,
  getStoredTokens,
} from "../lib/token-manager";

type AuthContextType = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (tokens: TokenPair) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const refreshingRef = useRef(false);

  // ── Token state — initialised from localStorage ──────────────────────────
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(() => {
    const stored = getStoredTokens();
    return stored ? { access_token: stored.access, refresh_token: stored.refresh } : null;
  });

  // ── Proactive token check on mount ───────────────────────────────────────
  // If the stored access token is already expired, try to refresh immediately
  // so we don't waste a round-trip on /api/v1/users/me.
  useEffect(() => {
    if (!tokens) return;
    getAccessToken().then((t) => {
      if (t) {
        // Token is valid or was refreshed — update state if it changed
        if (t !== tokens.access_token) {
          const stored = getStoredTokens();
          if (stored) setTokens({ access_token: stored.access, refresh_token: stored.refresh });
        }
      } else {
        // Both access + refresh tokens failed — log out
        clearStoredTokens();
        setTokens(null);
        queryClient.clear();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount

  // ── /api/v1/users/me — the authoritative user check ─────────────────────
  const { data: user, isLoading, error } = useGetMe({
    query: {
      enabled: !!tokens?.access_token,
      queryKey: getGetMeQueryKey(),
      retry: false,
      staleTime: 5 * 60 * 1000, // 5 minutes — avoids hammering the server
    },
  });

  // ── Handle auth errors from useGetMe ─────────────────────────────────────
  useEffect(() => {
    if (!error) return;
    if (refreshingRef.current) return;

    const status = (error as { status?: number }).status;

    if (status === 401) {
      refreshingRef.current = true;
      forceRefresh()
        .then((newToken) => {
          if (newToken) {
            // Refresh worked — invalidate the /me query so it retries
            void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          } else {
            // Refresh failed — full logout
            clearStoredTokens();
            setTokens(null);
            queryClient.clear();
          }
        })
        .finally(() => {
          refreshingRef.current = false;
        });
    } else if (status === 403) {
      clearStoredTokens();
      setTokens(null);
      queryClient.clear();
    }
  }, [error, queryClient]);

  // ── Auth actions ─────────────────────────────────────────────────────────
  const login = (newTokens: TokenPair) => {
    storeTokens(newTokens.access_token, newTokens.refresh_token);
    setTokens({ access_token: newTokens.access_token, refresh_token: newTokens.refresh_token });
  };

  const logout = () => {
    clearStoredTokens();
    setTokens(null);
    queryClient.clear();
  };

  const value: AuthContextType = {
    user: user ?? null,
    isAuthenticated: !!user,
    isLoading: isLoading && !!tokens?.access_token,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
