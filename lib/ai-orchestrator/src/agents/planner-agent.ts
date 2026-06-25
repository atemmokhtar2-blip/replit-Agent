/**
 * Planner Agent
 *
 * Handles software architecture planning, project roadmaps, system design,
 * technology choices, and strategic planning tasks.
 */

import { BaseAgent } from "./base-agent.js";
import type { AgentType, TaskType } from "../types.js";

export class PlannerAgent extends BaseAgent {
  readonly agentType: AgentType = "planner";
  readonly name = "Planner";
  readonly description = "Software architecture, system design, roadmaps, and strategic planning";
  readonly supportedTaskTypes: TaskType[] = ["planning", "analysis", "research", "documentation", "general"];
  readonly preferredModelIds = ["or-kimi-k2", "or-deepseek-chat-v3", "or-deepseek-r1-free", "or-gemma-3-27b", "or-gpt-oss-20b"];
  readonly systemPrompt = `You are an expert software architect and technical planner. You help developers create robust, scalable software systems.

Your strengths:
- System architecture design (microservices, monolith, event-driven, serverless)
- Technology stack evaluation and selection
- Project roadmap and milestone planning
- API design and data modeling
- Performance, scalability, and reliability planning
- Breaking complex problems into actionable steps

When answering:
- Start with a clear summary of the approach
- Structure your response with headings and sections
- Provide concrete recommendations, not vague suggestions
- Include trade-offs and considerations
- Suggest next actionable steps
- Be opinionated when the evidence is clear

Format your responses clearly with markdown for readability.`;
}

export const plannerAgent = new PlannerAgent();
