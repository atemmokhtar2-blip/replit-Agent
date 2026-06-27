/**
 * Admin Module
 *
 * User management, system stats, project management — admin/super_admin only.
 */

import { Router } from "express";
import { z } from "zod";
import { db, usersTable, projectsTable, notificationsTable } from "@workspace/db";
import { eq, ilike, and, sql, desc, or } from "drizzle-orm";
import { authenticate } from "../middlewares/authenticate";
import { requireRole } from "../middlewares/authorize";
import { validateBody } from "../middlewares/validate";
import { recordAuditLog } from "../middlewares/audit";
import { eventBus, PlatformEvents } from "../lib/events";

const router = Router();
router.use(authenticate, requireRole("admin"));

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    name: u.name ?? null,
    email: u.email,
    avatar_url: u.avatarUrl,
    provider: u.provider ?? "local",
    role: u.role,
    is_active: u.isActive,
    last_login: u.lastLogin?.toISOString() ?? null,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

function formatProject(p: typeof projectsTable.$inferSelect) {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    description: p.description,
    project_type: p.projectType,
    status: p.status,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

// ─── GET /admin/users ─────────────────────────────────────────────────────────

router.get("/users", async (req, res) => {
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query["per_page"] ?? 20)));
  const offset = (page - 1) * perPage;
  const search = req.query["search"] as string | undefined;
  const role = req.query["role"] as string | undefined;
  const isActive = req.query["is_active"] as string | undefined;

  const conditions = [];
  if (search) {
    conditions.push(
      or(ilike(usersTable.username, `%${search}%`), ilike(usersTable.email, `%${search}%`))!
    );
  }
  if (role) conditions.push(eq(usersTable.role, role));
  if (isActive !== undefined) conditions.push(eq(usersTable.isActive, isActive === "true"));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db.select().from(usersTable).where(where).orderBy(desc(usersTable.createdAt)).limit(perPage).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(where),
  ]);

  res.json({ items: rows.map(formatUser), total: count, page, per_page: perPage });
});

// ─── GET /admin/users/:userId ─────────────────────────────────────────────────

router.get("/users/:userId", async (req, res) => {
  const { userId } = req.params as Record<string, string>;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

// ─── PATCH /admin/users/:userId ───────────────────────────────────────────────

const adminUpdateUserSchema = z.object({
  role: z.enum(["user", "moderator", "admin", "super_admin"]).optional(),
  is_active: z.boolean().optional(),
});

router.patch("/users/:userId", validateBody(adminUpdateUserSchema), async (req, res) => {
  const { userId } = req.params as Record<string, string>;
  const adminId = req.user!.sub;
  const data = req.body as z.infer<typeof adminUpdateUserSchema>;

  const updateData: Partial<typeof usersTable.$inferInsert> = {};
  if (data.role !== undefined) updateData.role = data.role;
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (data.role !== undefined) {
    await recordAuditLog("user.role_changed", { userId: adminId, metadata: { targetUserId: userId, newRole: data.role } });
    eventBus.dispatch(PlatformEvents.USER_ROLE_CHANGED, { userId, newRole: data.role, changedBy: adminId });
  }

  res.json(formatUser(updated));
});

// ─── POST /admin/users/:userId/deactivate ─────────────────────────────────────

router.post("/users/:userId/deactivate", async (req, res) => {
  const { userId } = req.params as Record<string, string>;
  const adminId = req.user!.sub;

  if (userId === adminId) {
    res.status(400).json({ error: "Cannot deactivate your own account" });
    return;
  }

  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));

  await recordAuditLog("user.deactivated", { userId: adminId, metadata: { targetUserId: userId } });
  eventBus.dispatch(PlatformEvents.USER_DEACTIVATED, { userId, deactivatedBy: adminId });

  res.json({ message: "User deactivated" });
});

// ─── GET /admin/stats ─────────────────────────────────────────────────────────

router.get("/stats", async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    [{ totalUsers }],
    [{ activeUsers }],
    projectStats,
    [{ newUsersToday }],
    [{ newProjectsToday }],
  ] = await Promise.all([
    db.select({ totalUsers: sql<number>`count(*)::int` }).from(usersTable),
    db.select({ activeUsers: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.isActive, true)),
    db.select({
      status: projectsTable.status,
      projectType: projectsTable.projectType,
      count: sql<number>`count(*)::int`,
    }).from(projectsTable).groupBy(projectsTable.status, projectsTable.projectType),
    db.select({ newUsersToday: sql<number>`count(*)::int` }).from(usersTable).where(sql`created_at >= ${today.toISOString()}`),
    db.select({ newProjectsToday: sql<number>`count(*)::int` }).from(projectsTable).where(sql`created_at >= ${today.toISOString()}`),
  ]);

  const byStatus = { draft: 0, active: 0, archived: 0 };
  const byType = { website: 0, bot: 0 };
  let totalProjects = 0;

  for (const row of projectStats) {
    totalProjects += row.count;
    if (row.status in byStatus) (byStatus as Record<string, number>)[row.status] += row.count;
    if (row.projectType in byType) (byType as Record<string, number>)[row.projectType] += row.count;
  }

  res.json({
    total_users: totalUsers,
    active_users: activeUsers,
    total_projects: totalProjects,
    projects_by_type: byType,
    projects_by_status: byStatus,
    new_users_today: newUsersToday,
    new_projects_today: newProjectsToday,
  });
});

// ─── GET /admin/projects ──────────────────────────────────────────────────────

router.get("/projects", async (req, res) => {
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(req.query["per_page"] ?? 20)));
  const offset = (page - 1) * perPage;
  const search = req.query["search"] as string | undefined;
  const status = req.query["status"] as string | undefined;

  const conditions = [];
  if (search) conditions.push(ilike(projectsTable.name, `%${search}%`));
  if (status) conditions.push(eq(projectsTable.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db.select().from(projectsTable).where(where).orderBy(desc(projectsTable.createdAt)).limit(perPage).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(projectsTable).where(where),
  ]);

  res.json({ items: rows.map(formatProject), total: count, page, per_page: perPage });
});

export default router;
