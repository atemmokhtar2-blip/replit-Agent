/**
 * @workspace/ai-provider
 *
 * Provider-agnostic AI abstraction layer.
 * Supports: OpenRouter, DeepSeek, Qwen, Local (Ollama), Custom
 *
 * Usage:
 *   import { registry } from "@workspace/ai-provider";
 *   const provider = registry.get("openrouter");
 *   const response = await provider.chat({ messages }, config);
 */

export * from "./types.js";
export { registry } from "./registry.js";

export { openrouterProvider } from "./providers/openrouter.js";
export { deepseekProvider } from "./providers/deepseek.js";
export { localProvider } from "./providers/local.js";
export { customProvider } from "./providers/custom.js";

import { registry } from "./registry.js";
import { openrouterProvider } from "./providers/openrouter.js";
import { deepseekProvider } from "./providers/deepseek.js";
import { localProvider } from "./providers/local.js";
import { customProvider } from "./providers/custom.js";

registry.register(openrouterProvider);
registry.register(deepseekProvider);
registry.register(localProvider);
registry.register(customProvider);
