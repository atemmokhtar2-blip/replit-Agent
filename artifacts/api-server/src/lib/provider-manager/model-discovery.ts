/**
 * Model Discovery Service
 *
 * Fetches models from provider APIs, classifies and ranks them,
 * then persists the results in aiDiscoveredModelsTable.
 *
 * OpenRouter is the primary source as it aggregates hundreds of models
 * with full pricing + capability metadata.
 */

import { db } from "@workspace/db";
import { aiDiscoveredModelsTable, aiRequestLogTable } from "@workspace/db";
import type { InsertAiDiscoveredModel } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { DiscoveredModel, ModelCategory, ProviderAdapter } from "./types.js";

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── OpenRouter model listing ───────────────────────────────────────────────────

interface ORModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; tokenizer?: string };
  top_provider?: { context_length?: number; max_completion_tokens?: number };
  supported_parameters?: string[];
}

function classifyOpenRouterModel(m: ORModel): DiscoveredModel {
  const id          = m.id;
  const nameLower   = (m.name ?? id).toLowerCase();
  const idLower     = id.toLowerCase();

  // Pricing
  const inputPrice  = m.pricing?.prompt      ? parseFloat(m.pricing.prompt)      * 1_000_000 : undefined;
  const outputPrice = m.pricing?.completion  ? parseFloat(m.pricing.completion)  * 1_000_000 : undefined;
  const isFree      = id.endsWith(":free") || (inputPrice === 0 && outputPrice === 0) || id.includes(":free");

  // Context
  const contextLength = m.context_length ?? m.top_provider?.context_length;

  // Capabilities
  const isMultimodal    = m.architecture?.modality === "multimodal" || m.architecture?.modality?.includes("image") === true;
  const supportsVision  = isMultimodal;
  const supportsTools   = m.supported_parameters?.includes("tools") ?? false;
  const supportsStream  = m.supported_parameters?.includes("stream") !== false;

  // Category tags
  const isReasoning = /\b(think|reason|r1|r2|qwq|o1|o3|deepthink)\b/.test(nameLower) ||
                       /\b(think|reason|r1|r2|qwq|o1|o3|deepthink)\b/.test(idLower);
  const isCoding    = /\b(coder|code|codestral|kimi|devstral)\b/.test(nameLower) ||
                       /\b(coder|code|codestral|kimi|devstral)\b/.test(idLower);
  const isFast      = /\b(flash|haiku|mini|nano|instant|turbo|fast|lite|small|8b|7b|3b|2b|1b)\b/.test(nameLower);
  const isLongCtx   = contextLength != null && contextLength >= 128_000;

  const categories: ModelCategory[] = [];
  if (isFree)      categories.push("free");
  else             categories.push("paid");
  if (isReasoning) categories.push("reasoning");
  if (isCoding)    categories.push("coding");
  if (isFast)      categories.push("fast");
  if (supportsVision) categories.push("vision");
  if (isLongCtx)   categories.push("long-context");
  if (isMultimodal) categories.push("multimodal");
  if (categories.length === (isFree ? 1 : 1)) categories.push("general");  // only free/paid tag

  // Ranking score (0-100)
  let score = 40;
  if (isFree)       score += 30;
  if (isReasoning)  score += 20;
  if (isCoding)     score += 15;
  if (supportsVision) score += 5;
  if (supportsTools)  score += 5;
  if (isLongCtx)    score += 5;
  if (isFast)       score -= 5;     // slightly deprioritise tiny models
  score = Math.min(100, Math.max(0, score));

  return {
    modelId:                 id,
    displayName:             m.name ?? id,
    description:             m.description,
    contextLength,
    maxOutputTokens:         m.top_provider?.max_completion_tokens,
    inputPricePer1M:         inputPrice,
    outputPricePer1M:        outputPrice,
    isFree,
    supportsVision,
    supportsTools,
    supportsFunctionCalling: supportsTools,
    supportsReasoning:       isReasoning,
    supportsThinking:        isReasoning,
    supportsStreaming:        supportsStream,
    categories,
    rankScore:               score,
    rawMetadata:             m as unknown as Record<string, unknown>,
  };
}

async function fetchOpenRouterModels(apiKey: string): Promise<DiscoveredModel[]> {
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://replit.com",
        "X-Title":      "AI Agent Platform",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!resp.ok) {
      console.warn(`[ModelDiscovery] OpenRouter models fetch failed: HTTP ${resp.status}`);
      return [];
    }
    const data = await resp.json() as { data?: ORModel[] };
    return (data.data ?? []).map(classifyOpenRouterModel);
  } catch (err) {
    console.warn("[ModelDiscovery] OpenRouter fetch error:", (err as Error).message);
    return [];
  }
}

// ── Groq model listing ─────────────────────────────────────────────────────────

async function fetchGroqModels(apiKey: string): Promise<DiscoveredModel[]> {
  try {
    const resp = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return [];
    const data = await resp.json() as { data?: Array<{ id: string; owned_by?: string; context_window?: number }> };
    return (data.data ?? []).map(m => {
      const id = m.id;
      const isFast = /\b(8b|7b|instant|fast)\b/.test(id);
      const cats: ModelCategory[] = ["general", "free"];
      if (isFast) cats.push("fast");
      return {
        modelId:                 id,
        displayName:             id,
        contextLength:           m.context_window,
        isFree:                  true,
        supportsVision:          id.includes("vision"),
        supportsTools:           true,
        supportsFunctionCalling: true,
        supportsReasoning:       false,
        supportsThinking:        false,
        supportsStreaming:        true,
        categories:              cats,
        rankScore:               isFast ? 55 : 65,
      };
    });
  } catch {
    return [];
  }
}

// ── Persist discovered models ─────────────────────────────────────────────────

async function persistModels(providerSlug: string, models: DiscoveredModel[]): Promise<number> {
  if (models.length === 0) return 0;

  const rows: InsertAiDiscoveredModel[] = models.map(m => ({
    id:                      `${providerSlug}:${m.modelId}`,
    providerSlug,
    modelId:                 m.modelId,
    displayName:             m.displayName,
    description:             m.description,
    contextLength:           m.contextLength,
    maxOutputTokens:         m.maxOutputTokens,
    inputPricePer1M:         m.inputPricePer1M,
    outputPricePer1M:        m.outputPricePer1M,
    isFree:                  m.isFree,
    supportsVision:          m.supportsVision,
    supportsTools:           m.supportsTools,
    supportsFunctionCalling: m.supportsFunctionCalling,
    supportsReasoning:       m.supportsReasoning,
    supportsThinking:        m.supportsThinking,
    supportsStreaming:        m.supportsStreaming,
    categories:              m.categories,
    rankScore:               m.rankScore,
    priority:                50,
    enabled:                 true,
    rawMetadata:             m.rawMetadata,
    lastDiscoveredAt:        new Date(),
  }));

  // Batch upsert in chunks
  const CHUNK = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db.insert(aiDiscoveredModelsTable)
      .values(chunk)
      .onConflictDoUpdate({
        target: aiDiscoveredModelsTable.id,
        set: {
          displayName:             sql`excluded.display_name`,
          description:             sql`excluded.description`,
          contextLength:           sql`excluded.context_length`,
          maxOutputTokens:         sql`excluded.max_output_tokens`,
          inputPricePer1M:         sql`excluded.input_price_per1_m`,
          outputPricePer1M:        sql`excluded.output_price_per1_m`,
          isFree:                  sql`excluded.is_free`,
          supportsVision:          sql`excluded.supports_vision`,
          supportsTools:           sql`excluded.supports_tools`,
          supportsFunctionCalling: sql`excluded.supports_function_calling`,
          supportsReasoning:       sql`excluded.supports_reasoning`,
          supportsThinking:        sql`excluded.supports_thinking`,
          supportsStreaming:       sql`excluded.supports_streaming`,
          categories:              sql`excluded.categories`,
          rankScore:               sql`excluded.rank_score`,
          rawMetadata:             sql`excluded.raw_metadata`,
          lastDiscoveredAt:        new Date(),
          updatedAt:               new Date(),
        },
      })
      .catch(err => console.warn("[ModelDiscovery] Upsert error:", (err as Error).message));
    upserted += chunk.length;
  }
  return upserted;
}

// ── ModelDiscoveryService ─────────────────────────────────────────────────────

export class ModelDiscoveryService {
  private timer: NodeJS.Timeout | null = null;
  private adapters: ProviderAdapter[]  = [];
  private getApiKey: (slug: string) => string | undefined;
  private lastRun: Date | null = null;
  private running = false;

  constructor(
    adapters: ProviderAdapter[],
    getApiKey: (slug: string) => string | undefined,
  ) {
    this.adapters   = adapters;
    this.getApiKey  = getApiKey;
  }

  start(): void {
    if (this.timer) return;
    // Run once shortly after startup, then on interval
    setTimeout(() => { void this.discoverAll(); }, 5_000);
    this.timer = setInterval(() => { void this.discoverAll(); }, REFRESH_INTERVAL_MS);
    console.log("[ModelDiscovery] Started");
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async discoverAll(): Promise<{ providerSlug: string; count: number }[]> {
    if (this.running) return [];
    this.running = true;
    const results: { providerSlug: string; count: number }[] = [];

    try {
      // OpenRouter has the most comprehensive catalogue — do it always if key available
      const orKey = this.getApiKey("openrouter");
      if (orKey) {
        const models = await fetchOpenRouterModels(orKey);
        const count  = await persistModels("openrouter", models);
        results.push({ providerSlug: "openrouter", count });
        console.log(`[ModelDiscovery] openrouter: ${count} models upserted`);
      }

      // Groq — free models
      const groqKey = this.getApiKey("groq");
      if (groqKey) {
        const models = await fetchGroqModels(groqKey);
        const count  = await persistModels("groq", models);
        results.push({ providerSlug: "groq", count });
        console.log(`[ModelDiscovery] groq: ${count} models upserted`);
      }

      // Other adapters that implement listModels
      for (const adapter of this.adapters) {
        if (adapter.slug === "openrouter" || adapter.slug === "groq") continue;
        if (!adapter.listModels) continue;
        const key = this.getApiKey(adapter.slug);
        if (!key) continue;
        try {
          const models = await adapter.listModels(key);
          const count  = await persistModels(adapter.slug, models);
          results.push({ providerSlug: adapter.slug, count });
          console.log(`[ModelDiscovery] ${adapter.slug}: ${count} models upserted`);
        } catch (err) {
          console.warn(`[ModelDiscovery] ${adapter.slug} listModels error:`, (err as Error).message);
        }
      }

      this.lastRun = new Date();
    } finally {
      this.running = false;
    }

    return results;
  }

  async getModels(opts: {
    providerSlug?: string;
    onlyFree?: boolean;
    onlyEnabled?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ models: typeof aiDiscoveredModelsTable.$inferSelect[]; total: number }> {
    const { providerSlug, onlyFree, onlyEnabled = true, limit = 100, offset = 0 } = opts;

    const base = db.select().from(aiDiscoveredModelsTable);
    const rows = await base;

    let filtered = rows;
    if (providerSlug) filtered = filtered.filter(m => m.providerSlug === providerSlug);
    if (onlyFree)     filtered = filtered.filter(m => m.isFree);
    if (onlyEnabled)  filtered = filtered.filter(m => m.enabled);
    if (opts.category) filtered = filtered.filter(m => (m.categories as string[] | null)?.includes(opts.category!));

    // Sort by rankScore desc, then by modelId asc
    filtered.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0) || a.modelId.localeCompare(b.modelId));

    const total = filtered.length;
    const page  = filtered.slice(offset, offset + limit);
    return { models: page, total };
  }

  async getBestModelForTask(taskType: string, preferFree = false): Promise<typeof aiDiscoveredModelsTable.$inferSelect | null> {
    const all = await db.select().from(aiDiscoveredModelsTable)
      .where(eq(aiDiscoveredModelsTable.enabled, true));

    let candidates = all;
    if (preferFree) candidates = candidates.filter(m => m.isFree);

    if (taskType === "code-gen" || taskType === "debugging") {
      const coders = candidates.filter(m => (m.categories as string[] | null)?.includes("coding"));
      if (coders.length > 0) candidates = coders;
    }
    if (taskType === "planning" || taskType === "review") {
      const reasoners = candidates.filter(m => (m.categories as string[] | null)?.includes("reasoning"));
      if (reasoners.length > 0) candidates = reasoners;
    }

    candidates.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
    return candidates[0] ?? null;
  }

  getLastRunTime(): Date | null { return this.lastRun; }
  isRunning(): boolean { return this.running; }
}
