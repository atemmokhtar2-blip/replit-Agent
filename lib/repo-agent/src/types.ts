/**
 * Shared types for the Repository Agent.
 */

export type Framework =
  | "react" | "next" | "vue" | "nuxt" | "svelte" | "angular"
  | "express" | "fastify" | "nestjs" | "hono" | "koa"
  | "django" | "flask" | "fastapi" | "rails" | "laravel"
  | "static" | "unknown";

export type Language =
  | "typescript" | "javascript" | "python" | "ruby" | "php"
  | "go" | "rust" | "java" | "csharp" | "unknown";

export type PackageManager =
  | "npm" | "yarn" | "pnpm" | "bun"
  | "pip" | "poetry" | "pipenv"
  | "cargo" | "go" | "unknown";

export type BuildSystem =
  | "vite" | "webpack" | "parcel" | "esbuild" | "turbopack" | "rollup"
  | "tsc" | "babel" | "swc" | "next" | "nuxt"
  | "cargo" | "go" | "gradle" | "maven"
  | "unknown";

export interface DetectedEnvVar {
  key: string;
  description: string;
  category: SecretCategory;
  isRequired: boolean;
  exampleValue: string;
  source: string; // which file it was found in
}

export type SecretCategory =
  | "github" | "ai" | "database" | "storage" | "payment"
  | "email" | "messaging" | "deployment" | "monitoring" | "other";

export interface FolderNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FolderNode[];
  size?: number;
}

export interface ProjectAnalysis {
  framework: Framework;
  language: Language;
  packageManager: PackageManager;
  buildSystem: BuildSystem;
  hasDatabase: boolean;
  hasDocker: boolean;
  hasCI: boolean;
  hasTests: boolean;
  hasTypeScript: boolean;
  isMonorepo: boolean;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  detectedEnvVars: DetectedEnvVar[];
  folderTree: FolderNode;
  routes: string[];
  components: string[];
  apis: string[];
  deploymentConfig: DeploymentConfig | null;
  readmeSummary: string | null;
}

export interface DeploymentConfig {
  platform: string; // vercel | netlify | railway | fly | heroku | aws | unknown
  configFile: string;
  buildCommand: string | null;
  outputDir: string | null;
  envVarsRequired: string[];
}

export interface ProjectContext {
  analysis: ProjectAnalysis;
  architecture: string;
  fileRelationships: FileRelationship[];
  installedLibraries: LibraryInfo[];
  buildStatus: "unknown" | "passing" | "failing";
  recentCommits: CommitSummary[];
  generatedAt: string;
}

export interface FileRelationship {
  file: string;
  imports: string[];
  exportedSymbols: string[];
}

export interface LibraryInfo {
  name: string;
  version: string;
  purpose: string;
  category: string;
}

export interface CommitSummary {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface ValidationResult {
  passed: boolean;
  checks: ValidationCheck[];
  totalDuration: number;
}

export interface ValidationCheck {
  name: string;
  status: "passed" | "failed" | "skipped" | "running";
  command: string | null;
  output: string;
  duration: number;
  error: string | null;
}
