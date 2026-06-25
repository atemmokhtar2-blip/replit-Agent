/**
 * Health Monitor
 *
 * In-memory singleton that tracks per-model health metrics.
 * Every model call updates these metrics via the fallback engine.
 *
 * Metrics tracked:
 *   - Total requests, successes, failures
 *   - Response times (min, max, avg)
 *   - Active (in-flight) request count
 *   - Last success/failure timestamps
 *   - Error type breakdown
 *
 * The health monitor also updates the model registry's status field
 * so the router can avoid routing to degraded/offline models.
 */

import type { ModelHealthMetrics, HealthReport, ModelStatus } from "./types.js";
import { modelRegistry } from "./model-registry.js";

const DEGRADED_THRESHOLD = 0.7; // success rate below 70% = degraded
const OFFLINE_THRESHOLD = 0.3;  // success rate below 30% = offline
const MIN_SAMPLES = 3;          // need at least 3 requests before changing status

class HealthMonitor {
  private metrics = new Map<string, ModelHealthMetrics>();

  private getOrCreate(registryEntryId: string, providerSlug: string): ModelHealthMetrics {
    const key = registryEntryId;
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        registryEntryId,
        providerSlug,
        totalRequests: 0,
        successCount: 0,
        failureCount: 0,
        activeRequests: 0,
        totalLatencyMs: 0,
        minLatencyMs: Infinity,
        maxLatencyMs: 0,
      });
    }
    return this.metrics.get(key)!;
  }

  /** Called when a request to a model starts */
  recordRequest(registryEntryId: string, providerSlug: string): void {
    const m = this.getOrCreate(registryEntryId, providerSlug);
    m.activeRequests++;
    m.totalRequests++;
  }

  /** Called when a request completes successfully */
  recordSuccess(registryEntryId: string, providerSlug: string, latencyMs: number): void {
    const m = this.getOrCreate(registryEntryId, providerSlug);
    m.activeRequests = Math.max(0, m.activeRequests - 1);
    m.successCount++;
    m.totalLatencyMs += latencyMs;
    m.minLatencyMs = Math.min(m.minLatencyMs, latencyMs);
    m.maxLatencyMs = Math.max(m.maxLatencyMs, latencyMs);
    m.lastSuccessAt = new Date();
    this.updateModelStatus(registryEntryId, m);
  }

  /** Called when a request fails */
  recordFailure(registryEntryId: string, providerSlug: string, errorType: string): void {
    const m = this.getOrCreate(registryEntryId, providerSlug);
    m.activeRequests = Math.max(0, m.activeRequests - 1);
    m.failureCount++;
    m.lastFailureAt = new Date();
    m.lastError = errorType;
    this.updateModelStatus(registryEntryId, m);
  }

  /** Get a health report for a specific model */
  getReport(registryEntryId: string, providerSlug: string): HealthReport {
    const m = this.getOrCreate(registryEntryId, providerSlug);
    return this.buildReport(m);
  }

  /** Get health reports for all tracked models */
  getAllReports(): HealthReport[] {
    return Array.from(this.metrics.values()).map((m) => this.buildReport(m));
  }

  /** Get health reports for all models in the registry (including un-called ones) */
  getRegistryReports(): HealthReport[] {
    const reports: HealthReport[] = [];
    for (const entry of modelRegistry.listAll()) {
      reports.push(this.getReport(entry.id, entry.providerSlug));
    }
    return reports;
  }

  /** Reset metrics for a specific model (e.g. after re-enabling) */
  reset(registryEntryId: string): void {
    this.metrics.delete(registryEntryId);
    modelRegistry.updateStatus(registryEntryId, "unknown");
  }

  private buildReport(m: ModelHealthMetrics): HealthReport {
    const total = m.successCount + m.failureCount;
    const successRate = total > 0 ? (m.successCount / total) * 100 : 100;
    const errorRate = total > 0 ? (m.failureCount / total) * 100 : 0;
    const avgResponseMs = m.successCount > 0 ? Math.round(m.totalLatencyMs / m.successCount) : 0;

    let status: ModelStatus = "unknown";
    if (m.totalRequests >= MIN_SAMPLES) {
      const rate = m.successCount / (m.successCount + m.failureCount);
      if (rate < OFFLINE_THRESHOLD) status = "offline";
      else if (rate < DEGRADED_THRESHOLD) status = "degraded";
      else status = "available";
    } else if (m.totalRequests > 0) {
      status = m.failureCount === m.totalRequests ? "offline" : "available";
    }

    return {
      registryEntryId: m.registryEntryId,
      providerSlug: m.providerSlug,
      status,
      uptimePct: successRate,
      successRate,
      errorRate,
      avgResponseMs,
      minResponseMs: m.minLatencyMs === Infinity ? 0 : m.minLatencyMs,
      maxResponseMs: m.maxLatencyMs,
      totalRequests: m.totalRequests,
      activeRequests: m.activeRequests,
      lastSuccessAt: m.lastSuccessAt,
      lastFailureAt: m.lastFailureAt,
      lastError: m.lastError,
    };
  }

  private updateModelStatus(registryEntryId: string, m: ModelHealthMetrics): void {
    const total = m.successCount + m.failureCount;
    if (total < MIN_SAMPLES) return;

    const rate = m.successCount / total;
    let status: ModelStatus;
    if (rate < OFFLINE_THRESHOLD) status = "offline";
    else if (rate < DEGRADED_THRESHOLD) status = "degraded";
    else status = "available";

    modelRegistry.updateStatus(registryEntryId, status);
  }
}

export const healthMonitor = new HealthMonitor();
