/**
 * Repository Agent Schema
 *
 * Tables for GitHub authentication, repository imports, analysis results,
 * temporary AI workspaces, secrets management, and git operation logs.
 */

import { pgTable, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { relations } from "drizzle-orm";

// ─── GitHub Connections ────────────────────────────────────────────────────────
// Stores encrypted GitHub credentials per user (PAT or future OAuth).

export const githubConnectionsTable = pgTable("github_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" })
    .unique(),
  connectionType: text("connection_type").notNull().default("pat"), // pat | oauth
  encryptedToken: text("encrypted_token").notNull(),
  githubLogin: text("github_login"),
  githubName: text("github_name"),
  githubAvatarUrl: text("github_avatar_url"),
  githubEmail: text("github_email"),
  scopes: text("scopes"),
  status: text("status").notNull().default("connected"), // connected | disconnected | expired | invalid
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type GithubConnection = typeof githubConnectionsTable.$inferSelect;
export type InsertGithubConnection = typeof githubConnectionsTable.$inferInsert;

// ─── Repository Imports ────────────────────────────────────────────────────────
// Tracks repositories cloned/imported by the user.

export const repositoryImportsTable = pgTable("repository_imports", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  githubConnectionId: text("github_connection_id")
    .references(() => githubConnectionsTable.id, { onDelete: "set null" }),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  description: text("description"),
  defaultBranch: text("default_branch").notNull().default("main"),
  cloneUrl: text("clone_url").notNull(),
  htmlUrl: text("html_url"),
  isPrivate: boolean("is_private").notNull().default(false),
  localPath: text("local_path"),
  status: text("status").notNull().default("pending"), // pending | cloning | cloned | analyzing | ready | error
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RepositoryImport = typeof repositoryImportsTable.$inferSelect;
export type InsertRepositoryImport = typeof repositoryImportsTable.$inferInsert;

// ─── Repository Analysis Results ──────────────────────────────────────────────
// Stores the full analysis of a cloned repository.

export const repoAnalysisResultsTable = pgTable("repo_analysis_results", {
  id: text("id").primaryKey(),
  repositoryImportId: text("repository_import_id")
    .notNull()
    .references(() => repositoryImportsTable.id, { onDelete: "cascade" })
    .unique(),
  framework: text("framework"),
  language: text("language"),
  packageManager: text("package_manager"),
  buildSystem: text("build_system"),
  hasDatabase: boolean("has_database").notNull().default(false),
  hasDocker: boolean("has_docker").notNull().default(false),
  hasCI: boolean("has_ci").notNull().default(false),
  folderTree: jsonb("folder_tree"),
  dependencies: jsonb("dependencies"),
  devDependencies: jsonb("dev_dependencies"),
  detectedEnvVars: jsonb("detected_env_vars"),
  detectedSecrets: jsonb("detected_secrets"),
  routes: jsonb("routes"),
  components: jsonb("components"),
  apis: jsonb("apis"),
  deploymentConfig: jsonb("deployment_config"),
  fullContext: jsonb("full_context"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RepoAnalysisResult = typeof repoAnalysisResultsTable.$inferSelect;
export type InsertRepoAnalysisResult = typeof repoAnalysisResultsTable.$inferInsert;

// ─── Workspace Sessions ────────────────────────────────────────────────────────
// Temporary AI workspace sessions created from a repository import.

export const workspaceSessionsTable = pgTable("workspace_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  repositoryImportId: text("repository_import_id")
    .notNull()
    .references(() => repositoryImportsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  localPath: text("local_path").notNull(),
  baseBranch: text("base_branch").notNull(),
  currentBranch: text("current_branch").notNull(),
  status: text("status").notNull().default("active"), // active | committed | pushed | pr_created | closed | error
  lastCommitHash: text("last_commit_hash"),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type WorkspaceSession = typeof workspaceSessionsTable.$inferSelect;
export type InsertWorkspaceSession = typeof workspaceSessionsTable.$inferInsert;

// ─── Repository Secrets ────────────────────────────────────────────────────────
// Encrypted secrets/credentials managed per repository (Secrets Center).

export const repoSecretsTable = pgTable("repo_secrets", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  repositoryImportId: text("repository_import_id")
    .references(() => repositoryImportsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  encryptedValue: text("encrypted_value"),
  description: text("description"),
  category: text("category").notNull().default("other"), // github | ai | database | storage | payment | email | other
  isRequired: boolean("is_required").notNull().default(false),
  isVerified: boolean("is_verified").notNull().default(false),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  usageInfo: text("usage_info"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type RepoSecret = typeof repoSecretsTable.$inferSelect;
export type InsertRepoSecret = typeof repoSecretsTable.$inferInsert;

// ─── Git Operations Log ────────────────────────────────────────────────────────
// Audit log for every git operation performed.

export const gitOperationsTable = pgTable("git_operations", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  workspaceSessionId: text("workspace_session_id")
    .references(() => workspaceSessionsTable.id, { onDelete: "set null" }),
  repositoryImportId: text("repository_import_id")
    .references(() => repositoryImportsTable.id, { onDelete: "set null" }),
  operation: text("operation").notNull(), // clone | branch | commit | push | pull | fetch | pr | reset | rollback
  branch: text("branch"),
  commitHash: text("commit_hash"),
  prUrl: text("pr_url"),
  status: text("status").notNull().default("success"), // success | failed
  output: text("output"),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GitOperation = typeof gitOperationsTable.$inferSelect;
export type InsertGitOperation = typeof gitOperationsTable.$inferInsert;

// ─── Relations ─────────────────────────────────────────────────────────────────

export const githubConnectionsRelations = relations(githubConnectionsTable, ({ one, many }) => ({
  user: one(usersTable, { fields: [githubConnectionsTable.userId], references: [usersTable.id] }),
  repositories: many(repositoryImportsTable),
}));

export const repositoryImportsRelations = relations(repositoryImportsTable, ({ one, many }) => ({
  user: one(usersTable, { fields: [repositoryImportsTable.userId], references: [usersTable.id] }),
  connection: one(githubConnectionsTable, { fields: [repositoryImportsTable.githubConnectionId], references: [githubConnectionsTable.id] }),
  analysis: one(repoAnalysisResultsTable, { fields: [repositoryImportsTable.id], references: [repoAnalysisResultsTable.repositoryImportId] }),
  workspaces: many(workspaceSessionsTable),
  secrets: many(repoSecretsTable),
  gitOps: many(gitOperationsTable),
}));

export const workspaceSessionsRelations = relations(workspaceSessionsTable, ({ one, many }) => ({
  user: one(usersTable, { fields: [workspaceSessionsTable.userId], references: [usersTable.id] }),
  repository: one(repositoryImportsTable, { fields: [workspaceSessionsTable.repositoryImportId], references: [repositoryImportsTable.id] }),
  gitOps: many(gitOperationsTable),
}));
