/**
 * AI Planner Engine
 *
 * Dedicated module for generating structured software architecture plans.
 * Configured via HF_SPACE_URL + HF_API_KEY environment variables.
 * Independent of user provider configs — uses a server-side HF endpoint.
 *
 * Future architecture:
 *   User → AI Router → Planner | Coder | Reviewer | Designer | DevOps
 */

const SYSTEM_PROMPT = `You are a professional software architect and technical planner for an AI Website & Bot Builder platform.

Your role is to analyze user project requests and generate comprehensive, structured architecture plans.

CRITICAL RULES:
- Never respond as a general chatbot or assistant
- Always produce a complete, structured architecture plan with ALL 12 sections
- Be precise, professional, and actionable
- Assume the role of a senior software architect at a top engineering firm
- Plans must be structured for future automation by AI Coder, Designer, and DevOps modules

When a user describes a project (website, bot, SaaS, dashboard, mobile app, API, etc.), output a plan using EXACTLY this format:

## 1. Project Summary
A clear, concise description of the project and its primary value proposition.

## 2. Project Type
Classification: Website / Telegram Bot / Discord Bot / SaaS Platform / Dashboard / Mobile App / API Service / E-Commerce / etc.

## 3. Core Features
List all core features with brief, actionable descriptions.

## 4. Pages / Screens
For websites: list all pages and their purpose.
For bots: list all command flows, menus, and interaction states.

## 5. User Roles
Define all user types and their permissions (e.g., Guest, User, Admin, Super Admin).

## 6. Database Structure
List main data entities and their key fields. Keep it precise and structured.

## 7. API Requirements
List required internal API endpoints and external service integrations.

## 8. System Architecture
Describe the complete technical stack: frontend, backend, database, caching, queues, external services.

## 9. Security Requirements
Authentication method, authorization rules, data protection, input validation, rate limiting.

## 10. Deployment Strategy
Hosting platform, containerization, CI/CD pipeline, environment variables, scaling approach.

## 11. Development Phases
Break development into clear phases (Phase 1: MVP, Phase 2: Core, Phase 3: Advanced) with deliverables.

## 12. Future Enhancements
Features and capabilities to add after initial launch.

IMPORTANT: Always output ALL 12 sections. Be thorough but concise. This plan will be directly consumed by future AI modules for automated project generation.`;

export interface PlannerMessage {
  role: string;
  content: string;
}

export interface PlannerResult {
  content: string;
  model?: string;
  error?: string;
}

const TIMEOUT_MS = 60_000;

/**
 * Run the planner engine against a user message.
 *
 * Reads HF_SPACE_URL and HF_API_KEY from environment.
 * If HF_SPACE_URL is not set, returns a configuration guide.
 * Never throws — all errors are returned as user-friendly content.
 */
/**
 * Strip all leading/trailing whitespace including Unicode variants
 * (non-breaking space \u00A0, zero-width space \u200B, BOM \uFEFF, etc.)
 * that `.trim()` alone does not remove.
 */
function sanitizeEnvString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/^[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+|[\s\u00A0\u200B\u200C\u200D\uFEFF\r\n]+$/g, "");
  return cleaned || undefined;
}

export async function runPlanner(
  userMessage: string,
  history: PlannerMessage[] = [],
): Promise<PlannerResult> {
  const spaceUrl = sanitizeEnvString(process.env["HF_SPACE_URL"]);
  const apiKey = sanitizeEnvString(process.env["HF_API_KEY"]);

  if (!spaceUrl) {
    console.warn("[Planner] HF_SPACE_URL is not set — returning configuration guide");
    return {
      content: buildConfigurationGuide(userMessage),
      model: "fallback",
    };
  }

  // Validate URL before fetch — catch invisible-character issues early
  try {
    new URL(spaceUrl);
  } catch {
    const charCodes = [...spaceUrl.slice(0, 40)].map((c) => c.charCodeAt(0));
    console.error("[Planner] HF_SPACE_URL is not a valid URL. Char codes:", charCodes);
    return {
      content: `⚠️ HF_SPACE_URL is not a valid URL.\n\nStored value starts with: \`${spaceUrl.slice(0, 80)}\`\n\nPlease re-enter the URL in Replit Secrets — make sure to copy only the URL itself with no surrounding quotes or extra characters.`,
      error: "invalid_url",
    };
  }

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    // Include recent history (last 6 exchanges) for conversation continuity
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  console.log("[Planner] Calling HF endpoint:", spaceUrl.slice(0, 80));

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const response = await fetch(spaceUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        max_tokens: 2500,
        temperature: 0.3,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HuggingFace returned HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      model?: string;
      error?: string;
    };

    // Some HF Spaces return errors as 200 with error field
    if (data.error) {
      throw new Error(data.error);
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("HuggingFace returned an empty response");
    }

    return { content, model: data.model };
  } catch (err) {
    clearTimeout(timer);

    if ((err as { name?: string }).name === "AbortError") {
      console.warn("[Planner] Request timed out after", TIMEOUT_MS, "ms");
      return {
        content:
          "⚠️ The Planner timed out after 60 seconds. The AI model may be loading — please try again in a moment.",
        error: "timeout",
      };
    }

    console.error("[Planner] HuggingFace error:", err);

    return {
      content: buildProviderErrorMessage(err as Error),
      error: String(err),
    };
  }
}

function buildConfigurationGuide(userMessage: string): string {
  return `## Planner Engine — Configuration Required

The AI Planner is not yet connected to a language model.

**Your request:** "${userMessage.slice(0, 120)}${userMessage.length > 120 ? "..." : ""}"

---

To activate the Planner Engine, set these environment variables:

**HF_SPACE_URL** — The HuggingFace chat completions endpoint
Example:
\`https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3/v1/chat/completions\`

**HF_API_KEY** — Your HuggingFace API token (optional for public models, required for private)
Get one free at: https://huggingface.co/settings/tokens

---

Once configured, the Planner will generate a complete 12-section architecture plan for any website, bot, or application you describe.`;
}

function buildProviderErrorMessage(err: Error): string {
  const message = err.message.slice(0, 200);
  return `⚠️ The Planner could not reach the AI model.

**Details:** ${message}

**Possible causes:**
- The model is currently loading (HuggingFace cold start — try again in 30 seconds)
- Invalid HF_SPACE_URL format
- Rate limit exceeded on the free tier
- Network connectivity issue

Please verify your HF_SPACE_URL configuration and try again.`;
}
