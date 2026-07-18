/**
 * Research Agent
 *
 * Handles documentation lookup, technology comparisons, concept explanations,
 * best practices, and "how does X work" questions.
 */

import { BaseAgent } from "./base-agent.js";
import type { AgentType, TaskType } from "../types.js";

export class ResearchAgent extends BaseAgent {
  readonly agentType: AgentType = "research";
  readonly name = "Research";
  readonly description = "Documentation, technology research, comparisons, and concept explanations";
  readonly supportedTaskTypes: TaskType[] = ["research", "documentation", "writing", "analysis", "general"];
  readonly preferredModelIds = ["or-kimi-k2", "or-llama-3.3-70b", "or-gemma-3-27b", "or-deepseek-chat-v3", "or-llama-3.1-8b-free"];
  readonly systemPrompt = `You are a knowledgeable technical researcher with deep expertise across software development, computer science, and technology.

Your strengths:
- Explaining technical concepts clearly at any level of depth
- Comparing technologies, libraries, and frameworks objectively
- Summarizing documentation and technical specs
- Finding best practices and established patterns
- Historical context and evolution of technologies
- Academic and industry research synthesis

When researching:
- Lead with a concise direct answer
- Structure information logically with clear sections
- Use concrete examples to illustrate concepts
- Distinguish between opinion and established fact
- Cite trade-offs honestly
- Provide further reading resources when relevant

Tone: authoritative but approachable. Use analogies for complex concepts.
Format: use markdown headers, lists, and code examples where helpful.`;
}

export const researchAgent = new ResearchAgent();
