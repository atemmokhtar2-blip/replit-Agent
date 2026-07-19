/**
 * Health Monitor — background worker that continuously monitors provider/key health
 *
 * Runs every HEALTH_INTERVAL_MS. For each provider:
 *   1. If any key has consecutiveFailures >= DISABLE_THRESHOLD → set to cooling
 *   2. If a cooling key's cooldown has expired → re-enable it
 *   3. Recalculate provider healthScore from key stats
 *   4. Update provider status (healthy / degraded / unhealthy / disabled)
 *   5. Persist updated stats to DB
 */

import type { RuntimeProviderState, RuntimeKeyState, ProviderStatus } from "./types.js";
import { db } from "@workspace/db";
import { aiProviderRegistryTable, aiProviderKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const HEALTH_INTERVAL_MS   = 30_000;  // check every 30 s
export const DISABLE_THRESHOLD    = 5;        // consecutive failures before cooling
export const COOLDOWN_MS          = 60_000;   // 60 s cooldown before re-enabling
export const DEGRADED_THRESHOLD   = 70;       // health score below this = degraded
export const UNHEALTHY_THRESHOLD  = 30;       // health score below this = unhealthy

// ── Health score calculation ──────────────────────────────────────────────────

function computeHealthScore(p: RuntimeProviderState): number {
  const total = p.totalRequests;
  if (total === 0) return 100;

  const successRate   = p.successCount / total;
  const hasActiveKeys = p.keys.some(k => k.enabled && k.status === "active");

  let score = Math.round(successRate * 80);  // up to 80 points for success rate

  // Up to 20 points for having active keys with low latency
  if (hasActiveKeys) {
    const activeKeys = p.keys.filter(k => k.enabled && k.status === "active");
    const avgLatency = activeKeys.reduce((s, k) => s + k.avgResponseTimeMs, 0) / activeKeys.length;
    const latencyScore = avgLatency === 0 ? 20 : Math.max(0, 20 - Math.floor(avgLatency / 1000));
    score += latencyScore;
  }

  return Math.min(100, Math.max(0, score));
}

function providerStatus(score: number, enabled: boolean): ProviderStatus {
  if (!enabled) return "disabled";
  if (score >= DEGRADED_THRESHOLD)  return "healthy";
  if (score >= UNHEALTHY_THRESHOLD) return "degraded";
  return "unhealthy";
}

// ── Key health tick ───────────────────────────────────────────────────────────

function tickKey(key: RuntimeKeyState): { changed: boolean } {
  const now = Date.now();
  let changed = false;

  // Cooling: cooldown expired → re-enable
  if (key.status === "cooling" && key.cooldownUntil && key.cooldownUntil.getTime() <= now) {
    key.status             = "active";
    key.cooldownUntil      = undefined;
    key.consecutiveFailures = 0;
    changed = true;
    console.log(`[HealthMonitor] Key ${key.id} (${key.name}) cooling period ended — re-enabling`);
  }

  // Too many failures → move to cooling
  if (key.enabled && key.status === "active" && key.consecutiveFailures >= DISABLE_THRESHOLD) {
    key.status        = "cooling";
    key.cooldownUntil = new Date(now + COOLDOWN_MS);
    changed = true;
    console.log(`[HealthMonitor] Key ${key.id} (${key.name}) → cooling after ${key.consecutiveFailures} failures`);
  }

  return { changed };
}

// ── Provider health tick ──────────────────────────────────────────────────────

function tickProvider(p: RuntimeProviderState): { changed: boolean } {
  let changed = false;

  for (const key of p.keys) {
    const r = tickKey(key);
    if (r.changed) changed = true;
  }

  const newScore  = computeHealthScore(p);
  const newStatus = providerStatus(newScore, p.enabled);

  if (newScore !== p.healthScore || newStatus !== p.status) {
    p.healthScore = newScore;
    p.status      = newStatus;
    changed       = true;
  }

  return { changed };
}

// ── Persist to DB (non-fatal) ─────────────────────────────────────────────────

async function persistProvider(p: RuntimeProviderState): Promise<void> {
  await db.update(aiProviderRegistryTable)
    .set({
      healthScore:     p.healthScore,
      status:          p.status,
      totalRequests:   p.totalRequests,
      successCount:    p.successCount,
      failureCount:    p.failureCount,
      avgLatencyMs:    p.avgLatencyMs,
      lastHealthCheck: new Date(),
      updatedAt:       new Date(),
    })
    .where(eq(aiProviderRegistryTable.slug, p.slug))
    .catch(err => console.warn("[HealthMonitor] DB persist provider failed:", (err as Error).message));
}

async function persistKey(key: RuntimeKeyState): Promise<void> {
  await db.update(aiProviderKeysTable)
    .set({
      status:              key.status,
      enabled:             key.enabled,
      consecutiveFailures: key.consecutiveFailures,
      cooldownUntil:       key.cooldownUntil ?? null,
      avgResponseTimeMs:   key.avgResponseTimeMs,
      totalRequests:       key.totalRequests,
      successCount:        key.successCount,
      failureCount:        key.failureCount,
      lastUsedAt:          key.lastUsedAt ?? null,
      lastSuccessAt:       key.lastSuccessAt ?? null,
      lastFailureAt:       key.lastFailureAt ?? null,
      lastError:           key.lastError ?? null,
      updatedAt:           new Date(),
    })
    .where(eq(aiProviderKeysTable.id, key.id))
    .catch(err => console.warn("[HealthMonitor] DB persist key failed:", (err as Error).message));
}

// ── HealthMonitor class ────────────────────────────────────────────────────────

export class HealthMonitor {
  private timer:      NodeJS.Timeout | null = null;
  private activeTimer: NodeJS.Timeout | null = null;
  private providers:  Map<string, RuntimeProviderState>;
  private testKeyFn:  ((keyId: string) => Promise<{ ok: boolean; latencyMs: number; error?: string }>) | null = null;

  constructor(providers: Map<string, RuntimeProviderState>) {
    this.providers = providers;
  }

  /** Register a test-key callback so the monitor can actively probe error keys. */
  registerTestFn(fn: (keyId: string) => Promise<{ ok: boolean; latencyMs: number; error?: string }>): void {
    this.testKeyFn = fn;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, HEALTH_INTERVAL_MS);

    // Active re-test of error-state keys every 5 minutes
    this.activeTimer = setInterval(() => { void this.activeRetest(); }, 5 * 60 * 1000);

    console.log("[HealthMonitor] Started (interval:", HEALTH_INTERVAL_MS, "ms)");
  }

  stop(): void {
    if (this.timer)       { clearInterval(this.timer);       this.timer       = null; }
    if (this.activeTimer) { clearInterval(this.activeTimer); this.activeTimer = null; }
  }

  async tick(): Promise<void> {
    for (const p of this.providers.values()) {
      const { changed } = tickProvider(p);
      if (changed) {
        await persistProvider(p);
        for (const key of p.keys) {
          await persistKey(key);
        }
      }
    }
  }

  /**
   * Actively re-test keys in error state (not cooling — those have their own timer).
   * If a key passes, it's re-enabled as active.
   */
  async activeRetest(): Promise<void> {
    if (!this.testKeyFn) return;
    const fn = this.testKeyFn;

    for (const p of this.providers.values()) {
      for (const key of p.keys) {
        // Probe keys that are in a hard-error state (disabled after too many failures)
        // but skip cooling keys — they have their own cooldown timer in tick()
        if (key.status !== "error" && !(key.status === "active" && !key.enabled && key.consecutiveFailures >= DISABLE_THRESHOLD)) {
          continue;
        }

        try {
          const result = await fn(key.id);
          if (result.ok) {
            key.status              = "active";
            key.enabled             = true;
            key.consecutiveFailures = 0;
            key.lastSuccessAt       = new Date();
            await persistKey(key);
            console.log(`[HealthMonitor] Active retest: key ${key.id} (${key.name}) recovered — re-enabled`);
          } else {
            console.debug(`[HealthMonitor] Active retest: key ${key.id} still failing: ${result.error}`);
          }
        } catch {
          // silently skip — we'll retry next cycle
        }
      }
    }
  }

  /** Force an immediate health check (called from admin API). */
  async runNow(): Promise<void> {
    await this.tick();
  }
}
