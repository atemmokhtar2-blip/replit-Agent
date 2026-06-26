/**
 * TaskDetailsDrawer
 *
 * Right-side drawer that shows full execution details for a task:
 * - Stage timeline
 * - Blueprint sections (if any)
 * - Parsed file list
 * - Preview button
 *
 * Opens when user clicks a TaskCard.
 */

import { useState, useEffect } from "react";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { ExecutionStatusBadge } from "./ExecutionStatusBadge";
import type { ExecutionTask } from "@/lib/task-store";

// ── Blueprint section parsing ─────────────────────────────────────────────────

interface BlueprintSection {
  section: number;
  title: string;
  body: string;
}

function parseBlueprint(content: string): BlueprintSection[] {
  const sections: BlueprintSection[] = [];
  const lines = content.split("\n");
  let current: { section: number; title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const match = /^##\s+(\d+)\.\s+(.+)$/.exec(line);
    if (match) {
      if (current)
        sections.push({ section: current.section, title: current.title, body: current.lines.join("\n").trim() });
      current = { section: parseInt(match[1]!, 10), title: match[2]!.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current)
    sections.push({ section: current.section, title: current.title, body: current.lines.join("\n").trim() });
  return sections;
}

// ── File extraction from blueprint text ───────────────────────────────────────

interface ParsedFile {
  path: string;
  description: string;
}

const FILE_PATTERNS = [
  /`([a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})`/g,
  /\b(src\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(app\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(client\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(server\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(pages\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(components\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(lib\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(api\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(routes\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(models\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(utils\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(hooks\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(styles\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(config\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(db\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
  /\b(migrations\/[a-zA-Z0-9_/.-]+\.[a-zA-Z]{2,5})\b/g,
];

const SKIP_PATHS = new Set([
  "package.json", "tsconfig.json", "vite.config.ts", ".env", ".gitignore",
  "README.md", "index.html", "tailwind.config.ts"
]);

function extractFiles(content: string): ParsedFile[] {
  const found = new Map<string, string>();
  for (const pattern of FILE_PATTERNS) {
    const re = new RegExp(pattern.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const path = m[1]!.replace(/^`|`$/g, "");
      if (!SKIP_PATHS.has(path) && path.includes("/") && !found.has(path)) {
        // Get surrounding line for description
        const lineStart = content.lastIndexOf("\n", m.index) + 1;
        const lineEnd = content.indexOf("\n", m.index);
        const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
        const desc = line.replace(/`[^`]+`/g, "").replace(/^[-*#]+\s*/, "").trim().slice(0, 60);
        found.set(path, desc || "");
      }
    }
  }
  return Array.from(found.entries()).map(([path, description]) => ({ path, description }));
}

function fileIcon(path: string): string {
  const ext = path.split(".").pop() ?? "";
  const iconMap: Record<string, string> = {
    ts: "📄", tsx: "⚛️", js: "📄", jsx: "⚛️",
    css: "🎨", scss: "🎨", json: "📋", md: "📝",
    sql: "🗄️", prisma: "🗄️", py: "🐍", go: "🔵",
    rs: "🦀", env: "🔧", sh: "💻", yml: "⚙️", yaml: "⚙️",
  };
  return iconMap[ext] ?? "📄";
}

// ── Section card ───────────────────────────────────────────────────────────────

function DrawerSectionCard({ section }: { section: BlueprintSection }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`## ${section.section}. ${section.title}\n\n${section.body}`)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">
          {section.section}
        </span>
        <span className="flex-1 text-xs font-semibold text-foreground truncate">{section.title}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round"
          className={`flex-shrink-0 text-muted-foreground/50 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="3,1 7,5 3,9" />
        </svg>
      </button>
      {expanded && (
        <div className="border-t border-border/40 bg-muted/10">
          <div className="relative px-3 py-3">
            <button
              onClick={handleCopy}
              className="absolute right-2 top-2 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {copied ? <span className="text-green-400">Copied</span> : "Copy"}
            </button>
            <pre className="text-[11px] text-foreground/80 leading-relaxed whitespace-pre-wrap font-mono pr-12 max-h-64 overflow-y-auto">
              {section.body}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Drawer ────────────────────────────────────────────────────────────────

interface TaskDetailsDrawerProps {
  task: ExecutionTask | null;
  onClose: () => void;
}

export function TaskDetailsDrawer({ task, onClose }: TaskDetailsDrawerProps) {
  const [activeTab, setActiveTab] = useState<"timeline" | "blueprint" | "files">("timeline");
  const [previewOpen, setPreviewOpen] = useState(false);

  // Trap Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!task) return null;

  const sections = task.result ? parseBlueprint(task.result.content) : [];
  const files = task.result ? extractFiles(task.result.content) : [];
  const hasResult = !!task.result;

  function formatElapsed(start: string, end?: string): string {
    const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-background shadow-2xl animate-slide-in-right">

        {/* Header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3 bg-card/50">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <ExecutionStatusBadge status={task.status} />
              {task.result?.model && (
                <span className="text-[10px] text-muted-foreground/40">
                  via {task.result.model.split("/").pop()}
                </span>
              )}
            </div>
            <h2 className="text-sm font-semibold text-foreground truncate">{task.title}</h2>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              {formatElapsed(task.startedAt, task.completedAt)} elapsed
              {task.completedAt && task.status === "ready" && " · Complete"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="1" y1="1" x2="13" y2="13" />
              <line x1="13" y1="1" x2="1" y2="13" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-shrink-0 border-b border-border bg-card/30 px-4">
          {(["timeline", "blueprint", "files"] as const).map((tab) => {
            const labels = { timeline: "Timeline", blueprint: `Blueprint${sections.length > 0 ? ` (${sections.length})` : ""}`, files: `Files${files.length > 0 ? ` (${files.length})` : ""}` };
            const disabled = (tab === "blueprint" || tab === "files") && !hasResult;
            return (
              <button
                key={tab}
                onClick={() => !disabled && setActiveTab(tab)}
                disabled={disabled}
                className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
                  activeTab === tab
                    ? "text-foreground"
                    : disabled
                    ? "text-muted-foreground/30 cursor-default"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {labels[tab]}
                {activeTab === tab && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary rounded-t" />
                )}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">

          {/* Timeline tab */}
          {activeTab === "timeline" && (
            <div>
              <p className="mb-4 text-[11px] text-muted-foreground/60 leading-relaxed">
                {task.userPrompt.length > 120 ? task.userPrompt.slice(0, 120) + "…" : task.userPrompt}
              </p>
              <ExecutionTimeline stages={task.stages} />
              {task.error && (
                <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <p className="text-xs font-medium text-red-400 mb-1">Error</p>
                  <p className="text-xs text-foreground/70">{task.error}</p>
                </div>
              )}
            </div>
          )}

          {/* Blueprint tab */}
          {activeTab === "blueprint" && sections.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-muted-foreground/60">{sections.length} sections generated</p>
                <button
                  onClick={() => {
                    if (task.result) {
                      navigator.clipboard.writeText(task.result.content);
                    }
                  }}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Copy All
                </button>
              </div>
              {sections.map((s) => (
                <DrawerSectionCard key={s.section} section={s} />
              ))}
            </div>
          )}

          {/* Blueprint tab — no sections */}
          {activeTab === "blueprint" && hasResult && sections.length === 0 && (
            <div className="rounded-lg border border-border bg-card/50 p-4">
              <pre className="text-xs text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed max-h-[60vh] overflow-y-auto">
                {task.result?.content}
              </pre>
            </div>
          )}

          {/* Files tab */}
          {activeTab === "files" && (
            <div className="flex flex-col gap-1">
              {files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="text-2xl mb-2">🗂️</div>
                  <p className="text-xs text-muted-foreground">No specific files detected in blueprint</p>
                </div>
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground/50 mb-3">
                    {files.length} file{files.length !== 1 ? "s" : ""} referenced in the blueprint
                  </p>
                  {files.map((file) => (
                    <div
                      key={file.path}
                      className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/40 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                    >
                      <span className="text-base flex-shrink-0">{fileIcon(file.path)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-mono font-medium text-foreground truncate">{file.path}</p>
                        {file.description && (
                          <p className="text-[10px] text-muted-foreground/50 truncate mt-0.5">{file.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        {task.status === "ready" && task.result && (
          <div className="flex-shrink-0 border-t border-border bg-card/30 p-3 flex items-center gap-2">
            <button
              onClick={() => {
                if (task.result) {
                  navigator.clipboard.writeText(task.result.content);
                }
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="4" y="4" width="7" height="7" rx="1" />
                <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" />
              </svg>
              Copy Blueprint
            </button>
            <div className="flex-1" />
            <span className="text-[10px] text-muted-foreground/40">
              {new Date(task.completedAt ?? task.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
