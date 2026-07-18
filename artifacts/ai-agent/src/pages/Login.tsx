/**
 * Login — Spider AI Platform
 *
 * Cinematic splash → premium glass login card.
 * Animation: CSS transforms + opacity only — GPU-accelerated, 60 FPS.
 * No canvas · No particles · No WebGL · No Lottie · SVG-only.
 */

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link, useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "sonner";
import {
  useState,
  useEffect,
  useCallback,
  useId,
  useRef,
} from "react";
import {
  motion,
  AnimatePresence,
  useAnimation,
  useReducedMotion,
} from "framer-motion";

// ── Zod schema ─────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email:    z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required").min(8, "At least 8 characters"),
});
type LoginFormValues = z.infer<typeof loginSchema>;

// ── Color tokens ───────────────────────────────────────────────────────────────

const RED       = "#FF1A1A";
const RED_HOVER = "#FF3333";
const RED_DIM   = "#CC1111";

// ── Global CSS keyframes (injected once, GPU-accelerated) ──────────────────────

const KEYFRAMES = `
  /* Spider outer float — slow, 2 px up/down with a tiny sway */
  @keyframes spiderFloat {
    0%,100% { transform: translateY(0px) rotate(0deg); }
    20%     { transform: translateY(-1px) rotate(0.4deg); }
    40%     { transform: translateY(-2px) rotate(0.6deg); }
    60%     { transform: translateY(-1px) rotate(0deg); }
    70%     { transform: translateY(0px)  rotate(0deg); }
    85%     { transform: translateY(1.5px) rotate(-0.4deg); }
  }
  /* Full body breathe — very subtle scale */
  @keyframes spiderBreathe {
    0%,100% { transform: scale(1); }
    50%     { transform: scale(1.018); }
  }
  /* Red glow pulse — low opacity, slow */
  @keyframes spiderGlow {
    0%,100% {
      filter:
        drop-shadow(0 3px 10px rgba(255,26,26,0.10))
        drop-shadow(0 0  5px rgba(255,26,26,0.06));
    }
    50% {
      filter:
        drop-shadow(0 3px 18px rgba(255,26,26,0.30))
        drop-shadow(0 0  10px rgba(255,26,26,0.16));
    }
  }
  /* Glow during auth loading — stronger pulse */
  @keyframes spiderGlowAuth {
    0%,100% { filter: drop-shadow(0 0 6px rgba(255,26,26,0.18)); }
    50%     { filter: drop-shadow(0 0 28px rgba(255,26,26,0.60)); }
  }
  /* Front leg pair — tiny forward/back lean */
  @keyframes legsF {
    0%,100% { transform: rotate(0deg); }
    50%     { transform: rotate(0.8deg); }
  }
  /* Back leg pair — opposite phase */
  @keyframes legsB {
    0%,100% { transform: rotate(0deg); }
    50%     { transform: rotate(-0.6deg); }
  }
  /* Shadow cast below spider — mirrors float */
  @keyframes spiderShadow {
    0%,100% { opacity: 0.22; transform: translateX(-50%) scaleX(1); }
    40%     { opacity: 0.30; transform: translateX(-50%) scaleX(1.2); }
    70%     { opacity: 0.16; transform: translateX(-50%) scaleX(0.9); }
  }
  /* Splash fade-in from black */
  @keyframes splashFadeIn {
    from { opacity: 0; transform: scale(0.88); }
    to   { opacity: 1; transform: scale(1); }
  }
`;

// Inject keyframes once into the document head
let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected || typeof document === "undefined") return;
  const el = document.createElement("style");
  el.textContent = KEYFRAMES;
  document.head.appendChild(el);
  keyframesInjected = true;
}

// ── Spider SVG — pure CSS animated ────────────────────────────────────────────

interface SpiderProps {
  size: number;
  id: string;
  /** True while the login mutation is in-flight */
  authenticating?: boolean;
  /** Override float animation (for splash phases) */
  noFloat?: boolean;
  /** Show body only (no legs) */
  bodyOnly?: boolean;
  /** Front legs only */
  frontLegsOnly?: boolean;
  /** Fixed glow filter override */
  glowStyle?: string;
}

function SpiderSVG({
  size,
  id,
  authenticating = false,
  noFloat = false,
  bodyOnly = false,
  frontLegsOnly = false,
  glowStyle,
}: SpiderProps) {
  ensureKeyframes();

  const floatAnim = noFloat
    ? "none"
    : "spiderFloat 10s ease-in-out infinite, spiderFloat 10s ease-in-out infinite";

  const glowAnim = glowStyle
    ? undefined
    : authenticating
    ? "spiderGlowAuth 1.4s ease-in-out infinite"
    : "spiderGlow 7s ease-in-out 1s infinite";

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {/* Ground shadow */}
      {!noFloat && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: -10,
            left: "50%",
            width: "50%",
            height: 5,
            borderRadius: "50%",
            background: "rgba(255,26,26,0.22)",
            filter: "blur(6px)",
            animation: "spiderShadow 10s ease-in-out infinite",
            willChange: "opacity, transform",
          }}
        />
      )}

      {/* Float + sway wrapper */}
      <div
        style={{
          animation: noFloat ? "none" : "spiderFloat 10s ease-in-out infinite",
          willChange: "transform",
        }}
      >
        {/* Breathe + glow wrapper */}
        <div
          style={{
            animation: [
              !noFloat && "spiderBreathe 8s ease-in-out infinite",
              glowStyle ? "" : glowAnim,
            ].filter(Boolean).join(", ") || undefined,
            willChange: "transform, filter",
            filter: glowStyle,
          }}
        >
          <svg
            width={size}
            height={size}
            viewBox="0 0 120 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Spider — Official brand mark"
          >
            <defs>
              <radialGradient id={`${id}-ab`} cx="48%" cy="34%" r="62%">
                <stop offset="0%"   stopColor="#FF4444" />
                <stop offset="50%"  stopColor={RED} />
                <stop offset="100%" stopColor="#7A0D0D" />
              </radialGradient>
              <radialGradient id={`${id}-th`} cx="50%" cy="28%" r="60%">
                <stop offset="0%"   stopColor="#FF3A3A" />
                <stop offset="100%" stopColor="#9A1010" />
              </radialGradient>
            </defs>

            {/* ── Legs ── */}
            {!bodyOnly && (
              <>
                {/* Front legs — tiny forward lean animation */}
                <g
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transformBox: "fill-box",
                    transformOrigin: "center",
                    animation: frontLegsOnly || !frontLegsOnly
                      ? "legsF 4s ease-in-out infinite"
                      : undefined,
                    willChange: "transform",
                  }}
                >
                  <path d="M 46,46 L 30,31 L 11,19"  stroke={RED}    strokeWidth="3.2" />
                  <path d="M 74,46 L 90,31 L 109,19"  stroke={RED}    strokeWidth="3.2" />
                  <path d="M 46,54 L 26,46 L  6,42"  stroke={RED_DIM} strokeWidth="2.9" />
                  <path d="M 74,54 L 94,46 L 114,42"  stroke={RED_DIM} strokeWidth="2.9" />
                </g>

                {/* Back legs — opposite phase, only when all legs visible */}
                {!frontLegsOnly && (
                  <g
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      transformBox: "fill-box",
                      transformOrigin: "center",
                      animation: "legsB 5.5s 1.5s ease-in-out infinite",
                      willChange: "transform",
                    }}
                  >
                    <path d="M 46,63 L 25,68 L  6,73"  stroke={RED_DIM} strokeWidth="2.9" />
                    <path d="M 74,63 L 95,68 L 114,73"  stroke={RED_DIM} strokeWidth="2.9" />
                    <path d="M 46,71 L 29,86 L 13,100" stroke={RED}    strokeWidth="3.0" />
                    <path d="M 74,71 L 91,86 L 107,100" stroke={RED}    strokeWidth="3.0" />
                  </g>
                )}
              </>
            )}

            {/* ── Body (abdomen + thorax + head) ── */}
            {/* Abdomen */}
            <ellipse cx="60" cy="77" rx="21" ry="25" fill={`url(#${id}-ab)`} />
            <ellipse cx="60" cy="71" rx="9"  ry="6"   fill="rgba(0,0,0,0.20)" />
            <ellipse cx="60" cy="81" rx="7"  ry="5"   fill="rgba(0,0,0,0.15)" />
            <ellipse cx="60" cy="90" rx="5"  ry="3.5" fill="rgba(0,0,0,0.12)" />
            <ellipse cx="54" cy="65" rx="4"  ry="3"   fill="rgba(255,80,80,0.12)" />
            {/* Thorax */}
            <ellipse cx="60" cy="51" rx="13" ry="12" fill={`url(#${id}-th)`} />
            {/* Head */}
            <circle  cx="60" cy="36" r="9"           fill={`url(#${id}-th)`} />
            {/* Eyes */}
            <circle  cx="55.5" cy="34"   r="2.3"     fill="rgba(0,0,0,0.78)" />
            <circle  cx="64.5" cy="34"   r="2.3"     fill="rgba(0,0,0,0.78)" />
            <circle  cx="56.2" cy="33.1" r="0.7"     fill="rgba(255,255,255,0.60)" />
            <circle  cx="65.2" cy="33.1" r="0.7"     fill="rgba(255,255,255,0.60)" />
            {/* Pedipalps */}
            <path d="M 53,29 Q 47,22 43,17" stroke={RED} strokeWidth="2.0" strokeLinecap="round" />
            <path d="M 67,29 Q 73,22 77,17" stroke={RED} strokeWidth="2.0" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ── Splash screen ──────────────────────────────────────────────────────────────

type SplashPhase = "hidden" | "body" | "legs-front" | "legs-all" | "breathing" | "exit";

interface SplashProps { onComplete: () => void }

function SplashScreen({ onComplete }: SplashProps) {
  const reduced = useReducedMotion();
  const id      = useId().replace(/:/g, "sp");
  const [phase, setPhase] = useState<SplashPhase>("hidden");
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (reduced) { onComplete(); return; }

    const t: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => t.push(setTimeout(fn, ms));

    at(300,  () => setPhase("body"));
    at(800,  () => setPhase("legs-front"));
    at(1300, () => setPhase("legs-all"));
    at(2000, () => setPhase("breathing"));
    at(3000, () => setExiting(true));
    at(3700, () => onComplete());

    return () => t.forEach(clearTimeout);
  }, [reduced, onComplete]);

  if (reduced) return null;

  const bodyVisible  = phase !== "hidden";
  const frontLegs    = phase !== "hidden" && phase !== "body";
  const allLegs      = !["hidden", "body", "legs-front"].includes(phase);
  const breathing    = phase === "breathing";
  const glowIntensity = breathing ? 0.7 : allLegs ? 0.3 : 0;

  const glowFilter = glowIntensity > 0
    ? `drop-shadow(0 0 ${Math.round(glowIntensity * 28)}px rgba(255,26,26,${(glowIntensity * 0.55).toFixed(2)}))`
    : undefined;

  return (
    <motion.div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        background: "radial-gradient(ellipse 60% 50% at 50% 45%, rgba(80,0,0,0.18) 0%, #000 70%)",
        zIndex: 100,
      }}
      animate={exiting ? { opacity: 0, scale: 1.04 } : { opacity: 1, scale: 1 }}
      transition={exiting ? { duration: 0.65, ease: "easeInOut" } : { duration: 0 }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.82 }}
        animate={bodyVisible ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.82 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <SpiderSVG
          size={120}
          id={id}
          noFloat={!breathing}
          bodyOnly={!frontLegs}
          frontLegsOnly={frontLegs && !allLegs}
          glowStyle={glowFilter}
        />
      </motion.div>
    </motion.div>
  );
}

// ── Google & GitHub icons ──────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// ── OAuth button ───────────────────────────────────────────────────────────────

type OAuthProvider = "google" | "github";

function OAuthButton({
  provider, disabled, loading, onClick,
}: { provider: OAuthProvider; disabled: boolean; loading: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const cfg = {
    google: { label: "Continue with Google", icon: <GoogleIcon /> },
    github: { label: "Continue with GitHub",  icon: <GitHubIcon /> },
  }[provider];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: "100%",
        height: 52,
        borderRadius: 14,
        background: hovered ? "#141414" : "#0C0C0C",
        border: `1px solid ${hovered ? "rgba(255,26,26,0.40)" : "rgba(255,255,255,0.07)"}`,
        boxShadow: hovered ? "0 0 12px rgba(255,26,26,0.10)" : "none",
        color: "#E8E8E8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.01em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.50 : 1,
        transform: pressed && !disabled ? "scale(0.985)" : "scale(1)",
        transition: "background 0.2s, border-color 0.2s, box-shadow 0.2s, transform 0.12s",
        fontFamily: "inherit",
        outline: "none",
      }}
      aria-label={cfg.label}
    >
      {cfg.icon}
      <span>{loading ? "Redirecting…" : cfg.label}</span>
    </button>
  );
}

// ── Divider ────────────────────────────────────────────────────────────────────

function Divider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(to right, transparent, rgba(255,255,255,0.07))" }} />
      <span style={{ color: "#444", fontSize: 11, letterSpacing: "0.10em", whiteSpace: "nowrap", userSelect: "none" }}>
        OR SIGN IN WITH EMAIL
      </span>
      <div style={{ flex: 1, height: 1, background: "linear-gradient(to left, transparent, rgba(255,255,255,0.07))" }} />
    </div>
  );
}

// ── Input field ────────────────────────────────────────────────────────────────

interface InputFieldProps {
  id: string;
  label: string;
  type: string;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  hasError?: boolean;
  suffix?: React.ReactNode;
  registration: React.InputHTMLAttributes<HTMLInputElement>;
}

function InputField({ id, label, type, placeholder, autoComplete, error, hasError, suffix, registration }: InputFieldProps) {
  const [focused, setFocused] = useState(false);
  const shakeAnim = useAnimation();

  useEffect(() => {
    if (hasError) {
      shakeAnim.start({
        x: [0, -7, 7, -5, 5, -2, 2, 0],
        transition: { duration: 0.42, ease: "easeInOut" },
      });
    }
  }, [hasError, shakeAnim]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <label
          htmlFor={id}
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.11em",
            color: "#555",
            textTransform: "uppercase",
          }}
        >
          {label}
        </label>
      )}

      <motion.div animate={shakeAnim} style={{ position: "relative" }}>
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-invalid={hasError}
          aria-describedby={error ? `${id}-error` : undefined}
          style={{
            width: "100%",
            height: 52,
            borderRadius: 12,
            background: "#080808",
            border: `1px solid ${
              hasError ? "rgba(255,26,26,0.70)"
              : focused  ? "rgba(255,26,26,0.50)"
              :            "rgba(255,255,255,0.08)"
            }`,
            boxShadow: focused
              ? "0 0 0 3px rgba(255,26,26,0.08)"
              : hasError
              ? "0 0 0 2px rgba(255,26,26,0.06)"
              : "none",
            color: "#F0F0F0",
            fontSize: 14,
            padding: suffix ? "0 48px 0 16px" : "0 16px",
            outline: "none",
            caretColor: RED,
            transition: "border-color 0.18s, box-shadow 0.18s",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
          {...registration}
        />
        {suffix && (
          <div style={{
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
          }}>
            {suffix}
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.p
            id={`${id}-error`}
            role="alert"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
            style={{ fontSize: 12, color: "#FF3333", margin: 0, display: "flex", alignItems: "center", gap: 5 }}
          >
            <span style={{ display: "inline-block", width: 4, height: 4, borderRadius: "50%", background: "#FF3333", flexShrink: 0 }} />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sign In button ─────────────────────────────────────────────────────────────

function SignInButton({
  loading,
  disabled,
  spiderId,
}: { loading: boolean; disabled: boolean; spiderId: string }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      type="submit"
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: "100%",
        height: 52,
        borderRadius: 14,
        background: hovered && !disabled ? RED_HOVER : RED,
        border: "none",
        color: "#FFFFFF",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.60 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        boxShadow: hovered && !disabled
          ? "0 0 24px rgba(255,26,26,0.45), 0 4px 14px rgba(255,26,26,0.25)"
          : "0 0 12px rgba(255,26,26,0.20), 0 2px 6px rgba(255,26,26,0.12)",
        transform: pressed && !disabled ? "scale(0.985)" : "scale(1)",
        transition: "background 0.2s, box-shadow 0.2s, transform 0.12s",
        fontFamily: "inherit",
        outline: "none",
      }}
      aria-label={loading ? "Authenticating…" : "Sign In"}
    >
      {/* Inline micro spider mark — glows while loading */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 120 120"
        fill="none"
        aria-hidden="true"
        style={{
          willChange: "filter",
          animation: loading ? "spiderGlowAuth 1.4s ease-in-out infinite" : "none",
        }}
      >
        <ellipse cx="60" cy="74" rx="18" ry="22" fill="rgba(255,255,255,0.92)" />
        <ellipse cx="60" cy="50" rx="11" ry="10" fill="rgba(255,255,255,0.92)" />
        <circle  cx="60" cy="35" r="8"           fill="rgba(255,255,255,0.88)" />
        <path d="M 47,46 L 28,28" stroke="rgba(255,255,255,0.85)" strokeWidth="4" strokeLinecap="round" />
        <path d="M 73,46 L 92,28" stroke="rgba(255,255,255,0.85)" strokeWidth="4" strokeLinecap="round" />
        <path d="M 47,55 L 22,44" stroke="rgba(255,255,255,0.72)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 73,55 L 98,44" stroke="rgba(255,255,255,0.72)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 47,64 L 24,72" stroke="rgba(255,255,255,0.65)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 73,64 L 96,72" stroke="rgba(255,255,255,0.65)" strokeWidth="3.5" strokeLinecap="round" />
        <path d="M 47,72 L 30,88" stroke="rgba(255,255,255,0.72)" strokeWidth="4" strokeLinecap="round" />
        <path d="M 73,72 L 90,88" stroke="rgba(255,255,255,0.72)" strokeWidth="4" strokeLinecap="round" />
      </svg>

      <span>{loading ? "Authenticating…" : "Sign In"}</span>
    </button>
  );
}

// ── Eye icon ───────────────────────────────────────────────────────────────────

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ── Red link ───────────────────────────────────────────────────────────────────

function RedLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link href={href}>
      <span
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          color: hovered ? RED_HOVER : RED,
          fontWeight: 600,
          textDecoration: hovered ? "underline" : "none",
          textUnderlineOffset: 3,
          cursor: "pointer",
          transition: "color 0.15s",
        }}
      >
        {children}
      </span>
    </Link>
  );
}

// ── Stagger helper ─────────────────────────────────────────────────────────────

const DELAY = 0.065;
const fadeUp = (i: number) => ({
  initial:    { opacity: 0, y: 7 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.24, delay: i * DELAY, ease: "easeOut" },
});

// ── Main export ────────────────────────────────────────────────────────────────

export default function Login() {
  const [, setLocation]  = useLocation();
  const { login: authenticate, isAuthenticated } = useAuth();
  const [showPassword,   setShowPassword]  = useState(false);
  const [loadingOAuth,   setLoadingOAuth]  = useState<OAuthProvider | null>(null);
  const [oauthError,     setOauthError]    = useState<string | null>(null);
  const skipSplash = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("nosplash") === "1";
  const [splashDone, setSplashDone] = useState(skipSplash);
  const uid = useId().replace(/:/g, "lg");

  useEffect(() => {
    ensureKeyframes();
  }, []);

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
        authenticate({
          access_token:  res.access_token,
          refresh_token: res.refresh_token,
          token_type:    res.token_type,
        });
        toast.success("Welcome back!");
        setLocation("/dashboard");
      },
      onError: (err) => {
        const message =
          (err as { data?: { error?: string } }).data?.error ||
          "Please check your credentials and try again.";
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
        setOauthError(
          body.error ??
          `${provider === "google" ? "Google" : "GitHub"} sign-in is not available right now.`
        );
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
  const onSplashComplete = useCallback(() => setSplashDone(true), []);

  return (
    <>
      {/* ── Page background: pure black + barely-visible radial glow ── */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: `
            radial-gradient(ellipse 70% 55% at 50% 38%, rgba(120,0,0,0.12) 0%, transparent 70%),
            radial-gradient(ellipse 50% 40% at 50% 85%, rgba(80,0,0,0.08) 0%, transparent 60%),
            #000000
          `,
          zIndex: 0,
        }}
      />

      {/* ── Splash ── */}
      <AnimatePresence>
        {!splashDone && (
          <SplashScreen key="splash" onComplete={onSplashComplete} />
        )}
      </AnimatePresence>

      {/* ── Login content ── */}
      <AnimatePresence>
        {splashDone && (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            style={{
              position: "relative",
              zIndex: 10,
              minHeight: "100vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "24px 16px",
            }}
          >
            {/* ── Glass Card ── */}
            <div
              style={{
                width: "100%",
                maxWidth: 420,
                background: "rgba(10,10,10,0.90)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                borderRadius: 20,
                border: "1px solid rgba(255,26,26,0.12)",
                boxShadow: `
                  0 0 0 1px rgba(255,255,255,0.04),
                  0 24px 56px rgba(0,0,0,0.85),
                  0 8px 20px rgba(0,0,0,0.55),
                  inset 0 1px 0 rgba(255,255,255,0.04)
                `,
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Top accent line */}
              <div style={{
                position: "absolute", top: 0, left: "20%", right: "20%", height: 1,
                background: "linear-gradient(to right, transparent, rgba(255,26,26,0.50), transparent)",
              }} />

              <div style={{ padding: "36px 32px 32px" }}>

                {/* ── Header ── */}
                <motion.div {...fadeUp(0)} style={{ textAlign: "center", marginBottom: 28 }}>
                  {/* Spider — full CSS animated, alive */}
                  <div style={{ display: "inline-block", marginBottom: 18 }}>
                    <SpiderSVG
                      size={88}
                      id={`${uid}-card`}
                      authenticating={isPending}
                    />
                  </div>

                  <h1 style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: "#FFFFFF",
                    margin: "0 0 6px",
                    letterSpacing: "-0.025em",
                    lineHeight: 1.2,
                  }}>
                    Intelligence Starts Here
                  </h1>
                  <p style={{
                    fontSize: 13,
                    color: "#555",
                    margin: 0,
                    letterSpacing: "0.01em",
                  }}>
                    Sign in to your AI workspace
                  </p>
                </motion.div>

                {/* ── OAuth ── */}
                <motion.div {...fadeUp(1)} style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: 22 }}>
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
                        style={{ fontSize: 12, color: "#886600", textAlign: "center", margin: 0 }}
                      >
                        {oauthError.includes("not configured") || oauthError.includes("disabled")
                          ? "Social sign-in isn't enabled yet — use email & password below."
                          : oauthError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>

                {/* ── Divider ── */}
                <motion.div {...fadeUp(2)} style={{ marginBottom: 20 }}>
                  <Divider />
                </motion.div>

                {/* ── Form ── */}
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  noValidate
                  style={{ display: "flex", flexDirection: "column", gap: 14 }}
                >
                  {/* Email */}
                  <motion.div {...fadeUp(3)}>
                    <InputField
                      id="email"
                      label="Email"
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      error={errors.email?.message}
                      hasError={!!errors.email}
                      registration={form.register("email")}
                    />
                  </motion.div>

                  {/* Password */}
                  <motion.div {...fadeUp(4)}>
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                    }}>
                      <label
                        htmlFor="password"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.11em",
                          color: "#555",
                          textTransform: "uppercase",
                        }}
                      >
                        Password
                      </label>
                      <RedLink href="/forgot-password">Forgot password?</RedLink>
                    </div>
                    <InputField
                      id="password"
                      label=""
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      error={errors.password?.message}
                      hasError={!!errors.password}
                      registration={form.register("password")}
                      suffix={
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword(v => !v)}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "#484848",
                            display: "flex",
                            alignItems: "center",
                            padding: 2,
                            transition: "color 0.15s",
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = RED)}
                          onMouseLeave={e => (e.currentTarget.style.color = "#484848")}
                        >
                          <EyeIcon open={showPassword} />
                        </button>
                      }
                    />
                  </motion.div>

                  {/* Submit */}
                  <motion.div {...fadeUp(5)} style={{ marginTop: 4 }}>
                    <SignInButton
                      loading={isPending}
                      disabled={isPending || anyOAuthLoading}
                      spiderId={uid}
                    />
                  </motion.div>
                </form>

                {/* ── Sign up ── */}
                <motion.p
                  {...fadeUp(6)}
                  style={{
                    textAlign: "center",
                    fontSize: 13,
                    color: "#444",
                    marginTop: 20,
                    marginBottom: 0,
                  }}
                >
                  Don&apos;t have an account?{" "}
                  <RedLink href="/register">Sign up</RedLink>
                </motion.p>
              </div>

              {/* Bottom accent */}
              <div style={{
                position: "absolute", bottom: 0, left: "30%", right: "30%", height: 1,
                background: "linear-gradient(to right, transparent, rgba(255,255,255,0.04), transparent)",
              }} />
            </div>

            {/* ── Footer ── */}
            <motion.p
              {...fadeUp(7)}
              style={{
                marginTop: 20,
                fontSize: 11,
                color: "#2A2A2A",
                textAlign: "center",
                letterSpacing: "0.02em",
              }}
            >
              By continuing, you agree to our Terms of Service and Privacy Policy.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
