/**
 * Auth Module
 *
 * Endpoints: register, login, logout, refresh, forgot-password, reset-password,
 * and OAuth 2.0 flows (Google, extensible to GitHub/Microsoft/Discord/Apple/Facebook).
 */

import { Router } from "express";
import { z } from "zod";
import { db, usersTable, refreshTokensTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";
import {
  generateId,
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshTokenRaw,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_SECONDS,
  generatePasswordResetToken,
  hashPasswordResetToken,
  resetTokenExpiresAt,
} from "../lib/auth";
import { authenticate } from "../middlewares/authenticate";
import { validateBody } from "../middlewares/validate";
import { recordAuditLog } from "../middlewares/audit";
import { eventBus, PlatformEvents } from "../lib/events";
import { oauthRegistry } from "../lib/oauth/registry";
import { generateOAuthState, verifyOAuthState } from "../lib/oauth/state";
import { authLimiter } from "../middlewares/rate-limit";
import { sendMail, passwordResetEmail } from "../lib/mailer";

const router = Router();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

const oauthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function issueTokenPair(userId: string, email: string, role: string) {
  const accessToken = generateAccessToken({ sub: userId, email, role: role as never });
  const rawRefresh = generateRefreshTokenRaw();
  const tokenHash = hashRefreshToken(rawRefresh);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await db.insert(refreshTokensTable).values({
    id: generateId(),
    userId,
    tokenHash,
    expiresAt,
    isRevoked: false,
  });

  return { accessToken, refreshToken: rawRefresh };
}

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

/** Generate a unique username from email/name for OAuth users */
async function generateUniqueUsername(base: string): Promise<string> {
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 28) || "user";

  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, cleaned))
    .limit(1);

  if (!existing) return cleaned;

  const suffix = Math.random().toString(36).slice(2, 7);
  return `${cleaned}_${suffix}`;
}

// ─── POST /register ───────────────────────────────────────────────────────────

router.post("/register", authLimiter, validateBody(registerSchema), async (req, res) => {
  const { username, email, password } = req.body as z.infer<typeof registerSchema>;

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "Email already in use" });
    return;
  }

  const usernameExists = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.username, username))
    .limit(1);

  if (usernameExists.length > 0) {
    res.status(409).json({ error: "Username already taken" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = generateId();

  const [user] = await db
    .insert(usersTable)
    .values({
      id: userId,
      username,
      email: email.toLowerCase(),
      passwordHash,
      provider: "local",
      role: "user",
      isActive: true,
    })
    .returning();

  const { accessToken, refreshToken } = await issueTokenPair(userId, user!.email, user!.role);

  await recordAuditLog("user.registered", { userId, metadata: { email: user!.email } });
  eventBus.dispatch(PlatformEvents.USER_REGISTERED, { userId, email: user!.email });

  res.status(201).json({
    user: buildUserResponse(user!),
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
  });
});

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post("/login", authLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (!user.passwordHash) {
    const providerName = user.provider ?? "social login";
    res.status(401).json({
      error: `This account uses ${providerName} to sign in. Please click "Continue with ${providerName === "google" ? "Google" : providerName}" instead.`,
    });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastLogin: new Date() })
    .where(eq(usersTable.id, user.id));

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);

  await recordAuditLog("user.logged_in", { userId: user.id, metadata: { email: user.email } });
  eventBus.dispatch(PlatformEvents.USER_LOGGED_IN, { userId: user.id });

  res.json({
    user: buildUserResponse(user),
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
  });
});

// ─── POST /logout ─────────────────────────────────────────────────────────────

router.post("/logout", authenticate, async (req, res) => {
  const userId = req.user!.sub;

  await db
    .update(refreshTokensTable)
    .set({ isRevoked: true })
    .where(and(eq(refreshTokensTable.userId, userId), eq(refreshTokensTable.isRevoked, false)));

  await recordAuditLog("user.logged_out", { userId });
  eventBus.dispatch(PlatformEvents.USER_LOGGED_OUT, { userId });

  res.json({ message: "Logged out successfully" });
});

// ─── POST /refresh ────────────────────────────────────────────────────────────

router.post("/refresh", validateBody(refreshSchema), async (req, res) => {
  const { refresh_token: rawToken } = req.body as z.infer<typeof refreshSchema>;
  const tokenHash = hashRefreshToken(rawToken);

  const [stored] = await db
    .select()
    .from(refreshTokensTable)
    .where(and(eq(refreshTokensTable.tokenHash, tokenHash), eq(refreshTokensTable.isRevoked, false)))
    .limit(1);

  if (!stored || stored.expiresAt < new Date()) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, stored.userId))
    .limit(1);

  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found or deactivated" });
    return;
  }

  await db
    .update(refreshTokensTable)
    .set({ isRevoked: true })
    .where(eq(refreshTokensTable.id, stored.id));

  const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);

  res.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
  });
});

// ─── POST /forgot-password ────────────────────────────────────────────────────

router.post("/forgot-password", authLimiter, validateBody(forgotPasswordSchema), async (req, res) => {
  const { email } = req.body as z.infer<typeof forgotPasswordSchema>;

  const [user] = await db
    .select({ id: usersTable.id, email: usersTable.email, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()))
    .limit(1);

  // Always respond the same way — do not reveal whether the email exists
  if (user) {
    // Invalidate any existing unused tokens for this user
    await db
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, user.id));

    const rawToken  = generatePasswordResetToken();
    const tokenHash = hashPasswordResetToken(rawToken);

    await db.insert(passwordResetTokensTable).values({
      id:        generateId(),
      userId:    user.id,
      tokenHash,
      expiresAt: resetTokenExpiresAt(),
      isUsed:    false,
    });

    // Build reset URL — prefer explicit APP_URL, then Replit domains
    const baseUrl =
      process.env["APP_URL"] ??
      (process.env["REPLIT_DOMAINS"]
        ? `https://${process.env["REPLIT_DOMAINS"]!.split(",")[0]!.trim()}`
        : process.env["REPLIT_DEV_DOMAIN"]
        ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
        : "http://localhost:5000");

    const resetUrl = `${baseUrl}/auth/reset-password?token=${rawToken}`;

    try {
      await sendMail({
        to: user.email,
        ...passwordResetEmail({ resetUrl, username: user.username }),
      });
    } catch {
      // Log internally but don't expose to caller — token is already stored
    }

    await recordAuditLog("user.password_reset_requested", {
      userId: user.id,
      metadata: { token_generated: true },
    });
    eventBus.dispatch(PlatformEvents.USER_PASSWORD_RESET_REQUESTED, {
      userId: user.id,
      email:  user.email,
      token:  rawToken,
    });
  }

  res.json({ message: "If the email exists, a password reset link has been sent" });
});

// ─── POST /reset-password ─────────────────────────────────────────────────────

router.post("/reset-password", authLimiter, validateBody(resetPasswordSchema), async (req, res) => {
  const { token: rawToken, password } = req.body as z.infer<typeof resetPasswordSchema>;

  const tokenHash = hashPasswordResetToken(rawToken);
  const now = new Date();

  const [stored] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        eq(passwordResetTokensTable.isUsed, false),
      ),
    )
    .limit(1);

  if (!stored || stored.expiresAt < now) {
    res.status(400).json({ error: "Invalid or expired password reset token." });
    return;
  }

  const passwordHash = await hashPassword(password);

  // Update password and mark token used in a transaction
  await db.transaction(async (tx) => {
    await tx
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, stored.userId));

    await tx
      .update(passwordResetTokensTable)
      .set({ isUsed: true })
      .where(eq(passwordResetTokensTable.id, stored.id));

    // Revoke all active refresh tokens for this user (force re-login everywhere)
    await tx
      .update(refreshTokensTable)
      .set({ isRevoked: true })
      .where(
        and(
          eq(refreshTokensTable.userId, stored.userId),
          eq(refreshTokensTable.isRevoked, false),
        ),
      );
  });

  // Clean up expired tokens in the background (best effort)
  db.delete(passwordResetTokensTable)
    .where(lt(passwordResetTokensTable.expiresAt, now))
    .catch(() => {/* non-critical */});

  await recordAuditLog("user.password_reset_completed", {
    userId: stored.userId,
    metadata: {},
  });

  res.json({ message: "Password reset successfully. Please sign in with your new password." });
});

// ─── GET /oauth/providers — list which providers are available ────────────────

router.get("/oauth/providers", async (_req, res) => {
  const known = ["google", "github"];
  const available: string[] = [];
  for (const p of known) {
    if (!oauthRegistry.has(p)) continue;
    try {
      await oauthRegistry.get(p).getAuthorizationUrl("__probe__");
      available.push(p);
    } catch {
      // not configured or disabled — skip
    }
  }
  res.json({ providers: available });
});

// ─── GET /oauth/:provider/authorize ──────────────────────────────────────────

router.get("/oauth/:provider/authorize", async (req, res) => {
  const { provider } = req.params as { provider: string };

  if (!oauthRegistry.has(provider)) {
    res.status(400).json({ error: `Unknown OAuth provider: ${provider}` });
    return;
  }

  try {
    const oauthProvider = oauthRegistry.get(provider);
    const state = generateOAuthState(provider);
    const url = await oauthProvider.getAuthorizationUrl(state);
    res.json({ url, state });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("not configured") || message.includes("disabled")) {
      res.status(503).json({ error: message });
    } else {
      res.status(500).json({ error: "Failed to generate OAuth URL" });
    }
  }
});

// ─── POST /oauth/:provider/callback ──────────────────────────────────────────

router.post("/oauth/:provider/callback", validateBody(oauthCallbackSchema), async (req, res) => {
  const { provider } = req.params as { provider: string };
  const { code, state } = req.body as z.infer<typeof oauthCallbackSchema>;

  if (!oauthRegistry.has(provider)) {
    res.status(400).json({ error: `Unknown OAuth provider: ${provider}` });
    return;
  }

  if (!verifyOAuthState(state, provider)) {
    res.status(400).json({ error: "Invalid or expired OAuth state. Please try signing in again." });
    return;
  }

  try {
    const oauthProvider = oauthRegistry.get(provider);
    const profile = await oauthProvider.exchangeCode(code);

    // Find or create user — always link by email
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, profile.email.toLowerCase()))
      .limit(1);

    let user: typeof usersTable.$inferSelect;

    if (existing) {
      // Update OAuth fields if signing in for the first time via this provider
      const updates: Partial<typeof usersTable.$inferInsert> = {
        lastLogin: new Date(),
      };
      if (!existing.provider || existing.provider === "local") {
        updates.provider = provider;
        updates.providerUserId = profile.id;
      }
      if (profile.avatarUrl && !existing.avatarUrl) {
        updates.avatarUrl = profile.avatarUrl;
      }
      if (profile.name && !existing.name) {
        updates.name = profile.name;
      }

      const [updated] = await db
        .update(usersTable)
        .set(updates)
        .where(eq(usersTable.id, existing.id))
        .returning();
      user = updated!;
    } else {
      // Create new user from OAuth profile
      const emailBase = profile.email.split("@")[0] ?? "user";
      const nameBase = profile.name?.split(" ")[0] ?? emailBase;
      const username = await generateUniqueUsername(nameBase);
      const userId = generateId();

      const [created] = await db
        .insert(usersTable)
        .values({
          id: userId,
          username,
          name: profile.name,
          email: profile.email.toLowerCase(),
          passwordHash: null,
          avatarUrl: profile.avatarUrl ?? null,
          provider,
          providerUserId: profile.id,
          role: "user",
          isActive: true,
          lastLogin: new Date(),
        })
        .returning();
      user = created!;

      await recordAuditLog("user.registered", {
        userId,
        metadata: { email: user.email, provider },
      });
      eventBus.dispatch(PlatformEvents.USER_REGISTERED, { userId, email: user.email });
    }

    if (!user.isActive) {
      res.status(403).json({ error: "Account is deactivated. Please contact support." });
      return;
    }

    const { accessToken, refreshToken } = await issueTokenPair(user.id, user.email, user.role);

    await recordAuditLog("user.logged_in", {
      userId: user.id,
      metadata: { email: user.email, provider },
    });
    eventBus.dispatch(PlatformEvents.USER_LOGGED_IN, { userId: user.id });

    res.json({
      user: buildUserResponse(user),
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
    });
  } catch (err) {
    const message = (err as Error).message;
    if (
      message.includes("not configured") ||
      message.includes("disabled") ||
      message.includes("not verified")
    ) {
      res.status(400).json({ error: message });
    } else {
      res.status(500).json({ error: "OAuth sign-in failed. Please try again." });
    }
  }
});

export default router;
