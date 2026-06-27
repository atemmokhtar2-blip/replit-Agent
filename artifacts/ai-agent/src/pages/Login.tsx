import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").min(8, "Password must be at least 8 characters"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

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
          <span className="inline-block h-1 w-1 rounded-full bg-destructive" />
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/10 blur-3xl animate-pulse" style={{ animationDuration: "4s" }} />
      <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary/8 blur-3xl animate-pulse" style={{ animationDuration: "6s", animationDelay: "1s" }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-primary/5 blur-3xl animate-pulse" style={{ animationDuration: "8s", animationDelay: "2s" }} />
    </div>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { login: authenticate, isAuthenticated } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);

  useEffect(() => {
    if (isAuthenticated) setLocation("/dashboard");
  }, [isAuthenticated, setLocation]);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onTouched",
  });

  const loginMutation = useLogin();

  const onSubmit = (data: LoginFormValues) => {
    loginMutation.mutate(
      { data },
      {
        onSuccess: (res) => {
          authenticate({ access_token: res.access_token, refresh_token: res.refresh_token, token_type: res.token_type });
          toast.success("Welcome back!");
          setLocation("/dashboard");
        },
        onError: (err) => {
          const message = (err as { data?: { error?: string } }).data?.error || "Please check your credentials and try again.";
          toast.error("Login failed", { description: message });
        },
      }
    );
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      const res = await fetch("/api/v1/auth/oauth/google/authorize");
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setGoogleError(body.error ?? "Google sign-in is not available. Please try email login.");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch {
      setGoogleError("Network error. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const { errors, isSubmitting } = form.formState;
  const isPending = loginMutation.isPending || isSubmitting;

  return (
    <>
      <AnimatedBackground />

      <div className="flex min-h-screen items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="w-full max-w-md"
        >
          {/* Glass card */}
          <div className="relative rounded-2xl border border-white/10 bg-background/60 backdrop-blur-xl shadow-2xl shadow-black/20 overflow-hidden">
            {/* Top gradient line */}
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />

            <div className="px-8 pt-10 pb-8 space-y-8">
              {/* Header */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.35 }}
                className="text-center space-y-3"
              >
                <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 mx-auto mb-1">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">
                  Welcome back
                </h1>
                <p className="text-sm text-muted-foreground">
                  Sign in to continue to AI Agent
                </p>
              </motion.div>

              {/* Google Button — primary action */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.35 }}
                className="space-y-3"
              >
                <motion.button
                  whileHover={{ scale: googleLoading || isPending ? 1 : 1.02, y: googleLoading || isPending ? 0 : -1 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.15 }}
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading || isPending}
                  className="group relative w-full flex items-center justify-center gap-3 h-12 rounded-xl
                    bg-white dark:bg-white/95 text-gray-900
                    border border-gray-200 dark:border-white/20
                    shadow-sm hover:shadow-md
                    font-semibold text-sm
                    transition-all duration-200
                    disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {googleLoading ? (
                    <Loader2 className="h-5 w-5 animate-spin text-gray-600" />
                  ) : (
                    <GoogleIcon className="h-5 w-5 flex-shrink-0" />
                  )}
                  <span>{googleLoading ? "Redirecting to Google…" : "Continue with Google"}</span>
                </motion.button>

                <AnimatePresence>
                  {googleError && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-xs text-destructive text-center px-2"
                    >
                      {googleError}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Divider */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.35 }}
                className="relative flex items-center"
              >
                <div className="flex-1 h-px bg-border/60" />
                <button
                  type="button"
                  onClick={() => setShowEmailForm(v => !v)}
                  className="mx-3 text-xs text-muted-foreground hover:text-foreground transition-colors select-none whitespace-nowrap"
                >
                  or sign in with email
                </button>
                <div className="flex-1 h-px bg-border/60" />
              </motion.div>

              {/* Email/password form — collapsible */}
              <AnimatePresence>
                {showEmailForm && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1" noValidate>
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
                        disabled={isPending || googleLoading}
                      >
                        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isPending ? "Signing in…" : "Sign In"}
                      </Button>
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Footer */}
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.35 }}
                className="text-center text-sm text-muted-foreground"
              >
                Don&apos;t have an account?{" "}
                <Link href="/register" className="font-semibold text-primary hover:underline">
                  Sign up
                </Link>
              </motion.p>
            </div>

            {/* Bottom gradient line */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
          </div>

          {/* Legal note */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.35 }}
            className="mt-4 text-center text-xs text-muted-foreground/60"
          >
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </motion.p>
        </motion.div>
      </div>
    </>
  );
}
