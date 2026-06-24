/**
 * Provider Configuration Schema
 *
 * Per-user AI provider configurations.
 * Supports multiple providers per user; one can be active at a time.
 * API keys are stored as plaintext (encryption can be layered later).
 */

import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users.js";
import { relations } from "drizzle-orm";

export const providerConfigsTable = pgTable("provider_configs", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  defaultModel: text("default_model"),
  isActive: boolean("is_active").notNull().default(false),
  config: jsonb("config"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const providerConfigsRelations = relations(
  providerConfigsTable,
  ({ one }) => ({
    user: one(usersTable, {
      fields: [providerConfigsTable.userId],
      references: [usersTable.id],
    }),
  })
);

export type ProviderConfigRow = typeof providerConfigsTable.$inferSelect;
export type InsertProviderConfig = typeof providerConfigsTable.$inferInsert;
