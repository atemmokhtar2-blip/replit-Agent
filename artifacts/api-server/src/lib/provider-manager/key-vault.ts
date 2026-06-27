/**
 * Key Vault — AES-256-GCM encrypted storage for API keys
 *
 * The encryption key is derived from:
 *   1. PROVIDER_ENCRYPTION_KEY env var (preferred — 32-byte hex)
 *   2. JWT_SECRET env var (HKDF-derived 32 bytes)
 *   3. Deterministic fallback from NODE_ENV (dev only)
 *
 * Keys are NEVER logged or returned to clients in plaintext.
 * The UI only ever sees the `keyPrefix` (first 8 characters) for identification.
 */

import crypto from "node:crypto";

const ALG  = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;

// ── Derive the 32-byte encryption key ────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const rawEnv = process.env["PROVIDER_ENCRYPTION_KEY"];
  if (rawEnv && rawEnv.length >= 32) {
    return Buffer.from(rawEnv.slice(0, 64), "hex").slice(0, 32);
  }

  const jwtSecret = process.env["JWT_SECRET"];
  if (jwtSecret) {
    // HKDF extract + expand (RFC 5869) to get a stable 32-byte key
    const prk = crypto.createHmac("sha256", "ai-provider-vault-salt").update(jwtSecret).digest();
    return crypto.createHmac("sha256", prk).update("provider-key-encryption-v1").digest().slice(0, 32);
  }

  // Dev-only deterministic fallback — will warn loudly
  if (process.env["NODE_ENV"] !== "production") {
    console.warn("[KeyVault] WARNING: using insecure dev encryption key. Set PROVIDER_ENCRYPTION_KEY in production.");
    return Buffer.from("dev-provider-vault-key-000000000").slice(0, 32);
  }

  throw new Error("PROVIDER_ENCRYPTION_KEY or JWT_SECRET must be set in production");
}

const VAULT_KEY = getEncryptionKey();

// ── Encrypt ───────────────────────────────────────────────────────────────────

export function encryptKey(plaintext: string): string {
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, VAULT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ── Decrypt ───────────────────────────────────────────────────────────────────

export function decryptKey(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid ciphertext format");
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const iv        = Buffer.from(ivHex,  "hex");
  const tag       = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher  = crypto.createDecipheriv(ALG, VAULT_KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString("utf8") + decipher.final("utf8");
}

// ── Safe prefix (for display) ─────────────────────────────────────────────────

export function keyPrefix(plaintext: string): string {
  return plaintext.slice(0, 8).padEnd(8, "*") + "…";
}

// ── Mask for logs ─────────────────────────────────────────────────────────────

export function maskKey(plaintext: string): string {
  if (plaintext.length <= 8) return "****";
  return plaintext.slice(0, 4) + "****" + plaintext.slice(-4);
}
