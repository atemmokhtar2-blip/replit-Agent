/**
 * Specification Store
 *
 * Persists and retrieves ExecutionSpecs from the database.
 * One spec per conversation; creates new versions when rebuilt.
 */

import { db, projectSpecificationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import type { ExecutionSpec, ValidationResult } from "./spec-types.js";

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function saveSpec(
  userId: string,
  spec: ExecutionSpec,
  validationResult?: ValidationResult,
): Promise<string> {
  const [existing] = await db
    .select({ id: projectSpecificationsTable.id, version: projectSpecificationsTable.version })
    .from(projectSpecificationsTable)
    .where(eq(projectSpecificationsTable.conversationId, spec.conversationId))
    .orderBy(desc(projectSpecificationsTable.version))
    .limit(1);

  const id = genId();
  const version = existing ? existing.version + 1 : 1;

  await db.insert(projectSpecificationsTable).values({
    id,
    conversationId: spec.conversationId,
    projectId: spec.projectId ?? null,
    userId,
    summary: spec.summary,
    projectType: spec.projectType,
    understanding: spec.understanding as unknown as Record<string, unknown>,
    spec: spec as unknown as Record<string, unknown>,
    version,
    status: validationResult?.valid === false ? "validation_failed" : "draft",
    validationResult: validationResult ? (validationResult as unknown as Record<string, unknown>) : null,
  });

  return id;
}

export async function getSpecByConversation(conversationId: string): Promise<ExecutionSpec | null> {
  const [row] = await db
    .select()
    .from(projectSpecificationsTable)
    .where(eq(projectSpecificationsTable.conversationId, conversationId))
    .orderBy(desc(projectSpecificationsTable.version))
    .limit(1);

  if (!row) return null;
  return row.spec as unknown as ExecutionSpec;
}

export async function getSpecById(specId: string): Promise<ExecutionSpec | null> {
  const [row] = await db
    .select()
    .from(projectSpecificationsTable)
    .where(eq(projectSpecificationsTable.id, specId))
    .limit(1);

  if (!row) return null;
  return row.spec as unknown as ExecutionSpec;
}

export async function updateSpecStatus(
  specId: string,
  status: string,
  validationResult?: ValidationResult,
): Promise<void> {
  await db
    .update(projectSpecificationsTable)
    .set({
      status,
      validationResult: validationResult ? (validationResult as unknown as Record<string, unknown>) : undefined,
    })
    .where(eq(projectSpecificationsTable.id, specId));
}
