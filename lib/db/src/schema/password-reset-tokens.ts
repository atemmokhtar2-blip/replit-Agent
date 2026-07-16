import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id:         text("id").primaryKey(),
    userId:     text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash:  text("token_hash").notNull().unique(),
    isUsed:     boolean("is_used").notNull().default(false),
    expiresAt:  timestamp("expires_at",  { withTimezone: true }).notNull(),
    createdAt:  timestamp("created_at",  { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("prt_user_id_idx").on(t.userId),
    index("prt_token_hash_idx").on(t.tokenHash),
  ],
);

export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
