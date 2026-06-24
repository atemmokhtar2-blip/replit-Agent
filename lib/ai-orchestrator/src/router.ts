/**
 * AI Router
 *
 * The central routing engine. Wires together:
 *   - TaskClassifier  — what kind of task is this?
 *   - ModelRegistry   — which model handles that task on this provider?
 *   - ai-provider registry — which AIProvider implementation to call?
 *
 * Routing priority (highest → lowest):
 *   1. Explicit user model override (requestedModel)
 *   2. Best catalog match for (taskType, providerSlug)
 *   3. Provider's configured default model (fallback)
 */

import { registry as aiProviderRegistry } from "@workspace/ai-provider";
import type { OrchestrationRequest, OrchestrationResult, RoutingDecision } from "./types.js";
import { taskClassifier } from "./task-classifier.js";
import { modelRegistry } from "./model-registry.js";

class AIRouter {
  /**
   * Route a message to the appropriate provider + model.
   *
   * @throws {Error} if the user's configured provider slug is not registered
   */
  route(request: OrchestrationRequest): OrchestrationResult {
    const { messages, userProviderConfig, requestedModel } = request;
    const providerSlug = userProviderConfig.slug;

    const provider = aiProviderRegistry.get(providerSlug);
    if (!provider) {
      throw new Error(
        `Provider "${providerSlug}" is not registered. Available providers: ${aiProviderRegistry.listSlugs().join(", ")}`
      );
    }

    // Always classify — even for overrides, the taskType is logged in metadata
    const classification = taskClassifier.classify(messages);

    // ── Priority 1: Explicit user override ──────────────────────────────────
    if (requestedModel) {
      const decision: RoutingDecision = {
        taskType: classification.taskType,
        classification,
        selectedModelId: requestedModel,
        selectedRegistryEntryId: "user-override",
        providerSlug,
        rationale: `User explicitly requested model "${requestedModel}". Task classified as "${classification.taskType}".`,
        fallback: false,
      };
      return {
        decision,
        provider,
        resolvedConfig: { ...userProviderConfig, defaultModel: requestedModel },
      };
    }

    // ── Priority 2: Catalog match for (taskType, providerSlug) ──────────────
    const entry = modelRegistry.findBestForTask(classification.taskType, providerSlug);

    if (entry) {
      const confidencePct = (classification.confidence * 100).toFixed(0);
      const decision: RoutingDecision = {
        taskType: classification.taskType,
        classification,
        selectedModelId: entry.modelId,
        selectedRegistryEntryId: entry.id,
        providerSlug,
        rationale:
          `Task classified as "${classification.taskType}" (confidence: ${confidencePct}%, signals: ${classification.signals.slice(0, 3).join(", ") || "none"}). ` +
          `Selected "${entry.name}" [priority ${entry.priority}].`,
        fallback: false,
      };
      return {
        decision,
        provider,
        resolvedConfig: { ...userProviderConfig, defaultModel: entry.modelId },
      };
    }

    // ── Priority 3: Fall back to provider's configured default ───────────────
    const fallbackModel =
      userProviderConfig.defaultModel ?? provider.defaultModel ?? "";
    const decision: RoutingDecision = {
      taskType: classification.taskType,
      classification,
      selectedModelId: fallbackModel,
      selectedRegistryEntryId: "provider-default",
      providerSlug,
      rationale:
        `No catalog entry for task "${classification.taskType}" on provider "${providerSlug}". ` +
        `Falling back to provider default model "${fallbackModel}".`,
      fallback: true,
    };
    return {
      decision,
      provider,
      resolvedConfig: userProviderConfig,
    };
  }
}

export const aiRouter = new AIRouter();
