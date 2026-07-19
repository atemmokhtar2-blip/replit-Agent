---
name: AI Providers Phase 2 — durable lessons
description: Non-obvious decisions from Phase 2 upgrade that future work must stay consistent with
---

# AI Providers Phase 2 — Durable Lessons

## Encrypted backup requires decrypting keys server-side first
The `/api/v1/ai-providers/backup/export-keys` endpoint returns **plaintext key values** so the
frontend can encrypt them. The regular `/export` endpoint returns only metadata (no key material),
so restoring from it cannot recreate the actual API keys.

Backup file v3 format: `MAGIC(4B, 0xAB CD EF 03) + salt(16B) + iv(12B) + AES-256-GCM ciphertext`
Payload is `{ version: 3, keys: [{ providerSlug, displayName, name, plainKey, prefix }] }`.

Restore flow: decrypt → parse payload → if v3, call `POST /providers/import` directly with `plainKey[]`.
Never route v3 payloads through the textarea — the import textarea expects raw keys, not JSON objects.

**Why:** Feeding decrypted JSON into the import textarea would fail silently (parser strips non-key strings).

## DiscoveredModel new fields must be optional (?)
`supportsFunctionCalling` and `supportsThinking` were added as optional (`?`) to the interface
because all pre-Phase-2 adapter `listModels()` implementations don't set them.
Making them required would break 6 adapters. The DB schema has defaults so `undefined` is safe.

## Drizzle batch upsert: use sql`excluded.column`
`onConflictDoUpdate` with a value from `chunk[0]` sets ALL rows to the first item's value.
Use `sql\`excluded.display_name\`` to reference the PostgreSQL EXCLUDED pseudo-table for correct behavior.

## Web Crypto: getRandomValues returns Uint8Array<ArrayBufferLike>, not Uint8Array<ArrayBuffer>
SubtleCrypto APIs (deriveKey, encrypt, decrypt) expect `Uint8Array<ArrayBuffer>`.
Cast via `salt as unknown as Uint8Array<ArrayBuffer>` when passing sliced/random Uint8Arrays.

## Health monitor active retest — inject testKey via registerTestFn
HealthMonitor's active retest (re-probing error-state keys) requires a callback injected from
manager, not a direct import, to avoid circular dependency.
Call `this.monitor.registerTestFn((keyId) => this.testKey(keyId))` right after constructing the monitor.
