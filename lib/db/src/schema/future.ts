/**
 * Future Architecture Placeholders
 *
 * These tables define the schema for upcoming platform features.
 * Models, types, and relations are declared here — business logic is NOT implemented yet.
 * Each future module will import and extend these definitions.
 */

import { pgTable, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
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
