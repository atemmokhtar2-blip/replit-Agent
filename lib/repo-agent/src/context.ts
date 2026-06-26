/**
 * Project Context Generator
 *
 * Produces a rich, structured ProjectContext from a ProjectAnalysis.
 * This context is what every AI agent reads before making any edits.
 */

import type { ProjectAnalysis, ProjectContext, FileRelationship, LibraryInfo, CommitSummary } from "./types.js";
import type { LogEntry } from "@workspace/github";

/**
 * Generate a full ProjectContext from analysis + git log.
 */
export function generateProjectContext(
  analysis: ProjectAnalysis,
  recentCommits: LogEntry[] = []
): ProjectContext {
  return {
    analysis,
    architecture: describeArchitecture(analysis),
    fileRelationships: [],
    installedLibraries: buildLibraryList(analysis),
    buildStatus: "unknown",
    recentCommits: recentCommits.map((c) => ({
      hash: c.hash.slice(0, 8),
      message: c.message,
      author: c.author_name,
      date: c.date,
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate a human-readable architecture description for AI prompt injection.
 */
export function buildContextPrompt(context: ProjectContext): string {
  const { analysis } = context;
  const lines: string[] = [
    "# Project Context",
    "",
    `**Framework:** ${analysis.framework}`,
    `**Language:** ${analysis.language}`,
    `**Package Manager:** ${analysis.packageManager}`,
    `**Build System:** ${analysis.buildSystem}`,
    `**TypeScript:** ${analysis.hasTypeScript ? "Yes" : "No"}`,
    `**Monorepo:** ${analysis.isMonorepo ? "Yes" : "No"}`,
    `**Database:** ${analysis.hasDatabase ? "Yes" : "No"}`,
    `**Docker:** ${analysis.hasDocker ? "Yes" : "No"}`,
    `**CI/CD:** ${analysis.hasCI ? "Yes" : "No"}`,
    "",
    "## Architecture",
    context.architecture,
    "",
  ];

  if (analysis.scripts && Object.keys(analysis.scripts).length > 0) {
    lines.push("## Available Scripts");
    for (const [name, cmd] of Object.entries(analysis.scripts)) {
      lines.push(`- \`${name}\`: ${cmd}`);
    }
    lines.push("");
  }

  if (analysis.components.length > 0) {
    lines.push("## Key Components");
    lines.push(analysis.components.slice(0, 20).join("\n"));
    lines.push("");
  }

  if (analysis.routes.length > 0) {
    lines.push("## Routes");
    lines.push(analysis.routes.slice(0, 20).join("\n"));
    lines.push("");
  }

  if (context.recentCommits.length > 0) {
    lines.push("## Recent Commits");
    for (const c of context.recentCommits.slice(0, 5)) {
      lines.push(`- ${c.hash} — ${c.message} (${c.author})`);
    }
    lines.push("");
  }

  if (analysis.readmeSummary) {
    lines.push("## Project Description");
    lines.push(analysis.readmeSummary);
  }

  return lines.join("\n");
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

function describeArchitecture(analysis: ProjectAnalysis): string {
  const parts: string[] = [];

  if (analysis.isMonorepo) parts.push("This is a monorepo project.");

  switch (analysis.framework) {
    case "next": parts.push("Built with Next.js (React-based full-stack framework with file-based routing)."); break;
    case "react": parts.push("Frontend built with React. Likely has a separate API server."); break;
    case "vue": parts.push("Frontend built with Vue.js."); break;
    case "nuxt": parts.push("Built with Nuxt.js (Vue-based full-stack framework)."); break;
    case "svelte": parts.push("Built with Svelte/SvelteKit."); break;
    case "angular": parts.push("Frontend built with Angular."); break;
    case "express": parts.push("Backend API built with Express.js."); break;
    case "nestjs": parts.push("Backend built with NestJS (TypeScript-first Node.js framework)."); break;
    case "fastify": parts.push("Backend built with Fastify (high-performance Node.js server)."); break;
    case "hono": parts.push("Backend built with Hono (edge-native web framework)."); break;
    case "django": parts.push("Backend built with Django (Python web framework)."); break;
    case "flask": parts.push("Backend built with Flask (Python microframework)."); break;
    case "fastapi": parts.push("Backend built with FastAPI (Python async framework)."); break;
    case "rails": parts.push("Built with Ruby on Rails."); break;
    case "laravel": parts.push("Built with Laravel (PHP framework)."); break;
  }

  switch (analysis.buildSystem) {
    case "vite": parts.push("Uses Vite for fast development and optimized builds."); break;
    case "next": break;
    case "webpack": parts.push("Uses Webpack as the module bundler."); break;
    case "esbuild": parts.push("Uses esbuild for fast compilation."); break;
    case "tsc": parts.push("Uses TypeScript compiler (tsc) directly."); break;
  }

  if (analysis.hasDatabase) parts.push("Connects to a database.");
  if (analysis.hasDocker) parts.push("Docker configuration present.");
  if (analysis.deploymentConfig) {
    parts.push(`Deployment configured for ${analysis.deploymentConfig.platform}.`);
  }

  return parts.join(" ") || "General-purpose project.";
}

function buildLibraryList(analysis: ProjectAnalysis): LibraryInfo[] {
  const KNOWN: Record<string, { purpose: string; category: string }> = {
    "react": { purpose: "UI library", category: "frontend" },
    "next": { purpose: "React framework", category: "frontend" },
    "vue": { purpose: "Progressive UI framework", category: "frontend" },
    "express": { purpose: "Web server framework", category: "backend" },
    "fastify": { purpose: "Fast web server", category: "backend" },
    "drizzle-orm": { purpose: "TypeScript ORM", category: "database" },
    "prisma": { purpose: "ORM with migrations", category: "database" },
    "pg": { purpose: "PostgreSQL client", category: "database" },
    "mongoose": { purpose: "MongoDB ODM", category: "database" },
    "stripe": { purpose: "Payment processing", category: "payment" },
    "zod": { purpose: "Schema validation", category: "validation" },
    "tailwindcss": { purpose: "Utility-first CSS", category: "styling" },
    "framer-motion": { purpose: "Animation library", category: "animation" },
    "@tanstack/react-query": { purpose: "Data fetching and caching", category: "data" },
    "openai": { purpose: "OpenAI API client", category: "ai" },
    "@anthropic-ai/sdk": { purpose: "Anthropic Claude client", category: "ai" },
  };

  const results: LibraryInfo[] = [];
  const allDeps = { ...analysis.dependencies, ...analysis.devDependencies };

  for (const [name, version] of Object.entries(allDeps)) {
    const known = KNOWN[name];
    if (known) {
      results.push({ name, version, ...known });
    }
  }

  return results;
}
