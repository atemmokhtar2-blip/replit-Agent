/**
 * Execution Tracker
 *
 * Creates and manages execution records in the database.
 * Every AI request flowing through the OS gets one record.
 *
 * Records store: agent type, task type, model used, latency,
 * retries, failovers, status, routing rationale, and timestamps.
 */

import { db, executionRecordsTable, routingEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { AgentResult, AgentType, TaskType, TaskClassification, RoutingEventType } from "./types.js";

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface StartExecutionParams {
  userId?: string;
  conversationId?: string;
  agentType: AgentType;
  taskType: TaskType;
  classification?: TaskClassification;
  requestSummary?: string;
}

export interface CompleteExecutionParams {
  executionId: string;
  result: AgentResult;
  taskType: TaskType;
  routingRationale?: string;
}

class ExecutionTracker {
  async start(params: StartExecutionParams): Promise<string> {
    const id = generateId();
    try {
      await db.insert(executionRecordsTable).values({
        id,
        userId: params.userId ?? null,
        conversationId: params.conversationId ?? null,
        agentType: params.agentType,
        taskType: params.taskType,
        requestSummary: params.requestSummary?.slice(0, 200) ?? null,
        status: "running",
        retries: 0,
        failovers: 0,
        providerSlug: "pending",
        modelId: "pending",
        startedAt: new Date(),
      });
      await this.logRoutingEvent({
        executionId: id,
        eventType: "agent_selected",
        agentType: params.agentType,
        taskType: params.taskType,
        reason: params.classification
          ? `Classified as "${params.taskType}" (confidence: ${(params.classification.confidence * 100).toFixed(0)}%)`
          : `Agent: ${params.agentType}`,
      });
    } catch (err) {
      console.error("[ExecutionTracker] start() error:", err instanceof Error ? err.message : err);
    }
    return id;
  }

  async complete(params: CompleteExecutionParams): Promise<void> {
    const { executionId, result, taskType, routingRationale } = params;
    try {
      await db
        .update(executionRecordsTable)
        .set({
          status: result.error ? "failed" : "completed",
          providerSlug: result.providerSlug,
          modelId: result.modelId,
          registryEntryId: result.registryEntryId,
          latencyMs: result.latencyMs,
          retries: result.retries,
          failovers: result.failovers,
          errorMessage: result.error?.slice(0, 500) ?? null,
          routingRationale: routingRationale?.slice(0, 500) ?? null,
          completedAt: new Date(),
        })
        .where(eq(executionRecordsTable.id, executionId));

      await this.logRoutingEvent({
        executionId,
        eventType: "model_selected",
        toModelId: result.modelId,
        agentType: result.agentType,
        taskType,
        reason: `Selected ${result.modelId} (failovers: ${result.failovers}, retries: ${result.retries})`,
      });

      if (result.failovers > 0) {
        await this.logRoutingEvent({
          executionId,
          eventType: "fallback_activated",
          agentType: result.agentType,
          taskType,
          reason: `${result.failovers} failover(s) occurred`,
        });
      }

      await this.logRoutingEvent({
        executionId,
        eventType: result.error ? "failed" : "completed",
        toModelId: result.modelId,
        agentType: result.agentType,
        taskType,
        reason: result.error
          ? `Error: ${result.error.slice(0, 200)}`
          : `Completed in ${result.latencyMs}ms`,
      });
    } catch (err) {
      console.error("[ExecutionTracker] complete() error:", err instanceof Error ? err.message : err);
    }
  }

  async logRoutingEvent(params: {
    executionId: string;
    eventType: RoutingEventType;
    fromModelId?: string;
    toModelId?: string;
    agentType?: string;
    taskType?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await db.insert(routingEventsTable).values({
        id: generateId(),
        executionId: params.executionId,
        eventType: params.eventType,
        fromModelId: params.fromModelId ?? null,
        toModelId: params.toModelId ?? null,
        agentType: params.agentType ?? null,
        taskType: params.taskType ?? null,
        reason: params.reason ?? null,
        metadata: params.metadata ?? null,
        createdAt: new Date(),
      });
    } catch {
      // Non-critical — never block main flow
    }
  }
}

export const executionTracker = new ExecutionTracker();
