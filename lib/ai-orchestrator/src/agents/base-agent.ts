/**
 * Base Agent
 *
 * Abstract base class for all specialized AI agents.
 * Each agent:
 *   - Has a unique agentType and name
 *   - Declares its supported task types and preferred models
 *   - Implements execute() which runs the agent's logic via the fallback engine
 */

import type { AgentType, AgentRequest, AgentResult, TaskType } from "../types.js";
import type { ModelRegistryEntry } from "../types.js";
import { callWithFallback } from "../fallback-engine.js";

export abstract class BaseAgent {
  abstract readonly agentType: AgentType;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly supportedTaskTypes: TaskType[];
  /** Registry entry IDs in priority order for this agent's tasks */
  abstract readonly preferredModelIds: string[];
  abstract readonly systemPrompt: string;

  async execute(request: AgentRequest): Promise<AgentResult> {
    const start = Date.now();
    return callWithFallback({
      agentType: this.agentType,
      systemPrompt: this.systemPrompt,
      preferredModelIds: this.preferredModelIds,
      request,
      start,
    });
  }

  /** Whether this agent can handle the given task type */
  canHandle(taskType: TaskType): boolean {
    return this.supportedTaskTypes.includes(taskType);
  }

  /** Select the best model entry for this agent based on available registry entries */
  selectModels(allEntries: ModelRegistryEntry[]): ModelRegistryEntry[] {
    const byId = new Map(allEntries.map((e) => [e.id, e]));
    const ordered: ModelRegistryEntry[] = [];
    for (const id of this.preferredModelIds) {
      const entry = byId.get(id);
      if (entry?.enabled) ordered.push(entry);
    }
    // Append any remaining enabled entries not in the preferred list (as fallbacks)
    for (const entry of allEntries) {
      if (entry.enabled && !this.preferredModelIds.includes(entry.id) &&
          entry.taskAffinity.some((t) => this.supportedTaskTypes.includes(t))) {
        ordered.push(entry);
      }
    }
    return ordered;
  }
}
