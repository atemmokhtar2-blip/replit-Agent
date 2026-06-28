/**
 * Project 7 — Cinematic Startup Sequence
 *
 * Plays once on first visit (localStorage key: "seven_intro_seen").
 * Sequence:
 *   0.0s  — Black screen, particles appear
 *   0.4s  — "7" begins drawing itself
 *   2.1s  — Glow expands, subtle zoom
 *   3.0s  — Pulse
 *   3.6s  — Shrink & fade out
 *   4.2s  — onComplete() fires → login page reveals
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

const INTRO_KEY = "seven_intro_seen";

export function hasSeenIntro(): boolean {
  try { return !!localStorage.getItem(INTRO_KEY); } catch { return false; }
}

function markIntroSeen() {
  try { localStorage.setItem(INTRO_KEY, "1"); } catch { /* ignore */ }
}

/* ── Particle ─────────────────────────────────────────────────────────────── */

interface ParticleData {
  id: number;
  x: number;
  y: number;
  r: number;
  delay: number;
  dur: number;
  opacity: number;
}

function Particles({ count = 36 }: { count?: number }) {
  const particles = useMemo<ParticleData[]>(() =>
    Array.from({ length: count }, (_, i) => ({
      id:      i,
      x:       Math.random() * 100,
      y:       20 + Math.random() * 60,
      r:       0.5 + Math.random() * 1.8,
      delay:   Math.random() * 3,
      dur:     3.5 + Math.random() * 2.5,
      opacity: 0.15 + Math.random() * 0.55,
    })),
  [count]);

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="seven-particle absolute rounded-full bg-indigo-400"
          style={{
            left:    `${p.x}%`,
            top:     `${p.y}%`,
            width:   `${p.r * 2}px`,
            height:  `${p.r * 2}px`,
            opacity: p.opacity,
            "--drift-delay": `${p.delay}s`,
            "--drift-dur":   `${p.dur}s`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/* ── Animated "7" path ────────────────────────────────────────────────────── */

function AnimatedSeven({ phase }: { phase: number }) {
  const size    = 160;
  const vb      = 60;
  const sw      = 10;
  const swMid   = 7;

  const pathRef   = useRef<SVGPathElement>(null);
  const midRef    = useRef<SVGLineElement>(null);

  const glowAmt = phase >= 2 ? 48 : phase >= 1 ? 18 : 0;
  const scale   = phase >= 2 ? 1.08 : 1;

  return (
    <motion.div
      animate={{
        scale,
        filter: `drop-shadow(0 0 ${glowAmt}px rgba(129,140,248,${phase >= 2 ? 0.95 : 0.4}))`,
      }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      style={{ willChange: "transform, filter" }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${vb} ${vb}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ overflow: "visible" }}
      >
        <defs>
          <linearGradient id="intro-grad-a" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#c7d2fe" />
            <stop offset="50%"  stopColor="#818cf8" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
          <linearGradient id="intro-grad-b" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%"   stopColor="#a5b4fc" />
            <stop offset="100%" stopColor="#4f46e5" />
          </linearGradient>
          <radialGradient id="intro-glow" cx="50%" cy="35%" r="55%">
            <stop offset="0%"   stopColor="#818cf8" stopOpacity={phase >= 2 ? 0.8 : 0.3} />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
          </radialGradient>
          <filter id="intro-blur" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* Ambient glow */}
        <motion.ellipse
          cx="52%" cy="38%" rx="45%" ry="40%"
          fill="url(#intro-glow)"
          filter="url(#intro-blur)"
          animate={{ opacity: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 0.6 }}
        />

        {/* Top bar */}
        <motion.line
          x1={8}  y1={11}
          x2={52} y2={11}
          stroke="url(#intro-grad-a)"
          strokeWidth={sw}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 0.7, delay: 0, ease: "easeOut" }}
        />

        {/* Diagonal stem */}
        <motion.line
          x1={52} y1={11}
          x2={22} y2={52}
          stroke="url(#intro-grad-b)"
          strokeWidth={sw}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 1.0, delay: 0.55, ease: "easeInOut" }}
        />

        {/* Midline */}
        <motion.line
          x1={16} y1={31}
          x2={36} y2={31}
          stroke="url(#intro-grad-a)"
          strokeWidth={swMid * 0.75}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: phase >= 1 ? 1 : 0, opacity: phase >= 1 ? 0.7 : 0 }}
          transition={{ duration: 0.45, delay: 1.1, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );
}

/* ── Wordmark ─────────────────────────────────────────────────────────────── */

function Wordmark({ phase }: { phase: number }) {
  return (
    <motion.div
      className="flex items-center gap-1 mt-6 select-none"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: phase >= 2 ? 0.8 : 0, y: phase >= 2 ? 0 : 8 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
    >
      <span className="text-sm font-light tracking-[0.35em] uppercase text-indigo-300/80">
        Project
      </span>
      <span className="text-sm font-bold tracking-wider text-indigo-200">
        7
      </span>
    </motion.div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

interface SevenIntroProps {
  onComplete: () => void;
}

export function SevenIntro({ onComplete }: SevenIntroProps) {
  const [phase, setPhase] = useState(0);
  const [visible, setVisible] = useState(true);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      markIntroSeen();
      onComplete();
      return;
    }

    const t0 = setTimeout(() => setPhase(1), 400);
    const t1 = setTimeout(() => setPhase(2), 2100);
    const t2 = setTimeout(() => setPhase(3), 3100);
    const t3 = setTimeout(() => setVisible(false), 3700);
    const t4 = setTimeout(() => { markIntroSeen(); onComplete(); }, 4300);

    return () => { [t0, t1, t2, t3, t4].forEach(clearTimeout); };
  }, [onComplete, reduced]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeInOut" }}
        >
          {/* Background gradient */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            animate={{
              background: phase >= 2
                ? "radial-gradient(ellipse 70% 60% at 50% 40%, rgba(79,70,229,0.18) 0%, transparent 70%)"
                : "radial-gradient(ellipse 40% 30% at 50% 40%, rgba(79,70,229,0.06) 0%, transparent 60%)",
            }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
          />

          {/* Particles */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 0 ? 1 : 0 }}
            transition={{ duration: 0.6 }}
          >
            <Particles />
          </motion.div>

          {/* Central "7" */}
          <motion.div
            className="relative z-10 flex flex-col items-center"
            animate={{
              scale: phase >= 3 ? 0.55 : 1,
              opacity: phase >= 3 ? 0 : 1,
              y: phase >= 3 ? -30 : 0,
            }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          >
            <AnimatedSeven phase={phase} />
            <Wordmark phase={phase} />
          </motion.div>

          {/* Bottom progress line */}
          <motion.div
            className="absolute bottom-8 left-1/2 -translate-x-1/2 h-px w-24 overflow-hidden rounded-full bg-white/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: phase >= 1 ? 1 : 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
          >
            <motion.div
              className="h-full rounded-full bg-indigo-400"
              initial={{ x: "-100%" }}
              animate={{ x: phase >= 2 ? "100%" : "-100%" }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
