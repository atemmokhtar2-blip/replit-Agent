/**
 * ProviderManager — central orchestration singleton
 *
 * All AI calls in the platform route through this service.
 * It handles:
 *   • Provider + key registration (seeded from DB + env vars)
 *   • Intelligent key selection via LoadBalancer
 *   • Full error classification + retry + failover
 *   • Rolling average latency tracking
 *   • Request logging to DB
 *   • Health monitor lifecycle
 *   • Admin CRUD operations
 */

import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  aiProviderRegistryTable,
  aiProviderKeysTable,
  aiRequestLogTable,
  type InsertAiProviderRegistry,
  type InsertAiProviderKey,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

import type {
  LLMMessage, LLMOptions, LLMResponse,
  RuntimeProviderState, RuntimeKeyState,
  RoutingStrategy, TaskType, ProviderError,
  SystemHealthReport, ProviderHealthReport, KeyHealthReport,
} from "./types.js";
import { encryptKey, decryptKey, keyPrefix } from "./key-vault.js";
import { selectKey, advanceRR } from "./load-balancer.js";
import { HealthMonitor } from "./health-monitor.js";

import { openRouterAdapter } from "./adapters/openrouter.js";
import { geminiAdapter      } from "./adapters/gemini.js";
import { groqAdapter        } from "./adapters/groq.js";
import { cloudflareAdapter  } from "./adapters/cloudflare.js";
import { mistralAdapter     } from "./adapters/mistral.js";

const ALL_ADAPTERS = [openRouterAdapter, geminiAdapter, groqAdapter, cloudflareAdapter, mistralAdapter];

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RETRIES = 4;
const ALPHA       = 0.2; // EMA smoothing factor for latency

function genId(): string { return crypto.randomUUID(); }

function ema(current: number, next: number): number {
  if (current === 0) return next;
  return current * (1 - ALPHA) + next * ALPHA;
}

// ── Default provider definitions (seeded on first run) ────────────────────────

const DEFAULT_PROVIDER_SEEDS: InsertAiProviderRegistry[] = [
  {
    slug: "openrouter", displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/docs",
    enabled: true, priority: 1,
    routingStrategy: "round-robin",
    healthScore: 100, status: "healthy",
    totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0,
    capabilities: { streaming: true, functionCalling: false, vision: true },
    defaultModels: {
      planning: "moonshotai/kimi-k2", "code-gen": "moonshotai/kimi-k2",
      debugging: "deepseek/deepseek-chat-v3-0324",
      documentation: "deepseek/deepseek-chat-v3-0324",
      review: "qwen/qwen-2.5-coder-32b-instruct",
      verification: "qwen/qwen-2.5-coder-32b-instruct",
      general: "moonshotai/kimi-k2",
    },
  },
  {
    slug: "gemini", displayName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    docsUrl: "https://ai.google.dev/docs",
    enabled: false, priority: 2,
    routingStrategy: "round-robin",
    healthScore: 100, status: "healthy",
    totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0,
    capabilities: { streaming: true, functionCalling: true, vision: true },
    defaultModels: {
      planning: "gemini-2.5-flash", "code-gen": "gemini-2.5-flash",
      debugging: "gemini-2.5-flash", documentation: "gemini-1.5-flash",
      review: "gemini-1.5-flash", verification: "gemini-1.5-flash",
      general: "gemini-2.5-flash",
    },
  },
  {
    slug: "groq", displayName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/docs",
    enabled: false, priority: 3,
    routingStrategy: "round-robin",
    healthScore: 100, status: "healthy",
    totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0,
    capabilities: { streaming: true, functionCalling: false, vision: false },
    defaultModels: {
      planning: "llama-3.3-70b-versatile", "code-gen": "llama-3.3-70b-versatile",
      debugging: "llama-3.3-70b-versatile", documentation: "llama-3.1-8b-instant",
      review: "llama-3.3-70b-versatile", verification: "llama-3.1-8b-instant",
      general: "llama-3.3-70b-versatile",
    },
  },
  {
    slug: "cloudflare", displayName: "Cloudflare AI",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts",
    docsUrl: "https://developers.cloudflare.com/workers-ai",
    enabled: false, priority: 4,
    routingStrategy: "round-robin",
    healthScore: 100, status: "healthy",
    totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0,
    capabilities: { streaming: false, functionCalling: false, vision: false },
    defaultModels: {
      planning: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "code-gen": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      debugging: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      documentation: "@cf/meta/llama-3.1-8b-instruct",
      review: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      verification: "@cf/meta/llama-3.1-8b-instruct",
      general: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    },
  },
  {
    slug: "mistral", displayName: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://docs.mistral.ai",
    enabled: false, priority: 5,
    routingStrategy: "round-robin",
    healthScore: 100, status: "healthy",
    totalRequests: 0, successCount: 0, failureCount: 0, avgLatencyMs: 0,
    capabilities: { streaming: true, functionCalling: true, vision: false },
    defaultModels: {
      planning: "mistral-large-latest", "code-gen": "codestral-latest",
      debugging: "codestral-latest", documentation: "mistral-small-latest",
      review: "mistral-large-latest", verification: "mistral-small-latest",
      general: "mistral-large-latest",
    },
  },
];

// ── ProviderManager ────────────────────────────────────────────────────────────

export class ProviderManager {
  private providers = new Map<string, RuntimeProviderState>();
  private monitor: HealthMonitor;
  private initialized = false;

  constructor() {
    this.monitor = new HealthMonitor(this.providers);
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await this.seedProvidersIfEmpty();
      await this.loadFromDB();
      this.seedEnvKeys();
      this.monitor.start();
      const total = [...this.providers.values()].reduce((s, p) => s + p.keys.length, 0);
      console.log(`[ProviderManager] Ready — ${this.providers.size} providers, ${total} keys`);
    } catch (err) {
      console.error("[ProviderManager] Initialization failed:", (err as Error).message);
      // Fall back to env-only mode
      this.bootstrapFromEnv();
    }
  }

  // ── Core completion (all platform code calls this) ──────────────────────────

  async complete(messages: LLMMessage[], options: LLMOptions = {}): Promise<LLMResponse> {
    if (!this.initialized) await this.initialize();

    const taskType  = options.taskType ?? "general";
    const providers = this.orderedProviders();

    let totalRetries = 0;
    const triedKeys  = new Set<string>();

    for (const provider of providers) {
      const adapter = ALL_ADAPTERS.find(a => a.slug === provider.slug);
      if (!adapter) continue;

      let attempts = 0;
      while (attempts < MAX_RETRIES) {
        const key = selectKey(provider.keys, provider.routingStrategy as RoutingStrategy, provider.rrIndex);
        if (!key || triedKeys.has(key.id)) break;

        triedKeys.add(key.id);
        provider.rrIndex = advanceRR(provider.rrIndex, provider.keys.filter(k => k.enabled).length);

        const t0 = Date.now();
        key.lastUsedAt     = new Date();
        key.totalRequests++;
        provider.totalRequests++;

        let plainKey: string;
        try { plainKey = decryptKey(key.keyEncrypted); }
        catch { attempts++; continue; }

        const model = options.model ?? adapter.defaultModels[taskType];

        try {
          const result = await adapter.complete(messages, { ...options, model }, plainKey);
          const latencyMs = Date.now() - t0;

          // Update key stats
          key.successCount++;
          key.consecutiveFailures = 0;
          key.lastSuccessAt       = new Date();
          key.avgResponseTimeMs   = ema(key.avgResponseTimeMs, latencyMs);
          if (key.status === "cooling") key.status = "active";

          // Update provider stats
          provider.successCount++;
          provider.avgLatencyMs = ema(provider.avgLatencyMs, latencyMs);

          // Log to DB (non-blocking)
          void this.logRequest({
            providerSlug: provider.slug, keyId: key.id, model,
            taskType, latencyMs, status: "success",
            promptTokens: result.promptTokens, outputTokens: result.completionTokens,
            retries: totalRetries,
          });

          void this.flushStats(provider, key);

          return {
            content:          result.content,
            model,
            providerSlug:     provider.slug,
            keyId:            key.id,
            promptTokens:     result.promptTokens,
            completionTokens: result.completionTokens,
            latencyMs,
            retries:          totalRetries,
          };

        } catch (rawErr) {
          const pe: ProviderError = (rawErr as { providerError?: ProviderError }).providerError
            ?? adapter.classifyError(rawErr);
          const latencyMs = Date.now() - t0;

          // Update key failure stats
          key.failureCount++;
          key.consecutiveFailures++;
          key.lastFailureAt = new Date();
          key.lastError     = pe.message.slice(0, 200);
          key.avgResponseTimeMs = ema(key.avgResponseTimeMs, latencyMs);

          // Update provider stats
          provider.failureCount++;

          console.warn(
            `[ProviderManager] ${provider.slug}/${key.name} [${pe.kind}]: ${pe.message.slice(0, 80)} ` +
            `(attempt ${attempts + 1}/${MAX_RETRIES})`,
          );

          // Log failure (non-blocking)
          void this.logRequest({
            providerSlug: provider.slug, keyId: key.id, model,
            taskType, latencyMs, status: "failed",
            retries: totalRetries, errorCode: pe.statusCode,
            errorMessage: pe.message.slice(0, 200),
          });

          // Fatal: bad key → skip this key entirely, try next
          if (!pe.retryable || pe.kind === "auth_failed") {
            key.status  = "error";
            key.enabled = false;
            void this.flushStats(provider, key);
            break;
          }

          // Credit exhaustion → try next provider
          if (pe.kind === "insufficient_credits" && pe.suggestNextProvider) {
            key.status = "exhausted";
            void this.flushStats(provider, key);
            break;
          }

          // Rate limited → wait, then retry same key
          if (pe.kind === "rate_limited") {
            await new Promise(r => setTimeout(r, pe.waitMs));
            totalRetries++;
            attempts++;
            continue;
          }

          // Timeout / network → switch to next key within provider
          totalRetries++;
          attempts++;
          void this.flushStats(provider, key);
        }
      }
    }

    throw new Error(
      `[ProviderManager] All providers exhausted after ${totalRetries} retries. ` +
      `Tried: ${[...new Set([...this.providers.keys()])].join(", ")}`,
    );
  }

  // ── Provider ordering (by priority, enabled first) ─────────────────────────

  private orderedProviders(): RuntimeProviderState[] {
    return [...this.providers.values()]
      .filter(p => p.enabled && p.status !== "disabled")
      .sort((a, b) => a.priority - b.priority);
  }

  // ── Admin: enable / disable provider ────────────────────────────────────────

  async enableProvider(slug: string): Promise<void> {
    const p = this.providers.get(slug);
    if (!p) throw new Error(`Provider not found: ${slug}`);
    p.enabled = true;
    p.status  = "healthy";
    await db.update(aiProviderRegistryTable)
      .set({ enabled: true, status: "healthy", updatedAt: new Date() })
      .where(eq(aiProviderRegistryTable.slug, slug));
  }

  async disableProvider(slug: string): Promise<void> {
    const p = this.providers.get(slug);
    if (!p) throw new Error(`Provider not found: ${slug}`);
    p.enabled = false;
    p.status  = "disabled";
    await db.update(aiProviderRegistryTable)
      .set({ enabled: false, status: "disabled", updatedAt: new Date() })
      .where(eq(aiProviderRegistryTable.slug, slug));
  }

  async updateRoutingStrategy(slug: string, strategy: RoutingStrategy): Promise<void> {
    const p = this.providers.get(slug);
    if (!p) throw new Error(`Provider not found: ${slug}`);
    p.routingStrategy = strategy;
    await db.update(aiProviderRegistryTable)
      .set({ routingStrategy: strategy, updatedAt: new Date() })
      .where(eq(aiProviderRegistryTable.slug, slug));
  }

  // ── Admin: API key management ───────────────────────────────────────────────

  async addKey(providerSlug: string, name: string, plainKey: string): Promise<string> {
    const p = this.providers.get(providerSlug);
    if (!p) throw new Error(`Provider not found: ${providerSlug}`);

    const id           = genId();
    const keyEncrypted = encryptKey(plainKey);
    const prefix       = keyPrefix(plainKey);

    const row: InsertAiProviderKey = {
      id, providerSlug, name,
      keyEncrypted, keyPrefix: prefix,
      enabled: true, status: "active",
      totalRequests: 0, successCount: 0, failureCount: 0,
      consecutiveFailures: 0, avgResponseTimeMs: 0,
    };

    await db.insert(aiProviderKeysTable).values(row);

    const runtime: RuntimeKeyState = {
      id, providerSlug, name,
      keyEncrypted,
      keyPrefix: prefix,
      enabled: true, status: "active",
      totalRequests: 0, successCount: 0, failureCount: 0,
      consecutiveFailures: 0, avgResponseTimeMs: 0,
    };

    p.keys.push(runtime);

    // Auto-enable provider if it was disabled due to no keys
    if (!p.enabled && p.keys.length === 1) {
      await this.enableProvider(providerSlug);
    }

    console.log(`[ProviderManager] Key added: ${name} → ${providerSlug}`);
    return id;
  }

  async disableKey(keyId: string): Promise<void> {
    for (const p of this.providers.values()) {
      const key = p.keys.find(k => k.id === keyId);
      if (key) {
        key.enabled = false;
        key.status  = "disabled";
        await db.update(aiProviderKeysTable)
          .set({ enabled: false, status: "disabled", updatedAt: new Date() })
          .where(eq(aiProviderKeysTable.id, keyId));
        return;
      }
    }
    throw new Error(`Key not found: ${keyId}`);
  }

  async enableKey(keyId: string): Promise<void> {
    for (const p of this.providers.values()) {
      const key = p.keys.find(k => k.id === keyId);
      if (key) {
        key.enabled             = true;
        key.status              = "active";
        key.consecutiveFailures = 0;
        key.cooldownUntil       = undefined;
        await db.update(aiProviderKeysTable)
          .set({ enabled: true, status: "active", consecutiveFailures: 0, cooldownUntil: null, updatedAt: new Date() })
          .where(eq(aiProviderKeysTable.id, keyId));
        return;
      }
    }
    throw new Error(`Key not found: ${keyId}`);
  }

  async deleteKey(keyId: string): Promise<void> {
    for (const p of this.providers.values()) {
      const idx = p.keys.findIndex(k => k.id === keyId);
      if (idx !== -1) {
        p.keys.splice(idx, 1);
        await db.delete(aiProviderKeysTable).where(eq(aiProviderKeysTable.id, keyId));
        return;
      }
    }
    throw new Error(`Key not found: ${keyId}`);
  }

  async rotateKey(keyId: string, newPlainKey: string): Promise<void> {
    for (const p of this.providers.values()) {
      const key = p.keys.find(k => k.id === keyId);
      if (key) {
        const encrypted = encryptKey(newPlainKey);
        const prefix    = keyPrefix(newPlainKey);
        key.keyEncrypted        = encrypted;
        key.keyPrefix           = prefix;
        key.status              = "active";
        key.consecutiveFailures = 0;
        key.cooldownUntil       = undefined;
        await db.update(aiProviderKeysTable)
          .set({ keyEncrypted: encrypted, keyPrefix: prefix, status: "active", consecutiveFailures: 0, cooldownUntil: null, updatedAt: new Date() })
          .where(eq(aiProviderKeysTable.id, keyId));
        return;
      }
    }
    throw new Error(`Key not found: ${keyId}`);
  }

  // ── Admin: test connection ──────────────────────────────────────────────────

  async testProvider(slug: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const p = this.providers.get(slug);
    if (!p) return { ok: false, latencyMs: 0, error: "Provider not found" };
    const adapter = ALL_ADAPTERS.find(a => a.slug === slug);
    if (!adapter) return { ok: false, latencyMs: 0, error: "No adapter" };
    const firstKey = p.keys.find(k => k.enabled);
    if (!firstKey) return { ok: false, latencyMs: 0, error: "No active keys" };
    try {
      const plain = decryptKey(firstKey.keyEncrypted);
      return await adapter.testConnection(plain);
    } catch (err) {
      return { ok: false, latencyMs: 0, error: (err as Error).message };
    }
  }

  async testKey(keyId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    for (const p of this.providers.values()) {
      const key = p.keys.find(k => k.id === keyId);
      if (key) {
        const adapter = ALL_ADAPTERS.find(a => a.slug === p.slug);
        if (!adapter) return { ok: false, latencyMs: 0, error: "No adapter" };
        try {
          const plain = decryptKey(key.keyEncrypted);
          const result = await adapter.testConnection(plain);
          // Update key stats based on test result
          if (result.ok) {
            key.lastSuccessAt = new Date();
          } else {
            key.lastFailureAt = new Date();
            key.lastError     = result.error;
          }
          void this.flushKeyOnly(key);
          return result;
        } catch (err) {
          return { ok: false, latencyMs: 0, error: (err as Error).message };
        }
      }
    }
    return { ok: false, latencyMs: 0, error: "Key not found" };
  }

  // ── Health report ───────────────────────────────────────────────────────────

  getHealthReport(): SystemHealthReport {
    const providerList = [...this.providers.values()];
    const allKeys      = providerList.flatMap(p => p.keys);
    const totalReqs    = providerList.reduce((s, p) => s + p.totalRequests, 0);
    const totalSuccess = providerList.reduce((s, p) => s + p.successCount, 0);

    const providers: ProviderHealthReport[] = providerList
      .sort((a, b) => a.priority - b.priority)
      .map(p => {
        const pTotal = p.totalRequests;
        const keys: KeyHealthReport[] = p.keys.map(k => ({
          id:                  k.id,
          name:                k.name,
          prefix:              k.keyPrefix,
          status:              k.status,
          enabled:             k.enabled,
          totalRequests:       k.totalRequests,
          successRate:         k.totalRequests > 0 ? k.successCount / k.totalRequests : 1,
          avgResponseTimeMs:   k.avgResponseTimeMs,
          consecutiveFailures: k.consecutiveFailures,
          lastUsed:            k.lastUsedAt?.toISOString(),
          lastSuccess:         k.lastSuccessAt?.toISOString(),
          lastFailure:         k.lastFailureAt?.toISOString(),
          lastError:           k.lastError,
          cooldownUntil:       k.cooldownUntil?.toISOString(),
        }));

        return {
          slug:            p.slug,
          displayName:     p.displayName,
          status:          p.status,
          healthScore:     p.healthScore,
          enabled:         p.enabled,
          priority:        p.priority,
          totalRequests:   pTotal,
          successCount:    p.successCount,
          failureCount:    p.failureCount,
          successRate:     pTotal > 0 ? p.successCount / pTotal : 1,
          avgLatencyMs:    p.avgLatencyMs,
          lastHealthCheck: p.lastHealthCheck?.toISOString(),
          activeKeys:      p.keys.filter(k => k.enabled && k.status === "active").length,
          totalKeys:       p.keys.length,
          keys,
        };
      });

    return {
      generatedAt:     new Date().toISOString(),
      activeProviders: providerList.filter(p => p.enabled).length,
      totalProviders:  providerList.length,
      totalKeys:       allKeys.length,
      activeKeys:      allKeys.filter(k => k.enabled && k.status === "active").length,
      totalRequests:   totalReqs,
      overallSuccess:  totalReqs > 0 ? totalSuccess / totalReqs : 1,
      avgLatencyMs:    providerList.filter(p => p.avgLatencyMs > 0).reduce((s, p, _, a) => s + p.avgLatencyMs / a.length, 0),
      currentStrategy: (providerList[0]?.routingStrategy as RoutingStrategy) ?? "round-robin",
      providers,
    };
  }

  // Get recent request log from DB
  async getRecentRequests(limit = 50) {
    return db.select()
      .from(aiRequestLogTable)
      .orderBy(desc(aiRequestLogTable.createdAt))
      .limit(limit);
  }

  // Run health monitor tick now
  async runHealthCheck(): Promise<void> {
    await this.monitor.runNow();
  }

  // ── Private: DB initialization ──────────────────────────────────────────────

  private async seedProvidersIfEmpty(): Promise<void> {
    const existing = await db.select({ slug: aiProviderRegistryTable.slug }).from(aiProviderRegistryTable).limit(1);
    if (existing.length > 0) return;

    console.log("[ProviderManager] Seeding provider registry…");
    for (const seed of DEFAULT_PROVIDER_SEEDS) {
      await db.insert(aiProviderRegistryTable).values(seed).onConflictDoNothing();
    }
  }

  private async loadFromDB(): Promise<void> {
    const rows    = await db.select().from(aiProviderRegistryTable).orderBy(aiProviderRegistryTable.priority);
    const keyRows = await db.select().from(aiProviderKeysTable);

    for (const row of rows) {
      const providerKeys: RuntimeKeyState[] = keyRows
        .filter(k => k.providerSlug === row.slug)
        .map(k => ({
          id:                  k.id,
          providerSlug:        k.providerSlug,
          name:                k.name,
          keyEncrypted:        k.keyEncrypted,
          keyPrefix:           k.keyPrefix,
          enabled:             k.enabled,
          status:              k.status as RuntimeKeyState["status"],
          totalRequests:       k.totalRequests ?? 0,
          successCount:        k.successCount ?? 0,
          failureCount:        k.failureCount ?? 0,
          consecutiveFailures: k.consecutiveFailures ?? 0,
          avgResponseTimeMs:   k.avgResponseTimeMs ?? 0,
          lastUsedAt:          k.lastUsedAt ?? undefined,
          lastSuccessAt:       k.lastSuccessAt ?? undefined,
          lastFailureAt:       k.lastFailureAt ?? undefined,
          lastError:           k.lastError ?? undefined,
          cooldownUntil:       k.cooldownUntil ?? undefined,
        }));

      this.providers.set(row.slug, {
        slug:            row.slug,
        displayName:     row.displayName,
        enabled:         row.enabled,
        priority:        row.priority,
        routingStrategy: row.routingStrategy as RoutingStrategy,
        healthScore:     row.healthScore,
        status:          row.status as RuntimeProviderState["status"],
        totalRequests:   row.totalRequests ?? 0,
        successCount:    row.successCount  ?? 0,
        failureCount:    row.failureCount  ?? 0,
        avgLatencyMs:    row.avgLatencyMs  ?? 0,
        lastHealthCheck: row.lastHealthCheck ?? undefined,
        keys:            providerKeys,
        rrIndex:         0,
      });
    }
  }

  // ── Seed env var keys (only if no DB key exists for that provider) ──────────

  private seedEnvKeys(): void {
    const envMap: Record<string, string | undefined> = {
      openrouter: process.env["OPENROUTER_API_KEY"],
      gemini:     process.env["GEMINI_API_KEY"],
      groq:       process.env["GROQ_API_KEY"],
      cloudflare: process.env["CLOUDFLARE_API_KEY"],
      mistral:    process.env["MISTRAL_API_KEY"],
    };

    for (const [slug, plainKey] of Object.entries(envMap)) {
      if (!plainKey) continue;
      const p = this.providers.get(slug);
      if (!p) continue;
      if (p.keys.length > 0) continue;  // already has DB keys

      const id           = genId();
      const keyEncrypted = encryptKey(plainKey);
      const prefix       = keyPrefix(plainKey);

      const runtime: RuntimeKeyState = {
        id, providerSlug: slug, name: "env-var",
        keyEncrypted, keyPrefix: prefix,
        enabled: true, status: "active",
        totalRequests: 0, successCount: 0, failureCount: 0,
        consecutiveFailures: 0, avgResponseTimeMs: 0,
      };
      p.keys.push(runtime);

      // If this is openrouter enable it too
      if (slug === "openrouter") p.enabled = true;

      // Persist asynchronously
      void db.insert(aiProviderKeysTable).values({
        id, providerSlug: slug, name: "env-var",
        keyEncrypted, keyPrefix: prefix,
        enabled: true, status: "active",
        totalRequests: 0, successCount: 0, failureCount: 0,
        consecutiveFailures: 0, avgResponseTimeMs: 0,
      }).onConflictDoNothing().catch(() => {});
    }
  }

  // ── Fallback: in-memory only (no DB) ───────────────────────────────────────

  private bootstrapFromEnv(): void {
    for (const adapter of ALL_ADAPTERS) {
      if (!this.providers.has(adapter.slug)) {
        this.providers.set(adapter.slug, {
          slug: adapter.slug, displayName: adapter.displayName,
          enabled: false, priority: ALL_ADAPTERS.indexOf(adapter) + 1,
          routingStrategy: "round-robin",
          healthScore: 100, status: "healthy",
          totalRequests: 0, successCount: 0, failureCount: 0,
          avgLatencyMs: 0, keys: [], rrIndex: 0,
        });
      }
    }
    this.seedEnvKeys();
  }

  // ── Async stat helpers ──────────────────────────────────────────────────────

  private async flushStats(p: RuntimeProviderState, key: RuntimeKeyState): Promise<void> {
    await Promise.all([
      db.update(aiProviderRegistryTable).set({
        totalRequests: p.totalRequests, successCount: p.successCount,
        failureCount: p.failureCount, avgLatencyMs: p.avgLatencyMs, updatedAt: new Date(),
      }).where(eq(aiProviderRegistryTable.slug, p.slug)),
      this.flushKeyOnly(key),
    ]).catch(() => {});
  }

  private async flushKeyOnly(key: RuntimeKeyState): Promise<void> {
    await db.update(aiProviderKeysTable).set({
      status: key.status, enabled: key.enabled,
      totalRequests: key.totalRequests, successCount: key.successCount,
      failureCount: key.failureCount, consecutiveFailures: key.consecutiveFailures,
      avgResponseTimeMs: key.avgResponseTimeMs,
      lastUsedAt: key.lastUsedAt ?? null, lastSuccessAt: key.lastSuccessAt ?? null,
      lastFailureAt: key.lastFailureAt ?? null, lastError: key.lastError ?? null,
      cooldownUntil: key.cooldownUntil ?? null, updatedAt: new Date(),
    }).where(eq(aiProviderKeysTable.id, key.id)).catch(() => {});
  }

  private async logRequest(entry: {
    providerSlug: string; keyId?: string; model?: string; taskType?: TaskType;
    latencyMs?: number; status: string; retries?: number;
    promptTokens?: number; outputTokens?: number;
    errorCode?: number; errorMessage?: string;
  }): Promise<void> {
    await db.insert(aiRequestLogTable).values({
      id: genId(),
      providerSlug: entry.providerSlug,
      keyId:        entry.keyId,
      model:        entry.model,
      taskType:     entry.taskType,
      latencyMs:    entry.latencyMs,
      status:       entry.status,
      retries:      entry.retries ?? 0,
      promptTokens: entry.promptTokens,
      outputTokens: entry.outputTokens,
      errorCode:    entry.errorCode,
      errorMessage: entry.errorMessage,
    }).catch(() => {});
  }
}
