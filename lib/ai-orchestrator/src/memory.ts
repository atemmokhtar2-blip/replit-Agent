/**
 * AI Memory Layer
 *
 * Persistent memory infrastructure for the AI OS.
 * Stores: conversation history, project context, user preferences, execution history.
 *
 * Uses the existing project_memory table (project-scoped key-value store)
 * and the user_ai_preferences table for user-level settings.
 *
 * Memory scopes:
 *   global  — project-level, persists across all sessions
 *   session — conversation-level, expires after inactivity
 *   agent   — agent-specific memory within a session
 */

import { db, projectMemoryTable, userAiPreferencesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { MemoryEntry, ConversationContext } from "./types.js";
import type { ChatMessage } from "@workspace/ai-provider";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Project Memory ────────────────────────────────────────────────────────────

export async function setProjectMemory(
  projectId: string,
  key: string,
  value: unknown,
  scope: "global" | "session" | "agent" = "global",
  ttlSeconds?: number,
): Promise<void> {
  const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;

  const [existing] = await db
    .select({ id: projectMemoryTable.id })
    .from(projectMemoryTable)
    .where(and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.key, key)))
    .limit(1);

  if (existing) {
    await db
      .update(projectMemoryTable)
      .set({ value: value as Record<string, unknown>, scope, expiresAt, updatedAt: new Date() })
      .where(eq(projectMemoryTable.id, existing.id));
  } else {
    await db.insert(projectMemoryTable).values({
      id: generateId(),
      projectId,
      key,
      value: value as Record<string, unknown>,
      scope,
      expiresAt,
    });
  }
}

export async function getProjectMemory<T = unknown>(
  projectId: string,
  key: string,
): Promise<T | null> {
  const [entry] = await db
    .select()
    .from(projectMemoryTable)
    .where(and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.key, key)))
    .limit(1);

  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < new Date()) return null;
  return entry.value as T;
}

export async function getAllProjectMemory(
  projectId: string,
  scope?: "global" | "session" | "agent",
): Promise<MemoryEntry[]> {
  const where = scope
    ? and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.scope, scope))
    : eq(projectMemoryTable.projectId, projectId);

  const entries = await db.select().from(projectMemoryTable).where(where);
  type EntryRow = typeof projectMemoryTable.$inferSelect;

  return entries
    .filter((e: EntryRow) => !e.expiresAt || e.expiresAt > new Date())
    .map((e: EntryRow) => ({
      key: e.key,
      value: e.value,
      scope: e.scope as "global" | "session" | "agent",
      expiresAt: e.expiresAt ?? undefined,
    }));
}

export async function deleteProjectMemory(projectId: string, key: string): Promise<void> {
  await db.delete(projectMemoryTable)
    .where(and(eq(projectMemoryTable.projectId, projectId), eq(projectMemoryTable.key, key)));
}

// ─── Conversation Context ──────────────────────────────────────────────────────

const CONTEXT_KEY_PREFIX = "__ctx_";
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

/**
 * Store recent messages as conversation context for a project.
 * Keeps only the last N messages to control context size.
 */
export async function saveConversationContext(
  projectId: string,
  conversationId: string,
  messages: ChatMessage[],
  maxMessages = 20,
): Promise<void> {
  const recentMessages = messages.slice(-maxMessages);
  await setProjectMemory(
    projectId,
    `${CONTEXT_KEY_PREFIX}${conversationId}`,
    { conversationId, recentMessages, savedAt: new Date().toISOString() },
    "session",
    SESSION_TTL_SECONDS,
  );
}

export async function loadConversationContext(
  projectId: string,
  conversationId: string,
): Promise<ConversationContext | null> {
  const data = await getProjectMemory<{
    conversationId: string;
    recentMessages: ChatMessage[];
    savedAt: string;
  }>(projectId, `${CONTEXT_KEY_PREFIX}${conversationId}`);

  if (!data) return null;
  return {
    conversationId: data.conversationId,
    projectId,
    recentMessages: data.recentMessages,
  };
}

// ─── User AI Preferences ───────────────────────────────────────────────────────

export interface UserAiPrefs {
  preferredProvider?: string;
  preferredModel?: string;
  defaultAgentType?: string;
  contextWindowSize?: number;
  preferences?: Record<string, unknown>;
}

export async function getUserPreferences(userId: string): Promise<UserAiPrefs | null> {
  const [row] = await db
    .select()
    .from(userAiPreferencesTable)
    .where(eq(userAiPreferencesTable.userId, userId))
    .limit(1);

  if (!row) return null;
  return {
    preferredProvider: row.preferredProvider ?? undefined,
    preferredModel: row.preferredModel ?? undefined,
    defaultAgentType: row.defaultAgentType ?? undefined,
    contextWindowSize: row.contextWindowSize,
    preferences: row.preferences as Record<string, unknown> | undefined,
  };
}

export async function setUserPreferences(
  userId: string,
  prefs: UserAiPrefs,
): Promise<void> {
  const [existing] = await db
    .select({ id: userAiPreferencesTable.id })
    .from(userAiPreferencesTable)
    .where(eq(userAiPreferencesTable.userId, userId))
    .limit(1);

  if (existing) {
    await db
      .update(userAiPreferencesTable)
      .set({
        preferredProvider: prefs.preferredProvider ?? null,
        preferredModel: prefs.preferredModel ?? null,
        defaultAgentType: prefs.defaultAgentType ?? null,
        contextWindowSize: prefs.contextWindowSize ?? 10,
        preferences: prefs.preferences ?? null,
        updatedAt: new Date(),
      })
      .where(eq(userAiPreferencesTable.id, existing.id));
  } else {
    await db.insert(userAiPreferencesTable).values({
      id: generateId(),
      userId,
      preferredProvider: prefs.preferredProvider ?? null,
      preferredModel: prefs.preferredModel ?? null,
      defaultAgentType: prefs.defaultAgentType ?? null,
      contextWindowSize: prefs.contextWindowSize ?? 10,
      preferences: prefs.preferences ?? null,
    });
  }
}

// ─── Project Context ───────────────────────────────────────────────────────────

export async function saveProjectContext(
  projectId: string,
  context: Record<string, unknown>,
): Promise<void> {
  await setProjectMemory(projectId, "__project_context", context, "global");
}

export async function loadProjectContext(
  projectId: string,
): Promise<Record<string, unknown> | null> {
  return getProjectMemory<Record<string, unknown>>(projectId, "__project_context");
}
