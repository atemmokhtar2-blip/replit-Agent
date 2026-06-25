/**
 * Future Architecture Placeholders + AI OS Infrastructure
 *
 * These tables define the schema for upcoming platform features and the
 * live AI OS infrastructure (execution records, health snapshots, routing events).
 */

import { pgTable, text, boolean, integer, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { projectsTable } from "./projects";

// --- AI Conversations ---
export const aiConversationsTable = pgTable("ai_conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiConversation = typeof aiConversationsTable.$inferSelect;

// --- AI Messages ---
export const aiMessagesTable = pgTable("ai_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").references(() => aiConversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiMessage = typeof aiMessagesTable.$inferSelect;

// --- Project Files ---
export const projectFilesTable = pgTable("project_files", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content"),
  mimeType: text("mime_type"),
  size: integer("size"),
  storageKey: text("storage_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProjectFile = typeof projectFilesTable.$inferSelect;

// --- Project Versions ---
export const projectVersionsTable = pgTable("project_versions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  snapshot: jsonb("snapshot"),
  createdBy: text("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectVersion = typeof projectVersionsTable.$inferSelect;

// --- Deployments ---
export const deploymentsTable = pgTable("deployments", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  triggeredBy: text("triggered_by").references(() => usersTable.id),
  status: text("status").notNull().default("pending"), // pending | building | deployed | failed | cancelled
  environment: text("environment").notNull().default("production"),
  deployUrl: text("deploy_url"),
  buildLog: text("build_log"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Deployment = typeof deploymentsTable.$inferSelect;

// --- Deployment Logs ---
export const deploymentLogsTable = pgTable("deployment_logs", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").references(() => deploymentsTable.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("info"), // info | warn | error
  message: text("message").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeploymentLog = typeof deploymentLogsTable.$inferSelect;

// --- Project Memory ---
export const projectMemoryTable = pgTable("project_memory", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  scope: text("scope").notNull().default("global"), // global | session | agent
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ProjectMemory = typeof projectMemoryTable.$inferSelect;

// --- AI Providers ---
export const aiProvidersTable = pgTable("ai_providers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  capabilities: jsonb("capabilities"),
  config: jsonb("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiProvider = typeof aiProvidersTable.$inferSelect;

// --- AI Agents ---
export const aiAgentsTable = pgTable("ai_agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  providerId: text("provider_id").references(() => aiProvidersTable.id),
  agentType: text("agent_type").notNull(), // code | chat | deploy | memory | orchestrator
  config: jsonb("config"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AiAgent = typeof aiAgentsTable.$inferSelect;

// --- Usage Analytics ---
export const usageAnalyticsTable = pgTable("usage_analytics", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  event: text("event").notNull(),
  metadata: jsonb("metadata"),
  sessionId: text("session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UsageAnalytic = typeof usageAnalyticsTable.$inferSelect;

// --- Billing Architecture ---
export const billingPlansTable = pgTable("billing_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  price: integer("price").notNull().default(0), // in cents
  interval: text("interval").notNull().default("month"), // month | year
  features: jsonb("features"),
  limits: jsonb("limits"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingPlan = typeof billingPlansTable.$inferSelect;

export const userSubscriptionsTable = pgTable("user_subscriptions", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  planId: text("plan_id").references(() => billingPlansTable.id),
  status: text("status").notNull().default("active"), // active | cancelled | past_due | trialing
  externalId: text("external_id"), // Stripe subscription ID
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;

// --- Team Workspaces ---
export const teamWorkspacesTable = pgTable("team_workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ownerId: text("owner_id").references(() => usersTable.id),
  planId: text("plan_id").references(() => billingPlansTable.id),
  settings: jsonb("settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TeamWorkspace = typeof teamWorkspacesTable.$inferSelect;

export const teamMembersTable = pgTable("team_members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").references(() => teamWorkspacesTable.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner | admin | member
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TeamMember = typeof teamMembersTable.$inferSelect;

// --- Project Activity ---
export const projectActivityTable = pgTable("project_activity", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ProjectActivity = typeof projectActivityTable.$inferSelect;

// --- Workspace State ---
export const workspaceStateTable = pgTable("workspace_state", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projectsTable.id, { onDelete: "cascade" }).notNull().unique(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  state: jsonb("state").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WorkspaceState = typeof workspaceStateTable.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────
// AI OS Infrastructure — Execution Records, Health Monitoring, Routing Events
// ─────────────────────────────────────────────────────────────────────────────

// --- Execution Records ---
// Every AI request creates one record. Tracks agent, model, latency, retries, failovers.
export const executionRecordsTable = pgTable("execution_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id"),
  agentType: text("agent_type").notNull(),
  taskType: text("task_type").notNull(),
  providerSlug: text("provider_slug").notNull(),
  modelId: text("model_id").notNull(),
  registryEntryId: text("registry_entry_id"),
  requestSummary: text("request_summary"),
  status: text("status").notNull().default("pending"),
  latencyMs: integer("latency_ms"),
  retries: integer("retries").notNull().default(0),
  failovers: integer("failovers").notNull().default(0),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  errorType: text("error_type"),
  errorMessage: text("error_message"),
  routingRationale: text("routing_rationale"),
  metadata: jsonb("metadata"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type ExecutionRecord = typeof executionRecordsTable.$inferSelect;

// --- Model Health Snapshots ---
// Periodic health snapshots per model. Drives the health dashboard.
export const modelHealthSnapshotsTable = pgTable("model_health_snapshots", {
  id: text("id").primaryKey(),
  registryEntryId: text("registry_entry_id").notNull(),
  providerSlug: text("provider_slug").notNull(),
  uptimePct: real("uptime_pct").notNull().default(100),
  avgResponseMs: integer("avg_response_ms"),
  successRate: real("success_rate").notNull().default(100),
  errorRate: real("error_rate").notNull().default(0),
  totalRequests: integer("total_requests").notNull().default(0),
  activeRequests: integer("active_requests").notNull().default(0),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ModelHealthSnapshot = typeof modelHealthSnapshotsTable.$inferSelect;

// --- Routing Events ---
// Every routing decision (model selected, fallback activated, etc.) is logged here.
export const routingEventsTable = pgTable("routing_events", {
  id: text("id").primaryKey(),
  executionId: text("execution_id").references(() => executionRecordsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  fromModelId: text("from_model_id"),
  toModelId: text("to_model_id"),
  agentType: text("agent_type"),
  taskType: text("task_type"),
  reason: text("reason"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RoutingEvent = typeof routingEventsTable.$inferSelect;

// --- User AI Preferences ---
// Per-user AI OS preferences: preferred provider, model, context window, etc.
export const userAiPreferencesTable = pgTable("user_ai_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull().unique(),
  preferredProvider: text("preferred_provider"),
  preferredModel: text("preferred_model"),
  defaultAgentType: text("default_agent_type"),
  contextWindowSize: integer("context_window_size").notNull().default(10),
  preferences: jsonb("preferences"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type UserAiPreferences = typeof userAiPreferencesTable.$inferSelect;
