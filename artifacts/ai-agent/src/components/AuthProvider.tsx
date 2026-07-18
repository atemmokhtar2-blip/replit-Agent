import React, { createContext, useContext, useEffect, useState } from "react";
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import type { User, TokenPair } from "@workspace/api-client-react";
import { forceRefresh, storeTokens, clearTokens as clearStoredTokens } from "../lib/token-manager";

type AuthContextType = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (tokens: TokenPair) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<{ access_token: string; refresh_token: string } | null>(() => {
    const access = localStorage.getItem("access_token");
    const refresh = localStorage.getItem("refresh_token");
    if (access && refresh) {
      return { access_token: access, refresh_token: refresh };
    }
    return null;
  });

  const { data: user, isLoading, error } = useGetMe({
    query: {
      enabled: !!tokens?.access_token,
      queryKey: getGetMeQueryKey(),
      retry: false,
    }
  });

  useEffect(() => {
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) {
        // Try refreshing before giving up
        forceRefresh().then((newToken) => {
          if (!newToken) {
            clearStoredTokens();
            setTokens(null);
          }
          // If refresh succeeded, the token-manager stored the new tokens;
          // TanStack Query will retry and succeed automatically.
        });
      } else if (status === 403) {
        clearStoredTokens();
        setTokens(null);
      }
    }
  }, [error]);

  const login = (newTokens: TokenPair) => {
    localStorage.setItem("access_token", newTokens.access_token);
    localStorage.setItem("refresh_token", newTokens.refresh_token);
    setTokens({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
    });
  };

  const logout = () => {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    setTokens(null);
  };

  const value = {
    user: user || null,
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
