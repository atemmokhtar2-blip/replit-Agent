/**
 * TaskDetailsDrawer
 *
 * Right-side drawer that shows full execution details for a task:
 * - Stage timeline
 * - Blueprint sections (if any)
 * - Parsed file list
 * - Live Preview (HTML/CSS/JS rendered in sandboxed iframe)
 *
 * Opens when user clicks a TaskCard.
 */

import { useState, useEffect, useRef, useCallback } from "react";
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

// ── Code block extraction ─────────────────────────────────────────────────────

interface ExtractedCode {
  html: string;
  css: string;
  js: string;
  hasContent: boolean;
}

function extractCodeBlocks(content: string): ExtractedCode {
  const htmlBlocks: string[] = [];
  const cssBlocks: string[] = [];
  const jsBlocks: string[] = [];

  const fenceRe = /```(\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;

  while ((m = fenceRe.exec(content)) !== null) {
    const lang = (m[1] ?? "").toLowerCase().trim();
    const code = m[2] ?? "";

    if (lang === "html" || lang === "htm") {
      htmlBlocks.push(code.trim());
    } else if (lang === "css" || lang === "scss") {
      cssBlocks.push(code.trim());
    } else if (lang === "js" || lang === "javascript" || lang === "ts" || lang === "typescript") {
      jsBlocks.push(code.trim());
    }
  }

  return {
    html: htmlBlocks.join("\n\n"),
    css: cssBlocks.join("\n\n"),
    js: jsBlocks.join("\n\n"),
    hasContent: htmlBlocks.length > 0 || cssBlocks.length > 0 || jsBlocks.length > 0,
  };
}

function buildPreviewDocument(code: ExtractedCode): string {
  const bodyContent = code.html || `
    <div style="font-family:system-ui,sans-serif;color:#888;text-align:center;margin-top:80px;">
      <p style="font-size:14px;">No HTML template found in blueprint.<br/>CSS and JS blocks are injected below.</p>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:system-ui,-apple-system,sans-serif;background:#fff;color:#111;}
${code.css}
</style>
</head>
<body>
${bodyContent}
${code.js ? `<script>\ntry{\n${code.js}\n}catch(e){console.error('[Preview error]',e);}\n</script>` : ""}
</body>
</html>`;
}

// ── Live Preview pane ─────────────────────────────────────────────────────────

function LivePreviewPane({ content }: { content: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [refreshKey, setRefreshKey] = useState(0);

  const code = extractCodeBlocks(content);
  const doc = buildPreviewDocument(code);

  const handleRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const handleOpenExternal = useCallback(() => {
    const blob = new Blob([doc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    setTimeout(() => { if (win) URL.revokeObjectURL(url); }, 5000);
  }, [doc]);

  if (!code.hasContent) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-center px-6">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/20">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-muted-foreground/40">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
            <path d="M9 9l2 2-2 2M13 13h2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-sm font-medium text-foreground/50">No previewable code found</p>
        <p className="mt-1.5 text-[11px] text-muted-foreground/40 leading-relaxed max-w-xs">
          The blueprint doesn't contain HTML, CSS, or JS code blocks yet. Preview becomes available once the AI generates frontend code.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Preview toolbar */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2 bg-card/30">
        {/* mode toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-[10px]">
          <button
            onClick={() => setMode("preview")}
            className={`px-2.5 py-1 font-medium transition-colors ${mode === "preview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
          >
            Preview
          </button>
          <button
            onClick={() => setMode("source")}
            className={`px-2.5 py-1 font-medium transition-colors ${mode === "source" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/30"}`}
          >
            Source
          </button>
        </div>

        {/* badges */}
        <div className="flex items-center gap-1 flex-1 flex-wrap">
          {code.html && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-orange-500/15 text-orange-400 uppercase tracking-wide">HTML</span>
          )}
          {code.css && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-pink-500/15 text-pink-400 uppercase tracking-wide">CSS</span>
          )}
          {code.js && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-yellow-500/15 text-yellow-400 uppercase tracking-wide">JS</span>
          )}
        </div>

        {/* actions */}
        <button
          onClick={handleRefresh}
          title="Refresh preview"
          className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M9.5 2A5 5 0 1 0 9.8 6.5" />
            <polyline points="9.5,0 9.5,2.5 7,2.5" />
          </svg>
        </button>
        <button
          onClick={handleOpenExternal}
          title="Open in new tab"
          className="flex items-center justify-center h-6 w-6 rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted/30 transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 2H2a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V6" />
            <path d="M7 1h3v3" />
            <line x1="10" y1="1" x2="5" y2="6" />
          </svg>
        </button>
      </div>

      {/* Preview iframe */}
      {mode === "preview" && (
        <div className="flex-1 bg-white relative overflow-hidden">
          <iframe
            key={refreshKey}
            ref={iframeRef}
            srcDoc={doc}
            sandbox="allow-scripts allow-same-origin"
            title="Live Preview"
            className="w-full h-full border-0"
            style={{ minHeight: 0 }}
          />
        </div>
      )}

      {/* Source view */}
      {mode === "source" && (
        <div className="flex-1 overflow-y-auto bg-[#0d0d0d]">
          <pre className="text-[10.5px] font-mono text-green-300/80 leading-relaxed p-4 whitespace-pre-wrap break-all">
            {doc}
          </pre>
        </div>
      )}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<"timeline" | "blueprint" | "files" | "preview">("timeline");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!task) return null;

  const sections = task.result ? parseBlueprint(task.result.content) : [];
  const files = task.result ? extractFiles(task.result.content) : [];
  const hasResult = !!task.result;
  const codeBlocks = task.result ? extractCodeBlocks(task.result.content) : { hasContent: false, html: "", css: "", js: "" };

  function formatElapsed(start: string, end?: string): string {
    const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  const tabs = [
    { id: "timeline" as const, label: "Timeline", disabled: false },
    { id: "blueprint" as const, label: sections.length > 0 ? `Blueprint (${sections.length})` : "Blueprint", disabled: !hasResult },
    { id: "files" as const, label: files.length > 0 ? `Files (${files.length})` : "Files", disabled: !hasResult },
    { id: "preview" as const, label: "Live Preview", disabled: !hasResult, highlight: codeBlocks.hasContent },
  ];

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
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
              className={`relative px-3 py-2.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-foreground"
                  : tab.disabled
                  ? "text-muted-foreground/30 cursor-default"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tab.label}
                {tab.highlight && (
                  <span className="inline-flex h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                )}
              </span>
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className={`flex-1 min-h-0 ${activeTab === "preview" ? "flex flex-col overflow-hidden" : "overflow-y-auto p-4"}`}>

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

          {/* Live Preview tab */}
          {activeTab === "preview" && hasResult && (
            <LivePreviewPane content={task.result!.content} />
          )}
        </div>

        {/* Footer actions */}
        {task.status === "ready" && task.result && activeTab !== "preview" && (
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
            {codeBlocks.hasContent && (
              <button
                onClick={() => setActiveTab("preview")}
                className="flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs text-green-400 hover:bg-green-500/20 transition-colors"
              >
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-green-400" />
                Live Preview
              </button>
            )}
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
