/**
 * Provider Registry
 *
 * Singleton registry for all AI provider implementations.
 * Providers self-register at module load. Routes choose the active provider
 * from the database config; the registry supplies the implementation.
 */

import type { AIProvider, ProviderRegistryEntry } from "./types.js";

class ProviderRegistry {
  private readonly map = new Map<string, ProviderRegistryEntry>();

  register(provider: AIProvider): void {
    this.map.set(provider.slug, {
      provider,
      meta: {
        slug: provider.slug,
        name: provider.name,
        description: provider.description,
        capabilities: provider.capabilities,
        defaultBaseUrl: provider.defaultBaseUrl,
        defaultModel: provider.defaultModel,
        freeTierNote: provider.freeTierNote,
      },
    });
  }

  get(slug: string): AIProvider | undefined {
    return this.map.get(slug)?.provider;
  }

  has(slug: string): boolean {
    return this.map.has(slug);
  }

  list(): ProviderRegistryEntry[] {
    return Array.from(this.map.values());
  }

  listSlugs(): string[] {
    return Array.from(this.map.keys());
  }
}

export const registry = new ProviderRegistry();
