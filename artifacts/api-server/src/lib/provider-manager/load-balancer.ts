/**
 * Load Balancer — selects the best API key for a given provider
 *
 * Supported strategies:
 *   round-robin         — cycle through active keys in order
 *   least-recently-used — pick the key not used for the longest time
 *   lowest-latency      — pick the key with the lowest avg response time
 *   random              — uniform random selection
 *   priority            — pick the first enabled key (declaration order = priority)
 *   least-failures      — pick the key with the fewest consecutive failures
 */

import type { RuntimeKeyState, RoutingStrategy } from "./types.js";

// Returns only eligible keys (enabled, active, not in cooldown)
function eligibleKeys(keys: RuntimeKeyState[]): RuntimeKeyState[] {
  const now = Date.now();
  return keys.filter(k => {
    if (!k.enabled) return false;
    if (k.status === "disabled" || k.status === "exhausted") return false;
    if (k.cooldownUntil && k.cooldownUntil.getTime() > now) return false;
    return true;
  });
}

export function selectKey(
  keys: RuntimeKeyState[],
  strategy: RoutingStrategy,
  rrIndex: number,
): RuntimeKeyState | null {
  const pool = eligibleKeys(keys);
  if (pool.length === 0) return null;

  switch (strategy) {
    case "round-robin": {
      return pool[rrIndex % pool.length] ?? pool[0] ?? null;
    }

    case "least-recently-used": {
      return pool.reduce((best, k) => {
        const bestTime = best.lastUsedAt?.getTime() ?? 0;
        const kTime    = k.lastUsedAt?.getTime()    ?? 0;
        return kTime < bestTime ? k : best;
      });
    }

    case "lowest-latency": {
      return pool.reduce((best, k) => {
        // Keys never used (avgResponseTimeMs === 0) are preferred
        const bestMs = best.avgResponseTimeMs === 0 ? Infinity : best.avgResponseTimeMs;
        const kMs    = k.avgResponseTimeMs    === 0 ? Infinity : k.avgResponseTimeMs;
        // Flip: lower latency wins, but 0 (never used) is treated as preferred
        if (best.avgResponseTimeMs === 0 && k.avgResponseTimeMs === 0) return best;
        if (best.avgResponseTimeMs === 0) return best;
        if (k.avgResponseTimeMs === 0) return k;
        return kMs < bestMs ? k : best;
      });
    }

    case "random": {
      return pool[Math.floor(Math.random() * pool.length)] ?? null;
    }

    case "priority": {
      // First enabled key wins (order = priority)
      return pool[0] ?? null;
    }

    case "least-failures": {
      return pool.reduce((best, k) =>
        k.consecutiveFailures < best.consecutiveFailures ? k : best,
      );
    }

    default:
      return pool[0] ?? null;
  }
}

// Advance round-robin cursor
export function advanceRR(current: number, poolSize: number): number {
  if (poolSize === 0) return 0;
  return (current + 1) % poolSize;
}
