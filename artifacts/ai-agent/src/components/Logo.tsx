import { motion, useAnimation, useReducedMotion, type Variants } from "framer-motion";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type LogoSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type LogoVariant = "full" | "icon" | "wordmark";
export type LogoAnimate = "pulse" | "float" | "glow" | "static";

interface LogoProps {
  size?: LogoSize;
  variant?: LogoVariant;
  animate?: LogoAnimate;
  className?: string;
  iconClassName?: string;
  textClassName?: string;
  entrance?: boolean;
}

const iconSizes: Record<LogoSize, number> = {
  xs: 16,
  sm: 20,
  md: 28,
  lg: 40,
  xl: 56,
  "2xl": 80,
};

const textSizes: Record<LogoSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
  xl: "text-2xl",
  "2xl": "text-4xl",
};

const gaps: Record<LogoSize, string> = {
  xs: "gap-1",
  sm: "gap-1.5",
  md: "gap-2",
  lg: "gap-2.5",
  xl: "gap-3",
  "2xl": "gap-4",
};

function ChipSVG({ size, glowId }: { size: number; glowId: string }) {
  const s = size;
  const pad = s * 0.13;
  const r = s * 0.18;
  const inner = s - pad * 2;
  const pinLen = s * 0.12;
  const pinW = s * 0.055;
  const pinGap = inner / 4;
  const centerR = s * 0.14;

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${glowId}-grad`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="50%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <linearGradient id={`${glowId}-inner`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <radialGradient id={`${glowId}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
        </radialGradient>
        <filter id={`${glowId}-blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={s * 0.06} result="blur" />
        </filter>
        <clipPath id={`${glowId}-clip`}>
          <rect x={pad} y={pad} width={inner} height={inner} rx={r} />
        </clipPath>
        <linearGradient id={`${glowId}-sweep`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="white" stopOpacity="0" />
          <stop offset="50%" stopColor="white" stopOpacity="0.25" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Glow bloom behind chip */}
      <rect
        x={pad - s * 0.04}
        y={pad - s * 0.04}
        width={inner + s * 0.08}
        height={inner + s * 0.08}
        rx={r + s * 0.04}
        fill={`url(#${glowId}-glow)`}
        filter={`url(#${glowId}-blur)`}
      />

      {/* Pins — left */}
      {[1, 2, 3].map((i) => (
        <rect
          key={`l${i}`}
          x={pad - pinLen}
          y={pad + pinGap * i - pinW / 2}
          width={pinLen}
          height={pinW}
          rx={pinW / 2}
          fill="#a855f7"
          opacity="0.8"
        />
      ))}

      {/* Pins — right */}
      {[1, 2, 3].map((i) => (
        <rect
          key={`r${i}`}
          x={pad + inner}
          y={pad + pinGap * i - pinW / 2}
          width={pinLen}
          height={pinW}
          rx={pinW / 2}
          fill="#a855f7"
          opacity="0.8"
        />
      ))}

      {/* Pins — top */}
      {[1, 2, 3].map((i) => (
        <rect
          key={`t${i}`}
          x={pad + pinGap * i - pinW / 2}
          y={pad - pinLen}
          width={pinW}
          height={pinLen}
          rx={pinW / 2}
          fill="#a855f7"
          opacity="0.8"
        />
      ))}

      {/* Pins — bottom */}
      {[1, 2, 3].map((i) => (
        <rect
          key={`b${i}`}
          x={pad + pinGap * i - pinW / 2}
          y={pad + inner}
          width={pinW}
          height={pinLen}
          rx={pinW / 2}
          fill="#a855f7"
          opacity="0.8"
        />
      ))}

      {/* Chip body */}
      <rect
        x={pad}
        y={pad}
        width={inner}
        height={inner}
        rx={r}
        fill={`url(#${glowId}-grad)`}
      />

      {/* Inner circuit lines */}
      <g clipPath={`url(#${glowId}-clip)`} opacity="0.3">
        <line x1={pad} y1={pad + inner * 0.35} x2={pad + inner} y2={pad + inner * 0.35} stroke="white" strokeWidth={s * 0.015} />
        <line x1={pad} y1={pad + inner * 0.65} x2={pad + inner} y2={pad + inner * 0.65} stroke="white" strokeWidth={s * 0.015} />
        <line x1={pad + inner * 0.35} y1={pad} x2={pad + inner * 0.35} y2={pad + inner} stroke="white" strokeWidth={s * 0.015} />
        <line x1={pad + inner * 0.65} y1={pad} x2={pad + inner * 0.65} y2={pad + inner} stroke="white" strokeWidth={s * 0.015} />
      </g>

      {/* Center circle / core */}
      <circle
        cx={s / 2}
        cy={s / 2}
        r={centerR}
        fill={`url(#${glowId}-inner)`}
        stroke="rgba(255,255,255,0.4)"
        strokeWidth={s * 0.02}
      />

      {/* Center symbol — stylized bolt / node */}
      <g transform={`translate(${s / 2}, ${s / 2})`}>
        <circle r={centerR * 0.42} fill="white" opacity="0.9" />
        <circle r={centerR * 0.18} fill={`url(#${glowId}-grad)`} />
      </g>

      {/* Shine sweep overlay */}
      <rect
        x={pad}
        y={pad}
        width={inner}
        height={inner}
        rx={r}
        fill={`url(#${glowId}-sweep)`}
        clipPath={`url(#${glowId}-clip)`}
      />
    </svg>
  );
}

let glowCounter = 0;

export function Logo({
  size = "md",
  variant = "full",
  animate = "glow",
  className,
  iconClassName,
  textClassName,
  entrance = true,
}: LogoProps) {
  const prefersReduced = useReducedMotion();
  const iconControls = useAnimation();
  const glowRef = useRef(`logo-glow-${++glowCounter}`);
  const glowId = glowRef.current;
  const px = iconSizes[size];

  const effectiveAnimate = prefersReduced ? "static" : animate;

  useEffect(() => {
    if (effectiveAnimate === "pulse") {
      iconControls.start({
        scale: [1, 1.06, 1],
        opacity: [1, 0.85, 1],
        transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (effectiveAnimate === "float") {
      iconControls.start({
        y: [0, -4, 0],
        transition: { duration: 3, repeat: Infinity, ease: "easeInOut" },
      });
    } else if (effectiveAnimate === "glow") {
      iconControls.start({
        filter: [
          "drop-shadow(0 0 2px rgba(168,85,247,0.3))",
          "drop-shadow(0 0 8px rgba(168,85,247,0.8))",
          "drop-shadow(0 0 2px rgba(168,85,247,0.3))",
        ],
        transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" },
      });
    }
  }, [effectiveAnimate, iconControls]);

  const entranceVariants: Variants = {
    hidden: { opacity: 0, scale: 0.8, y: 6 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const wrapperVariants: Variants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.08 } },
  };

  const textVariants: Variants = {
    hidden: { opacity: 0, x: -6 },
    visible: {
      opacity: 1,
      x: 0,
      transition: { duration: 0.35, ease: "easeOut" },
    },
  };

  const iconEl = (
    <motion.div
      className={cn("flex-shrink-0 cursor-default", iconClassName)}
      animate={iconControls}
      whileHover={
        !prefersReduced
          ? {
              scale: 1.12,
              filter: "drop-shadow(0 0 12px rgba(168,85,247,0.9))",
              transition: { duration: 0.2 },
            }
          : undefined
      }
    >
      <ChipSVG size={px} glowId={glowId} />
    </motion.div>
  );

  const textEl = variant !== "icon" && (
    <motion.span
      variants={entrance ? textVariants : undefined}
      className={cn(
        "font-bold tracking-tight leading-none select-none",
        textSizes[size],
        textClassName
      )}
    >
      AI Agent
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
        className={cn(
          "font-bold tracking-tight leading-none select-none",
          textSizes[size],
          className,
          textClassName
        )}
      >
        AI Agent
      </motion.span>
    ) : (
      <span
        className={cn(
          "font-bold tracking-tight leading-none select-none",
          textSizes[size],
          className,
          textClassName
        )}
      >
        AI Agent
      </span>
    );
  }

  return entrance ? (
    <motion.div
      className={cn("inline-flex items-center", gaps[size], className)}
      variants={wrapperVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.div variants={entranceVariants}>{iconEl}</motion.div>
      {textEl}
    </motion.div>
  ) : (
    <div className={cn("inline-flex items-center", gaps[size], className)}>
      {iconEl}
      {variant === "full" && (
        <span
          className={cn(
            "font-bold tracking-tight leading-none select-none",
            textSizes[size],
            textClassName
          )}
        >
          AI Agent
        </span>
      )}
    </div>
  );
}
