/**
 * Project 7 — Logo Component
 *
 * The "7" numeral is the brand mark. This component renders it in every
 * context: sidebar, header, login, splash, favicon, etc.
 *
 * Motion states mirror the AI system states:
 *   idle        → soft breathing glow
 *   pulse       → energy pulse (thinking)
 *   generating  → light sweeps through the mark
 *   loading     → the mark draws itself
 *   success     → green flash
 *   warning     → amber pulse
 *   failure     → red glow + shake
 *   float       → gentle vertical float
 *   static      → no animation
 */

import { motion, useAnimation, useReducedMotion, type Variants } from "framer-motion";
import { useEffect, useId } from "react";
import { cn } from "@/lib/utils";

export type LogoSize     = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type LogoVariant  = "full" | "icon" | "wordmark";
export type LogoAnimate  =
  | "idle" | "pulse" | "generating" | "loading"
  | "success" | "warning" | "failure" | "float" | "glow" | "static";

interface LogoProps {
  size?:          LogoSize;
  variant?:       LogoVariant;
  animate?:       LogoAnimate;
  className?:     string;
  iconClassName?: string;
  textClassName?: string;
  entrance?:      boolean;
}

const PX: Record<LogoSize, number> = {
  xs: 16, sm: 22, md: 30, lg: 42, xl: 60, "2xl": 86,
};

const TEXT: Record<LogoSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-2xl",
  "2xl": "text-4xl",
};

const GAPS: Record<LogoSize, string> = {
  xs: "gap-1", sm: "gap-1.5", md: "gap-2", lg: "gap-2.5", xl: "gap-3", "2xl": "gap-4",
};

/* ── The "7" SVG Mark ─────────────────────────────────────────────────────── */

interface SevenMarkProps {
  size: number;
  gradId: string;
  motionClass?: string;
}

function SevenMark({ size, gradId, motionClass }: SevenMarkProps) {
  const vb = 60;
  const scale = size / vb;

  const sw   = 10;
  const swMd = 8;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={motionClass}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={`${gradId}-a`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#a5b4fc" />
          <stop offset="45%"  stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
        <linearGradient id={`${gradId}-b`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#c7d2fe" />
          <stop offset="100%" stopColor="#4f46e5" />
        </linearGradient>
        <radialGradient id={`${gradId}-glow`} cx="50%" cy="30%" r="60%">
          <stop offset="0%"   stopColor="#818cf8" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0"   />
        </radialGradient>
        <filter id={`${gradId}-blur`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={size * 0.12} result="blur" />
        </filter>

        <linearGradient id={`${gradId}-success`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#86efac" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
        <linearGradient id={`${gradId}-warning`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#fde68a" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id={`${gradId}-error`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#fca5a5" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>

      {/* Glow bloom behind the mark */}
      <ellipse
        cx={vb * 0.52}
        cy={vb * 0.42}
        rx={vb * 0.4}
        ry={vb * 0.35}
        fill={`url(#${gradId}-glow)`}
        filter={`url(#${gradId}-blur)`}
      />

      {/* Top horizontal bar */}
      <line
        x1={8}  y1={11}
        x2={52} y2={11}
        stroke={`url(#${gradId}-a)`}
        strokeWidth={sw}
        strokeLinecap="round"
      />

      {/* Diagonal stem */}
      <line
        x1={52} y1={11}
        x2={22} y2={52}
        stroke={`url(#${gradId}-b)`}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Midline — European "7" accent */}
      <line
        x1={16} y1={31}
        x2={36} y2={31}
        stroke={`url(#${gradId}-a)`}
        strokeWidth={swMd * 0.75}
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
}

/* ── Animated wrapper ─────────────────────────────────────────────────────── */

function useSevenAnimation(animate: LogoAnimate, reduced: boolean) {
  const controls = useAnimation();

  useEffect(() => {
    if (reduced || animate === "static") return;

    if (animate === "idle" || animate === "glow") {
      controls.start({
        filter: [
          "drop-shadow(0 0 4px rgba(129,140,248,0.25))",
          "drop-shadow(0 0 16px rgba(129,140,248,0.75))",
          "drop-shadow(0 0 4px rgba(129,140,248,0.25))",
        ],
        transition: { duration: 3, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (animate === "pulse") {
      controls.start({
        scale: [1, 1.10, 1],
        filter: [
          "drop-shadow(0 0 6px rgba(129,140,248,0.4))",
          "drop-shadow(0 0 22px rgba(129,140,248,0.9))",
          "drop-shadow(0 0 6px rgba(129,140,248,0.4))",
        ],
        transition: { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (animate === "float") {
      controls.start({
        y: [0, -5, 0],
        filter: [
          "drop-shadow(0 0 4px rgba(129,140,248,0.3))",
          "drop-shadow(0 0 12px rgba(129,140,248,0.6))",
          "drop-shadow(0 0 4px rgba(129,140,248,0.3))",
        ],
        transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (animate === "generating") {
      controls.start({
        filter: [
          "drop-shadow(0 0 8px rgba(129,140,248,0.5)) brightness(1)",
          "drop-shadow(0 0 24px rgba(165,180,252,1.0)) brightness(1.25)",
          "drop-shadow(0 0 8px rgba(129,140,248,0.5)) brightness(1)",
        ],
        transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (animate === "success") {
      controls.start({
        filter: [
          "drop-shadow(0 0 0px rgba(74,222,128,0))",
          "drop-shadow(0 0 28px rgba(74,222,128,1))",
          "drop-shadow(0 0 10px rgba(74,222,128,0.4))",
        ],
        transition: { duration: 0.9, ease: "easeOut" },
      });
    } else if (animate === "warning") {
      controls.start({
        filter: [
          "drop-shadow(0 0 8px rgba(251,191,36,0.4))",
          "drop-shadow(0 0 22px rgba(251,191,36,0.9))",
          "drop-shadow(0 0 8px rgba(251,191,36,0.4))",
        ],
        transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (animate === "failure") {
      controls.start({
        x: [0, -5, 5, -4, 4, -2, 2, 0],
        filter: "drop-shadow(0 0 18px rgba(248,113,113,0.85))",
        transition: { duration: 0.55, ease: "easeInOut" },
      });
    } else if (animate === "loading") {
      controls.start({
        filter: [
          "drop-shadow(0 0 4px rgba(129,140,248,0.2))",
          "drop-shadow(0 0 20px rgba(129,140,248,0.8))",
          "drop-shadow(0 0 4px rgba(129,140,248,0.2))",
        ],
        transition: { duration: 2, repeat: Infinity, ease: "easeInOut" },
      });
    }
  }, [animate, reduced, controls]);

  return controls;
}

/* ── Exported Logo component ──────────────────────────────────────────────── */

export function Logo({
  size     = "md",
  variant  = "full",
  animate  = "idle",
  className,
  iconClassName,
  textClassName,
  entrance = true,
}: LogoProps) {
  const prefersReduced = useReducedMotion();
  const uid            = useId().replace(/:/g, "");
  const gradId         = `seven-${uid}`;
  const controls       = useSevenAnimation(
    prefersReduced ? "static" : animate,
    !!prefersReduced,
  );
  const px = PX[size];

  const entranceVariants: Variants = {
    hidden:  { opacity: 0, scale: 0.75, y: 8 },
    visible: { opacity: 1, scale: 1,    y: 0,
      transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  };

  const wrapperVariants: Variants = {
    hidden:  {},
    visible: { transition: { staggerChildren: 0.08 } },
  };

  const textVariants: Variants = {
    hidden:  { opacity: 0, x: -6 },
    visible: { opacity: 1, x: 0,
      transition: { duration: 0.32, ease: "easeOut" } },
  };

  const iconEl = (
    <motion.div
      className={cn("flex-shrink-0 cursor-default select-none", iconClassName)}
      animate={controls}
      whileHover={
        !prefersReduced
          ? { scale: 1.14, filter: "drop-shadow(0 0 16px rgba(129,140,248,0.9))",
              transition: { duration: 0.18 } }
          : undefined
      }
    >
      <SevenMark size={px} gradId={gradId} />
    </motion.div>
  );

  const textEl = variant !== "icon" && (
    <motion.span
      variants={entrance ? textVariants : undefined}
      className={cn(
        "font-bold tracking-tight leading-none select-none",
        TEXT[size],
        textClassName,
      )}
    >
      7
    </motion.span>
  );

  if (variant === "icon") {
    return entrance ? (
      <motion.div
        className={cn("inline-flex", className)}
        variants={entranceVariants}
        initial="hidden"
        animate="visible"
      >
        {iconEl}
      </motion.div>
    ) : (
      <div className={cn("inline-flex", className)}>{iconEl}</div>
    );
  }

  if (variant === "wordmark") {
    return entrance ? (
      <motion.span
        variants={textVariants}
        initial="hidden"
        animate="visible"
        className={cn("font-bold tracking-tight leading-none select-none",
          TEXT[size], className, textClassName)}
      >
        7
      </motion.span>
    ) : (
      <span className={cn("font-bold tracking-tight leading-none select-none",
        TEXT[size], className, textClassName)}>
        7
      </span>
    );
  }

  return entrance ? (
    <motion.div
      className={cn("inline-flex items-center", GAPS[size], className)}
      variants={wrapperVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={entranceVariants}>{iconEl}</motion.div>
      {textEl}
    </motion.div>
  ) : (
    <div className={cn("inline-flex items-center", GAPS[size], className)}>
      {iconEl}
      {variant === "full" && (
        <span className={cn("font-bold tracking-tight leading-none select-none",
          TEXT[size], textClassName)}>
          7
        </span>
      )}
    </div>
  );
}
