import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const oauthProviderConfigsTable = pgTable("oauth_provider_configs", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  clientId: text("client_id"),
  clientSecretEncrypted: text("client_secret_encrypted"),
  redirectUri: text("redirect_uri"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type OAuthProviderConfig = typeof oauthProviderConfigsTable.$inferSelect;
