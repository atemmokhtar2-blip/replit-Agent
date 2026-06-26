/**
 * AES-256-GCM encryption for storing GitHub tokens and secrets.
 * Key must be a 64-char hex string (32 bytes) stored in ENCRYPTION_KEY env var.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env["ENCRYPTION_KEY"];
  if (!raw || raw.length < 32) {
    throw new Error("ENCRYPTION_KEY env var is required (min 32 chars). Generate with: openssl rand -hex 32");
  }
  // Accept either raw string or hex — pad/truncate to 32 bytes
  const buf = Buffer.from(raw.length === 64 ? raw : raw.padEnd(64, "0"), "hex");
  if (buf.length !== 32) {
    return Buffer.from(raw.slice(0, 32));
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted value format");
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex!, "hex");
  const tag = Buffer.from(tagHex!, "hex");
  const data = Buffer.from(dataHex!, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString("utf8") + decipher.final("utf8");
}

export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(value);
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString("hex");
}

/** Constant-time comparison to prevent timing attacks */
export function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
