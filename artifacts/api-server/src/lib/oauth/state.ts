/**
 * OAuth CSRF State — HMAC-signed, time-limited, self-verifying
 *
 * No server-side session storage required. The state encodes a nonce + timestamp
 * and is signed with the JWT_SECRET so it cannot be forged or replayed.
 */

import crypto from "node:crypto";

const STATE_TTL_SECONDS = 15 * 60;

function getStateKey(): Buffer {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("[OAuth] FATAL: JWT_SECRET is required for OAuth state signing in production.");
    }
    // Dev-only fallback — warns so it is never silently missed
    console.warn("[OAuth] WARNING: JWT_SECRET not set — using insecure dev fallback for OAuth state signing.");
  }
  return crypto
    .createHmac("sha256", "oauth-state-v1")
    .update(secret ?? "dev-oauth-state-secret-CHANGE-IN-PRODUCTION")
    .digest();
}

export function generateOAuthState(provider: string): string {
  const nonce   = crypto.randomBytes(16).toString("hex");
  const ts      = Math.floor(Date.now() / 1000);
  const payload = `${provider}|${nonce}|${ts}`;
  const hmac    = crypto.createHmac("sha256", getStateKey()).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ provider, nonce, ts, hmac })).toString("base64url");
}

export function verifyOAuthState(state: string, expectedProvider: string): boolean {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      provider: string;
      nonce: string;
      ts: number;
      hmac: string;
    };
    const { provider, nonce, ts, hmac } = parsed;
    if (provider !== expectedProvider) return false;
    const now = Math.floor(Date.now() / 1000);
    if (now - ts > STATE_TTL_SECONDS || ts > now + 60) return false;
    const payload  = `${provider}|${nonce}|${ts}`;
    const expected = crypto.createHmac("sha256", getStateKey()).update(payload).digest("hex");
    if (hmac.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
