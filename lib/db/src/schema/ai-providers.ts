/**
 * Enterprise AI Provider Manager — Database Schema
 *
 * Tables:
 *   aiProviderRegistryTable  — System-level provider registry (openrouter, gemini, groq…)
 *   aiProviderKeysTable      — Encrypted API keys per provider
 *   aiRequestLogTable        — Per-request audit log for analytics
 */

import {
  pgTable, text, boolean, integer, bigint, real,
  timestamp, jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Provider Registry ─────────────────────────────────────────────────────────

export const aiProviderRegistryTable = pgTable("ai_provider_registry", {
  slug:            text("slug").primaryKey(),             // openrouter | gemini | groq | cloudflare | mistral
  displayName:     text("display_name").notNull(),
  baseUrl:         text("base_url").notNull(),
  docsUrl:         text("docs_url"),
  enabled:         boolean("enabled").notNull().default(true),
  priority:        integer("priority").notNull().default(5),  // 1 = highest
  routingStrategy: text("routing_strategy").notNull().default("round-robin"),
  healthScore:     integer("health_score").notNull().default(100),  // 0-100
  status:          text("status").notNull().default("healthy"),     // healthy | degraded | unhealthy | disabled
  totalRequests:   bigint("total_requests", { mode: "number" }).notNull().default(0),
  successCount:    bigint("success_count",  { mode: "number" }).notNull().default(0),
  failureCount:    bigint("failure_count",  { mode: "number" }).notNull().default(0),
  avgLatencyMs:    real("avg_latency_ms").notNull().default(0),
  lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),
  capabilities:    jsonb("capabilities"),    // { streaming, functionCalling, vision, … }
  defaultModels:   jsonb("default_models"),  // string[] — per-task-type model preferences
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiProviderRegistry     = typeof aiProviderRegistryTable.$inferSelect;
export type InsertAiProviderRegistry = typeof aiProviderRegistryTable.$inferInsert;

// ── Provider API Keys ─────────────────────────────────────────────────────────

export const aiProviderKeysTable = pgTable("ai_provider_keys", {
  id:                  text("id").primaryKey(),
  providerSlug:        text("provider_slug").notNull().references(() => aiProviderRegistryTable.slug, { onDelete: "cascade" }),
  name:                text("name").notNull(),            // human-readable label
  keyEncrypted:        text("key_encrypted").notNull(),   // AES-256-GCM encrypted
  keyPrefix:           text("key_prefix").notNull(),      // first 8 chars for display (never full key)
  enabled:             boolean("enabled").notNull().default(true),
  status:              text("status").notNull().default("active"), // active | disabled | exhausted | cooling | error
  totalRequests:       bigint("total_requests",        { mode: "number" }).notNull().default(0),
  successCount:        bigint("success_count",         { mode: "number" }).notNull().default(0),
  failureCount:        bigint("failure_count",         { mode: "number" }).notNull().default(0),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  avgResponseTimeMs:   real("avg_response_time_ms").notNull().default(0),
  lastUsedAt:          timestamp("last_used_at",    { withTimezone: true }),
  lastSuccessAt:       timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt:       timestamp("last_failure_at", { withTimezone: true }),
  lastError:           text("last_error"),
  cooldownUntil:       timestamp("cooldown_until",  { withTimezone: true }),
  createdAt:           timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:           timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiProviderKey     = typeof aiProviderKeysTable.$inferSelect;
export type InsertAiProviderKey = typeof aiProviderKeysTable.$inferInsert;

// ── Request Log ───────────────────────────────────────────────────────────────

export const aiRequestLogTable = pgTable("ai_request_log", {
  id:            text("id").primaryKey(),
  providerSlug:  text("provider_slug").notNull(),
  keyId:         text("key_id"),
  model:         text("model"),
  taskType:      text("task_type"),           // planning | code-gen | debugging | general …
  promptTokens:  integer("prompt_tokens"),
  outputTokens:  integer("output_tokens"),
  latencyMs:     integer("latency_ms"),
  status:        text("status").notNull(),    // success | failed | retried | abandoned
  retries:       integer("retries").notNull().default(0),
  errorCode:     integer("error_code"),
  errorMessage:  text("error_message"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiRequestLog     = typeof aiRequestLogTable.$inferSelect;
export type InsertAiRequestLog = typeof aiRequestLogTable.$inferInsert;

// ── Relations ─────────────────────────────────────────────────────────────────

export const aiProviderRegistryRelations = relations(
  aiProviderRegistryTable,
  ({ many }) => ({ keys: many(aiProviderKeysTable) }),
);

export const aiProviderKeysRelations = relations(
  aiProviderKeysTable,
  ({ one }) => ({
    provider: one(aiProviderRegistryTable, {
      fields: [aiProviderKeysTable.providerSlug],
      references: [aiProviderRegistryTable.slug],
    }),
  }),
);
