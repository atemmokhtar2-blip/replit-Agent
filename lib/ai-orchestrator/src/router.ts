/**
 * AI Router (v2 — AI OS Router)
 *
 * The central routing engine. Wires together:
 *   - TaskClassifier    — what kind of task is this?
 *   - AgentRegistry     — which specialized agent handles it?
 *   - ModelRegistry     — which model does that agent prefer?
 *   - FallbackEngine    — automatic failover across models
 *   - ExecutionTracker  — telemetry and audit trail
 *
 * Public API:
 *   aiRouter.route()             — UNCHANGED: returns routing decision (used by existing routes)
 *   aiRouter.executeWithAgent()  — NEW: full end-to-end agent execution
 *
 * Routing priority (highest → lowest):
 *   1. Explicit user model override (requestedModel)
 *   2. Agent's preferred models for the classified task type
 *   3. Model catalog entries for the task type (fallback chain)
 */

import { registry as aiProviderRegistry } from "@workspace/ai-provider";
import type { OrchestrationRequest, OrchestrationResult, RoutingDecision, AgentRequest, AgentResult, AgentType } from "./types.js";
import { classifyTask } from "./task-classifier.js";
import { modelRegistry } from "./model-registry.js";
import { agentRegistry } from "./agent-registry.js";
import { executionTracker } from "./execution-tracker.js";

// Legacy task-classifier compatibility wrapper
export const taskClassifier = { classify: classifyTask };

class AIRouter {
  /**
   * ORIGINAL METHOD — unchanged for backward compatibility.
   * Route a message to the appropriate provider + model.
   * Returns routing decision only — does NOT execute.
   */
  route(request: OrchestrationRequest): OrchestrationResult {
    const { messages, userProviderConfig, requestedModel } = request;
    const providerSlug = userProviderConfig.slug;

    const provider = aiProviderRegistry.get(providerSlug);
    if (!provider) {
      throw new Error(
        `Provider "${providerSlug}" is not registered. Available: ${aiProviderRegistry.listSlugs().join(", ")}`
      );
    }

    const classification = classifyTask(messages);

    // Priority 1: Explicit user override
    if (requestedModel) {
      const decision: RoutingDecision = {
        taskType: classification.taskType,
        classification,
        agentType: agentRegistry.selectAgentType(classification.taskType),
        selectedModelId: requestedModel,
        selectedRegistryEntryId: "user-override",
        providerSlug,
        rationale: `User requested model "${requestedModel}". Task: "${classification.taskType}".`,
        fallback: false,
      };
      return { decision, provider, resolvedConfig: { ...userProviderConfig, defaultModel: requestedModel } };
    }

    // Priority 2: Best catalog match for (taskType, providerSlug)
    const entry = modelRegistry.findBestForTask(classification.taskType, providerSlug);
    if (entry) {
      const pct = (classification.confidence * 100).toFixed(0);
      const decision: RoutingDecision = {
        taskType: classification.taskType,
        classification,
        agentType: agentRegistry.selectAgentType(classification.taskType),
        selectedModelId: entry.modelId,
        selectedRegistryEntryId: entry.id,
        providerSlug,
        rationale:
          `Task "${classification.taskType}" (${pct}% confidence, signals: ${classification.signals.slice(0, 3).join(", ") || "none"}). ` +
          `Selected "${entry.name}" [priority ${entry.priority}].`,
        fallback: false,
      };
      return { decision, provider, resolvedConfig: { ...userProviderConfig, defaultModel: entry.modelId } };
    }

    // Priority 3: Provider default fallback
    const fallbackModel = userProviderConfig.defaultModel ?? provider.defaultModel ?? "";
    const decision: RoutingDecision = {
      taskType: classification.taskType,
      classification,
      agentType: agentRegistry.selectAgentType(classification.taskType),
      selectedModelId: fallbackModel,
      selectedRegistryEntryId: "provider-default",
      providerSlug,
      rationale:
        `No catalog entry for "${classification.taskType}" on "${providerSlug}". ` +
        `Using provider default "${fallbackModel}".`,
      fallback: true,
    };
    return { decision, provider, resolvedConfig: userProviderConfig };
  }

  /**
   * NEW METHOD — full end-to-end agent execution via the AI OS.
   *
   * Classifies the task → selects the agent → executes with fallback → tracks telemetry.
   * Returns the complete agent result with content and routing metadata.
   */
  async executeWithAgent(params: {
    messages: Array<{ role: string; content: string }>;
    userId?: string;
    conversationId?: string;
    projectId?: string;
    preferredAgentType?: AgentType;
    requestedModel?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<AgentResult & { taskType: string; agentType: AgentType; rationale: string; executionId: string }> {
    const { messages, userId, conversationId, preferredAgentType, requestedModel, signal } = params;

    // Classify the task
    const classification = classifyTask(messages);
    const { taskType } = classification;

    // Select the agent
    const agentType = preferredAgentType ?? agentRegistry.selectAgentType(taskType);
    const agent = agentRegistry.get(agentType) ?? agentRegistry.findForTask(taskType);

    const rationale =
      `Task "${taskType}" (${(classification.confidence * 100).toFixed(0)}% confidence) ` +
      `→ Agent "${agent.agentType}"`;

    // Track the execution
    const executionId = await executionTracker.start({
      userId,
      conversationId,
      agentType: agent.agentType,
      taskType,
      classification,
      requestSummary: messages[messages.length - 1]?.content?.slice(0, 200),
    });

    // Build the agent request
    const agentRequest: AgentRequest = {
      messages: messages as Array<{ role: "user" | "assistant" | "system"; content: string }>,
      executionId,
      signal,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    };

    // Execute
    const result = await agent.execute(agentRequest);

    // Complete the execution record
    await executionTracker.complete({
      executionId,
      result,
      taskType,
      routingRationale: rationale,
    });

    return {
      ...result,
      taskType,
      agentType: agent.agentType,
      rationale,
      executionId,
    };
  }
}

export const aiRouter = new AIRouter();
