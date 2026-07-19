/**
 * Enterprise AI Provider Manager — Database Schema
 *
 * Tables:
 *   aiProviderRegistryTable    — System-level provider registry
 *   aiProviderKeysTable        — Encrypted API keys per provider
 *   aiRequestLogTable          — Per-request audit log for analytics
 *   aiDiscoveredModelsTable    — Models discovered from provider APIs
 */

import {
  pgTable, text, boolean, integer, bigint, real,
  timestamp, jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Provider Registry ─────────────────────────────────────────────────────────

export const aiProviderRegistryTable = pgTable("ai_provider_registry", {
  slug:            text("slug").primaryKey(),
  displayName:     text("display_name").notNull(),
  baseUrl:         text("base_url").notNull(),
  docsUrl:         text("docs_url"),
  enabled:         boolean("enabled").notNull().default(true),
  priority:        integer("priority").notNull().default(5),
  routingStrategy: text("routing_strategy").notNull().default("round-robin"),
  healthScore:     integer("health_score").notNull().default(100),
  status:          text("status").notNull().default("healthy"),
  totalRequests:   bigint("total_requests", { mode: "number" }).notNull().default(0),
  successCount:    bigint("success_count",  { mode: "number" }).notNull().default(0),
  failureCount:    bigint("failure_count",  { mode: "number" }).notNull().default(0),
  avgLatencyMs:    real("avg_latency_ms").notNull().default(0),
  lastHealthCheck: timestamp("last_health_check", { withTimezone: true }),
  capabilities:    jsonb("capabilities"),
  defaultModels:   jsonb("default_models"),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiProviderRegistry      = typeof aiProviderRegistryTable.$inferSelect;
export type InsertAiProviderRegistry = typeof aiProviderRegistryTable.$inferInsert;

// ── Provider API Keys ─────────────────────────────────────────────────────────

export const aiProviderKeysTable = pgTable("ai_provider_keys", {
  id:                  text("id").primaryKey(),
  providerSlug:        text("provider_slug").notNull().references(() => aiProviderRegistryTable.slug, { onDelete: "cascade" }),
  name:                text("name").notNull(),
  keyEncrypted:        text("key_encrypted").notNull(),
  keyPrefix:           text("key_prefix").notNull(),
  enabled:             boolean("enabled").notNull().default(true),
  status:              text("status").notNull().default("active"),
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

export type AiProviderKey      = typeof aiProviderKeysTable.$inferSelect;
export type InsertAiProviderKey = typeof aiProviderKeysTable.$inferInsert;

// ── Request Log ───────────────────────────────────────────────────────────────

export const aiRequestLogTable = pgTable("ai_request_log", {
  id:            text("id").primaryKey(),
  providerSlug:  text("provider_slug").notNull(),
  keyId:         text("key_id"),
  model:         text("model"),
  taskType:      text("task_type"),
  promptTokens:  integer("prompt_tokens"),
  outputTokens:  integer("output_tokens"),
  latencyMs:     integer("latency_ms"),
  status:        text("status").notNull(),
  retries:       integer("retries").notNull().default(0),
  errorCode:     integer("error_code"),
  errorMessage:  text("error_message"),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiRequestLog      = typeof aiRequestLogTable.$inferSelect;
export type InsertAiRequestLog = typeof aiRequestLogTable.$inferInsert;

// ── Discovered Models ─────────────────────────────────────────────────────────
// Populated automatically at startup and refreshed periodically.
// id = providerSlug + ":" + modelId (e.g. "openrouter:moonshotai/kimi-k2")

export const aiDiscoveredModelsTable = pgTable("ai_discovered_models", {
  id:                 text("id").primaryKey(),               // providerSlug:modelId
  providerSlug:       text("provider_slug").notNull(),
  modelId:            text("model_id").notNull(),
  displayName:        text("display_name").notNull(),
  description:        text("description"),
  contextLength:      integer("context_length"),
  inputPricePer1M:    real("input_price_per1m"),             // USD per 1M prompt tokens
  outputPricePer1M:   real("output_price_per1m"),            // USD per 1M completion tokens
  isFree:             boolean("is_free").notNull().default(false),
  supportsVision:     boolean("supports_vision").notNull().default(false),
  supportsTools:      boolean("supports_tools").notNull().default(false),
  supportsReasoning:  boolean("supports_reasoning").notNull().default(false),
  supportsStreaming:  boolean("supports_streaming").notNull().default(true),
  supportsFunctionCalling: boolean("supports_function_calling").notNull().default(false),
  supportsThinking:   boolean("supports_thinking").notNull().default(false),
  maxOutputTokens:    integer("max_output_tokens"),
  categories:         jsonb("categories").$type<string[]>(),  // e.g. ["coding","free","fast"]
  rankScore:          real("rank_score").notNull().default(0),
  priority:           integer("priority").notNull().default(50),
  enabled:            boolean("enabled").notNull().default(true),
  rawMetadata:        jsonb("raw_metadata"),
  lastDiscoveredAt:   timestamp("last_discovered_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiDiscoveredModel      = typeof aiDiscoveredModelsTable.$inferSelect;
export type InsertAiDiscoveredModel = typeof aiDiscoveredModelsTable.$inferInsert;

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
