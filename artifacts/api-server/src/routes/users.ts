/**
 * Users Module
 *
 * Endpoints: get/update current user profile, change password
 */

import { Router } from "express";
import { z } from "zod";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../lib/auth";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";
import { recordAuditLog } from "../middlewares/audit";
import { eventBus, PlatformEvents } from "../lib/events";

const router = Router();

router.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildUserResponse(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    name: user.name ?? null,
    email: user.email,
    avatar_url: user.avatarUrl,
    provider: user.provider ?? "local",
    role: user.role,
    is_active: user.isActive,
    last_login: user.lastLogin?.toISOString() ?? null,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

// ─── GET /users/me ────────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.sub))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json(buildUserResponse(user));
});

// ─── PATCH /users/me ──────────────────────────────────────────────────────────

const updateMeSchema = z.object({
  username: z.string().min(3).max(50).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

router.patch("/me", validateBody(updateMeSchema), async (req, res) => {
  const data = req.body as z.infer<typeof updateMeSchema>;
  const userId = req.user!.sub;

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (data.username !== undefined) updateData.username = data.username;
  if (data.avatar_url !== undefined) updateData.avatarUrl = data.avatar_url;

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await recordAuditLog("user.profile_updated", { userId, metadata: { fields: Object.keys(updateData) } });
  eventBus.dispatch(PlatformEvents.USER_PROFILE_UPDATED, { userId });

  res.json(buildUserResponse(updated));
});

// ─── PATCH /users/me/password ─────────────────────────────────────────────────

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});

router.patch("/me/password", validateBody(changePasswordSchema), async (req, res) => {
  const { current_password, new_password } = req.body as z.infer<typeof changePasswordSchema>;
  const userId = req.user!.sub;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await verifyPassword(current_password, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await hashPassword(new_password);
  await db.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, userId));

  await recordAuditLog("user.password_changed", { userId });
  eventBus.dispatch(PlatformEvents.USER_PASSWORD_CHANGED, { userId });

  res.json({ message: "Password changed successfully" });
});

export default router;
