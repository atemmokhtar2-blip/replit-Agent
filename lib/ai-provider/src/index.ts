/**
 * @workspace/ai-provider
 *
 * Provider-agnostic AI abstraction layer.
 * Supports: OpenRouter, OpenAI, Anthropic, Google AI, HuggingFace, DeepSeek, Local (Ollama), Custom
 *
 * Adding a new provider:
 *   1. Create src/providers/<name>.ts implementing AIProvider
 *   2. Export + register it below — no other files need to change
 */

export * from "./types.js";
export { registry } from "./registry.js";

export { openrouterProvider } from "./providers/openrouter.js";
export { deepseekProvider } from "./providers/deepseek.js";
export { localProvider } from "./providers/local.js";
export { customProvider } from "./providers/custom.js";
export { openaiProvider } from "./providers/openai.js";
export { anthropicProvider } from "./providers/anthropic.js";
export { googleAIProvider } from "./providers/google.js";
export { huggingfaceProvider } from "./providers/huggingface.js";

import { registry } from "./registry.js";
import { openrouterProvider } from "./providers/openrouter.js";
import { deepseekProvider } from "./providers/deepseek.js";
import { localProvider } from "./providers/local.js";
import { customProvider } from "./providers/custom.js";
import { openaiProvider } from "./providers/openai.js";
import { anthropicProvider } from "./providers/anthropic.js";
import { googleAIProvider } from "./providers/google.js";
import { huggingfaceProvider } from "./providers/huggingface.js";

registry.register(openrouterProvider);
registry.register(deepseekProvider);
registry.register(localProvider);
registry.register(customProvider);
registry.register(openaiProvider);
registry.register(anthropicProvider);
registry.register(googleAIProvider);
registry.register(huggingfaceProvider);
