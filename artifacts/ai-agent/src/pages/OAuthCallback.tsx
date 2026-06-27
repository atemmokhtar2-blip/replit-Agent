import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/components/AuthProvider";
import { Loader2, XCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";

const SUPPORTED_PROVIDERS = ["google"] as const;

export default function OAuthCallback() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
      setError(`Google declined access: ${oauthError}. Please try again.`);
      return;
    }

    if (!code || !state) {
      setError("Missing authorization details. Please try signing in again.");
      return;
    }

    let provider = "google";
    try {
      const parsed = JSON.parse(atob(state.replace(/-/g, "+").replace(/_/g, "/"))) as { provider?: string };
      if (parsed.provider && (SUPPORTED_PROVIDERS as readonly string[]).includes(parsed.provider)) {
        provider = parsed.provider;
      }
    } catch {
      // fall back to "google"
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

        login({ access_token: data.access_token, refresh_token: data.refresh_token, token_type: data.token_type });
        setSuccess(true);

        // Brief success state, then redirect
        setTimeout(() => setLocation("/dashboard"), 800);
      } catch {
        setError("Network error during sign-in. Please check your connection and try again.");
      }
    })();
  }, [login, setLocation]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-background" />
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/10 blur-3xl animate-pulse" style={{ animationDuration: "4s" }} />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary/8 blur-3xl animate-pulse" style={{ animationDuration: "6s" }} />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm"
      >
        <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-xl shadow-2xl shadow-black/20 px-8 py-10 text-center space-y-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent rounded-t-2xl" />

          <AnimatePresence mode="wait">
            {error ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 mx-auto">
                  <XCircle className="h-7 w-7 text-destructive" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Sign-in failed</h2>
                  <p className="text-sm text-muted-foreground">{error}</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setLocation("/login")}
                  className="w-full rounded-xl"
                >
                  Back to sign in
                </Button>
              </motion.div>
            ) : success ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 mx-auto">
                  <CheckCircle2 className="h-7 w-7 text-green-500" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Signed in successfully!</h2>
                  <p className="text-sm text-muted-foreground">Redirecting you to your dashboard…</p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mx-auto">
                  <Loader2 className="h-7 w-7 text-primary animate-spin" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Completing sign-in</h2>
                  <p className="text-sm text-muted-foreground">Please wait a moment…</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
