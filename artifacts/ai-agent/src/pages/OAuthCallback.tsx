import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/components/AuthProvider";
import { Logo } from "@/components/Logo";
import { Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const SUPPORTED_PROVIDERS = ["google"] as const;

export default function OAuthCallback() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      setError(`Google declined access: ${oauthError}`);
      return;
    }

    if (!code || !state) {
      setError("Missing authorization code or state. Please try again.");
      return;
    }

    // Determine provider from state (it's encoded inside the base64url state blob)
    let provider = "google";
    try {
      const parsed = JSON.parse(atob(state.replace(/-/g, "+").replace(/_/g, "/"))) as {
        provider?: string;
      };
      if (parsed.provider && (SUPPORTED_PROVIDERS as readonly string[]).includes(parsed.provider)) {
        provider = parsed.provider;
      }
    } catch {
      // fall back to "google" as default
    }

    (async () => {
      try {
        const res = await fetch(`/api/v1/auth/oauth/${provider}/callback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "Sign-in failed. Please try again.");
          return;
        }

        const data = (await res.json()) as {
          access_token: string;
          refresh_token: string;
          token_type: string;
        };

        login({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          token_type: data.token_type,
        });

        setLocation("/chat");
      } catch {
        setError("Network error during sign-in. Please try again.");
      }
    })();
  }, [login, setLocation]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="mx-auto w-full max-w-sm space-y-4 text-center">
          <div className="flex justify-center">
            <XCircle className="h-12 w-12 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold">Sign-in failed</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => setLocation("/login")} className="w-full">
            Back to login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="mx-auto w-full max-w-sm space-y-4 text-center">
        <div className="flex justify-center">
          <Logo size="lg" animate="float" variant="icon" />
        </div>
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Completing sign-in…</p>
      </div>
    </div>
  );
}
