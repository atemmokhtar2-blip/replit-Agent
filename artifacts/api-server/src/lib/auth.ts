/**
 * JWT Authentication Utilities
 *
 * Handles access token creation/verification and refresh token management.
 * Access tokens are short-lived (15min). Refresh tokens are long-lived (7d)
 * and stored hashed in the database for revocation support.
 */

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { UserRole } from "@workspace/db";

// ── Startup secret validation — hard-fail in production if secrets not set ────
function requireSecret(name: string, devFallback?: string): string {
  const value = process.env[name];
  if (value) return value;

  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      `[auth] FATAL: ${name} environment variable is not set. ` +
      `The server cannot start securely in production without it. ` +
      `Generate one with: openssl rand -hex 64`,
    );
  }

  // Development-only fallback — warns loudly so it is never missed
  console.warn(
    `[auth] WARNING: ${name} is not set. Using an insecure dev fallback. ` +
    `This MUST be fixed before any production deployment.`,
  );
  return devFallback!;
}

const ACCESS_TOKEN_SECRET  = requireSecret("JWT_SECRET",         "dev-access-secret-CHANGE-IN-PRODUCTION");
const REFRESH_TOKEN_SECRET = requireSecret("JWT_REFRESH_SECRET",  "dev-refresh-secret-CHANGE-IN-PRODUCTION");

export const ACCESS_TOKEN_TTL          = "15m";
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface JwtPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// ─── Token Generation ─────────────────────────────────────────────────────────

export function generateAccessToken(payload: Omit<JwtPayload, "iat" | "exp">): string {
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function generateRefreshTokenRaw(): string {
  return crypto.randomBytes(64).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Token Verification ───────────────────────────────────────────────────────

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as JwtPayload;
}

export function verifyRefreshTokenStructure(token: string): boolean {
  return /^[a-f0-9]{128}$/.test(token);
}

// ─── Password Hashing ─────────────────────────────────────────────────────────

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── UUID v4 Helper ───────────────────────────────────────────────────────────

export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Password Reset Tokens ────────────────────────────────────────────────────

const RESET_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashPasswordResetToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function resetTokenExpiresAt(): Date {
  return new Date(Date.now() + RESET_TOKEN_TTL_SECONDS * 1000);
}
