import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/components/AuthProvider";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const loginSchema = z.object({
  email:    z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").min(8, "Password must be at least 8 characters"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

// ── Icons ─────────────────────────────────────────────────────────────────────

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5"} aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5"} aria-hidden="true" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

// ── Field error ───────────────────────────────────────────────────────────────

function FieldError({ message }: { message?: string }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
          className="text-xs text-destructive mt-1 flex items-center gap-1"
        >
          <span className="inline-block h-1 w-1 rounded-full bg-destructive flex-shrink-0" />
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

// ── Animated background ───────────────────────────────────────────────────────

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      {/* Primary glow orbs */}
      <div className="absolute -top-48 -right-48 h-96 w-96 rounded-full bg-primary/12 blur-3xl animate-pulse" style={{ animationDuration: "5s" }} />
      <div className="absolute -bottom-48 -left-48 h-96 w-96 rounded-full bg-primary/8 blur-3xl animate-pulse" style={{ animationDuration: "7s", animationDelay: "1.5s" }} />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 h-[28rem] w-[28rem] rounded-full bg-primary/5 blur-3xl animate-pulse" style={{ animationDuration: "9s", animationDelay: "3s" }} />
      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
    </div>
  );
}

// ── OAuth button ──────────────────────────────────────────────────────────────

type OAuthProvider = "google" | "github";

function OAuthButton({
  provider, disabled, loading, onClick,
}: { provider: OAuthProvider; disabled: boolean; loading: boolean; onClick: () => void }) {
  const cfg = {
    google: {
      label:   "Continue with Google",
      loading: "Redirecting to Google…",
      icon:    <GoogleIcon className="h-5 w-5 flex-shrink-0" />,
      cls:     "bg-white dark:bg-white/95 text-gray-900 border-gray-200 dark:border-white/20 hover:shadow-md",
      spinner: "text-gray-600",
    },
    github: {
      label:   "Continue with GitHub",
      loading: "Redirecting to GitHub…",
      icon:    <GitHubIcon className="h-5 w-5 flex-shrink-0" />,
      cls:     "bg-[#24292e] text-white border-[#24292e]/80 hover:bg-[#1c2126] hover:shadow-md",
      spinner: "text-white/80",
    },
  }[provider];

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02, y: disabled ? 0 : -1 }}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center justify-center gap-3 h-11 rounded-xl border shadow-sm font-semibold text-sm transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${cfg.cls}`}
    >
      {loading
        ? <Logo size="xs" animate="pulse" variant="icon" className={cfg.spinner} />
        : cfg.icon
      }
      <span>{loading ? cfg.loading : cfg.label}</span>
    </motion.button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Login() {
  const [, setLocation] = useLocation();
  const { login: authenticate, isAuthenticated } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [loadingOAuth, setLoadingOAuth] = useState<OAuthProvider | null>(null);
  const [oauthError,   setOauthError]   = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  const loginMutation = useLogin();
  const { errors, isSubmitting } = form.formState;
  const isPending = loginMutation.isPending || isSubmitting;

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate({ data }, {
      onSuccess: (res) => {
        authenticate({ access_token: res.access_token, refresh_token: res.refresh_token, token_type: res.token_type });
        toast.success("Welcome back!");
        setLocation("/dashboard");
      },
      onError: (err) => {
        const message = (err as { data?: { error?: string } }).data?.error || "Please check your credentials and try again.";
        toast.error("Sign in failed", { description: message });
      },
    });
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    setLoadingOAuth(provider);
    setOauthError(null);
    try {
      const res = await fetch(`/api/v1/auth/oauth/${provider}/authorize`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setOauthError(body.error ?? `${provider === "google" ? "Google" : "GitHub"} sign-in is not available right now.`);
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch {
      setOauthError("Network error. Please try again.");
    } finally {
      setLoadingOAuth(null);
    }
  };

  const anyOAuthLoading = !!loadingOAuth;

  return (
    <>
      <AnimatedBackground />

      <div className="flex min-h-screen items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          {/* Glass card */}
          <div className="relative rounded-2xl border border-border/40 bg-background/70 backdrop-blur-2xl shadow-2xl shadow-black/25 overflow-hidden">
            {/* Top shimmer line */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

            <div className="px-8 pt-10 pb-8 space-y-6">

              {/* Header — Project 7 mark */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12, duration: 0.38 }}
                className="text-center space-y-4"
              >
                <div className="flex justify-center">
                  <Logo size="xl" animate="idle" variant="icon" />
                </div>
                <div className="space-y-1">
                  <h1 className="text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
                  <p className="text-sm text-muted-foreground">Sign in to Project 7</p>
                </div>
              </motion.div>

              {/* OAuth buttons */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.35 }}
                className="space-y-2.5"
              >
                <OAuthButton
                  provider="google"
                  loading={loadingOAuth === "google"}
                  disabled={anyOAuthLoading || isPending}
                  onClick={() => handleOAuth("google")}
                />
                <OAuthButton
                  provider="github"
                  loading={loadingOAuth === "github"}
                  disabled={anyOAuthLoading || isPending}
                  onClick={() => handleOAuth("github")}
                />

                <AnimatePresence>
                  {oauthError && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-xs text-amber-500/90 text-center px-2"
                    >
                      {oauthError.includes("not configured") || oauthError.includes("disabled")
                        ? "Social sign-in isn't enabled yet — use email & password below."
                        : oauthError}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Divider */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.22, duration: 0.35 }}
                className="relative flex items-center"
              >
                <div className="flex-1 h-px bg-border/60" />
                <span className="mx-3 text-xs text-muted-foreground select-none whitespace-nowrap">
                  or sign in with email
                </span>
                <div className="flex-1 h-px bg-border/60" />
              </motion.div>

              {/* Email / password form */}
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    aria-invalid={!!errors.email}
                    className="h-10 rounded-lg bg-background/80 border-border/60 focus:border-primary/60 focus:ring-primary/20"
                    {...form.register("email")}
                  />
                  <FieldError message={errors.email?.message} />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                    <Link href="/forgot-password" className="text-xs text-primary hover:underline font-medium">
                      Forgot password?
                    </Link>
                  </div>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      aria-invalid={!!errors.password}
                      className="h-10 pr-10 rounded-lg bg-background/80 border-border/60 focus:border-primary/60 focus:ring-primary/20"
                      {...form.register("password")}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <FieldError message={errors.password?.message} />
                </div>

                <Button
                  type="submit"
                  className="w-full h-10 rounded-lg font-semibold"
                  disabled={isPending || anyOAuthLoading}
                >
                  {isPending && <Logo size="xs" animate="pulse" variant="icon" className="mr-2" />}
                  {isPending ? "Signing in…" : "Sign In"}
                </Button>
              </form>

              {/* Footer */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.32, duration: 0.35 }}
                className="text-center text-sm text-muted-foreground"
              >
                Don&apos;t have an account?{" "}
                <Link href="/register" className="font-semibold text-primary hover:underline">
                  Sign up
                </Link>
              </motion.p>
            </div>

            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
          </div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.42, duration: 0.35 }}
            className="mt-4 text-center text-xs text-muted-foreground/50"
          >
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </motion.p>
        </motion.div>
      </div>
    </>
  );
}
