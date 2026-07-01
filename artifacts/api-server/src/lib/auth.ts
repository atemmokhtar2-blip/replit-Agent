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

const ACCESS_TOKEN_SECRET = process.env["JWT_SECRET"] ?? "dev-access-secret-change-in-production";
const REFRESH_TOKEN_SECRET = process.env["JWT_REFRESH_SECRET"] ?? "dev-refresh-secret-change-in-production";

export const ACCESS_TOKEN_TTL = "15m";
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
// Using crypto.randomUUID for IDs (Node 19+). Future phases can switch to uuid-v7
// for time-ordered sortable IDs once the library is integrated.

export function generateId(): string {
  return crypto.randomUUID();
}

// ─── Password Reset Tokens ────────────────────────────────────────────────────
// Phase 1: tokens are generated but email delivery is a no-op.
// Future phases will integrate an email provider and store tokens in DB.

export function generatePasswordResetToken(): string {
  return crypto.randomBytes(32).toString("hex");
}
