/**
 * Agent Registry
 *
 * Central registry of all specialized AI agents.
 * Provides agent lookup by type, task type, and name.
 *
 * Adding a new agent:
 *   1. Create the agent class in src/agents/<name>-agent.ts
 *   2. Import and register it in AGENTS_LIST below
 *   No other files need to change.
 */

import type { AgentType, TaskType } from "./types.js";
import type { BaseAgent } from "./agents/base-agent.js";
import { plannerAgent } from "./agents/planner-agent.js";
import { builderAgent } from "./agents/builder-agent.js";
import { researchAgent } from "./agents/research-agent.js";
import { debugAgent } from "./agents/debug-agent.js";
import { deploymentAgent } from "./agents/deployment-agent.js";
import { databaseAgent } from "./agents/database-agent.js";
import { securityAgent } from "./agents/security-agent.js";

const AGENTS_LIST: BaseAgent[] = [
  plannerAgent,
  builderAgent,
  researchAgent,
  debugAgent,
  deploymentAgent,
  databaseAgent,
  securityAgent,
];

class AgentRegistry {
  private agents: Map<AgentType, BaseAgent>;

  constructor(agents: BaseAgent[]) {
    this.agents = new Map(agents.map((a) => [a.agentType, a]));
  }

  /** Get an agent by its type. Returns undefined if not registered. */
  get(agentType: AgentType): BaseAgent | undefined {
    return this.agents.get(agentType);
  }

  /** Find the best agent for a given task type.
   * Priority: exact supportedTaskTypes match, with higher preference for agents
   * whose PRIMARY task type matches (i.e., first element of supportedTaskTypes). */
  findForTask(taskType: TaskType): BaseAgent {
    // Priority 1: primary task type match (first in supportedTaskTypes)
    for (const agent of this.agents.values()) {
      if (agent.supportedTaskTypes[0] === taskType) return agent;
    }

    // Priority 2: any task type match
    for (const agent of this.agents.values()) {
      if (agent.canHandle(taskType)) return agent;
    }

    // Fallback: planner handles general/unclassified requests
    return plannerAgent;
  }

  /** Select agent type based on task type (explicit mapping) */
  selectAgentType(taskType: TaskType): AgentType {
    const TASK_TO_AGENT: Record<string, AgentType> = {
      coding: "builder",
      ui_design: "builder",
      debugging: "debug",
      planning: "planner",
      analysis: "planner",
      research: "research",
      documentation: "research",
      writing: "research",
      deployment: "deployment",
      database: "database",
      security: "security",
      general: "planner",
    };
    return TASK_TO_AGENT[taskType] ?? "planner";
  }

  /** List all registered agents */
  listAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  /** Register a new agent at runtime */
  register(agent: BaseAgent): void {
    this.agents.set(agent.agentType, agent);
  }

  /** Summary of all agents for the API */
  toSummary() {
    return this.listAll().map((a) => ({
      agentType: a.agentType,
      name: a.name,
      description: a.description,
      supportedTaskTypes: a.supportedTaskTypes,
      preferredModelIds: a.preferredModelIds,
    }));
  }
}

export const agentRegistry = new AgentRegistry(AGENTS_LIST);
