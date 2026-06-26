/**
 * PlannerWorkspace
 *
 * The main AI Agent planning interface. Displays:
 *  - An 8-stage execution timeline (left panel on desktop, compact bar on mobile)
 *  - Progressive blueprint rendering as sections stream in (right panel)
 *  - A conversation reply area for non-project responses
 *  - Past blueprint display for already-completed conversations
 *  - Execution summary + file tree preview after blueprint generation
 *  - Built-in Preview for HTML/CSS/JS content in the blueprint
 *
 * Connected to real planner execution via SSE streaming — no fake progress.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useRenameConversation,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { AIMessage } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AgentTimeline, type StageState } from "./design-system/AgentTimeline";
import { BlueprintCore } from "./design-system/BlueprintCore";
import { AIPulse } from "./design-system/AIPulse";
import { ExecutionPanel } from "./design-system/ExecutionPanel";
import { streamToPlannerEngine, PLANNER_STAGES } from "@/lib/planner-stream";
import type { PlannerStreamEvent } from "@/lib/planner-stream";

// ── Helpers ───────────────────────────────────────────────────────────────────

const INITIAL_STAGES: StageState[] = PLANNER_STAGES.map((s) => ({
  id: s.id,
  name: s.name,
  action: s.action,
  status: "pending",
}));

function parseBlueprint(content: string): { section: number; title: string; body: string }[] {
  const sections: { section: number; title: string; body: string }[] = [];
  const lines = content.split("\n");
  let current: { section: number; title: string; lines: string[] } | null = null;

  for (const line of lines) {
    const match = /^##\s+(\d+)\.\s+(.+)$/.exec(line);
    if (match) {
      if (current) sections.push({ section: current.section, title: current.title, body: current.lines.join("\n").trim() });
      current = { section: parseInt(match[1]!, 10), title: match[2]!.trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ section: current.section, title: current.title, body: current.lines.join("\n").trim() });
  return sections;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function autoTitle(content: string) {
  return content.slice(0, 60).trim() || "New conversation";
}

// ── Preview extraction ─────────────────────────────────────────────────────────

interface ExtractedCode {
  html: string | null;
  css: string | null;
  js: string | null;
}

function extractCodeBlocks(content: string): ExtractedCode {
  const blocks: { lang: string; code: string }[] = [];
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = codeBlockRegex.exec(content)) !== null) {
    blocks.push({ lang: (m[1] ?? "").toLowerCase(), code: m[2] ?? "" });
  }

  const html = blocks.find((b) => b.lang === "html")?.code ?? null;
  const css = blocks.find((b) => b.lang === "css" || b.lang === "scss" || b.lang === "style")?.code ?? null;
  const js = blocks.find((b) => b.lang === "js" || b.lang === "javascript" || b.lang === "typescript" || b.lang === "ts")?.code ?? null;

  return { html, css, js };
}

function buildPreviewDocument(extracted: ExtractedCode): string | null {
  const { html, css, js } = extracted;
  if (!html && !css && !js) return null;

  if (html) {
    // If html block already has full document structure, inject css/js
    if (html.trim().toLowerCase().startsWith("<!doctype") || html.trim().toLowerCase().startsWith("<html")) {
      let doc = html;
      if (css && !doc.includes("</head>")) {
        doc += `\n<style>\n${css}\n</style>`;
      } else if (css) {
        doc = doc.replace("</head>", `<style>\n${css}\n</style>\n</head>`);
      }
      if (js && !doc.includes("</body>")) {
        doc += `\n<script>\n${js}\n</script>`;
      } else if (js) {
        doc = doc.replace("</body>", `<script>\n${js}\n</script>\n</body>`);
      }
      return doc;
    }

    // Partial HTML — wrap in full document
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 1rem; }
    ${css ?? ""}
  </style>
</head>
<body>
${html}
${js ? `<script>\n${js}\n</script>` : ""}
</body>
</html>`;
  }

  // CSS or JS only
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Preview</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 1rem; background: #f8f9fa; }
    ${css ?? ""}
  </style>
</head>
<body>
  <p style="color:#888;font-size:12px;padding:8px">No HTML content found — showing CSS/JS only.</p>
  ${js ? `<script>\n${js}\n</script>` : ""}
</body>
</html>`;
}

// ── Preview Modal ──────────────────────────────────────────────────────────────

interface PreviewModalProps {
  content: string;
  onClose: () => void;
}

function PreviewModal({ content, onClose }: PreviewModalProps) {
  const extracted = extractCodeBlocks(content);
  const [docContent, setDocContent] = useState(() => buildPreviewDocument(extracted));
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!docContent) return;
    const blob = new Blob([docContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [docContent, iframeKey]);

  const handleRestart = () => {
    setDocContent(buildPreviewDocument(extractCodeBlocks(content)));
    setIframeKey((k) => k + 1);
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Restarted preview`]);
  };

  const handleOpenTab = () => {
    if (blobUrl) window.open(blobUrl, "_blank");
  };

  // Trap Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!docContent) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-2xl">
          <div className="text-2xl mb-3">🔍</div>
          <h3 className="text-sm font-semibold text-foreground mb-2">No previewable content found</h3>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            The blueprint doesn't contain HTML, CSS, or JavaScript code blocks that can be previewed.
            Ask the AI to generate a concrete implementation with code.
          </p>
          <Button onClick={onClose} size="sm">Close</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border bg-card/80 px-3 py-2">
        {/* Left: status */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-green-500/15">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          </div>
          <span className="text-xs font-medium text-foreground truncate">Blueprint Preview</span>
          <span className="text-xs text-muted-foreground hidden sm:block">· HTML/CSS/JS extracted from blueprint</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowLogs((v) => !v)}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10px] transition-colors ${
              showLogs
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
              <line x1="2.5" y1="3.5" x2="7.5" y2="3.5" />
              <line x1="2.5" y1="5.5" x2="7.5" y2="5.5" />
              <line x1="2.5" y1="7.5" x2="5" y2="7.5" />
            </svg>
            Logs {logs.length > 0 && `(${logs.length})`}
          </button>
          <button
            onClick={handleRestart}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Restart preview"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M8.5 1.5A4.5 4.5 0 1 0 9 5" />
              <polyline points="9,0 9,1.5 7.5,1.5" />
            </svg>
            Restart
          </button>
          <button
            onClick={handleOpenTab}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Open in new tab"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M4.5 1H1.5a1 1 0 00-1 1v6.5a1 1 0 001 1H8a1 1 0 001-1V5.5" />
              <path d="M6.5 1H9v2.5M9 1L5.5 4.5" />
            </svg>
            Open
          </button>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Close preview"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="11" y2="11" />
              <line x1="11" y1="1" x2="1" y2="11" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Iframe */}
        <div className="relative flex-1 min-w-0 bg-white dark:bg-neutral-900">
          {blobUrl && (
            <iframe
              key={iframeKey}
              ref={iframeRef}
              src={blobUrl}
              title="Blueprint Preview"
              className="absolute inset-0 h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] Preview loaded`])}
            />
          )}
        </div>

        {/* Logs panel */}
        {showLogs && (
          <div className="w-64 flex-shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Runtime Logs</span>
              <button
                onClick={() => setLogs([])}
                className="text-[9px] text-muted-foreground/50 hover:text-muted-foreground"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] text-foreground/70 space-y-0.5">
              {logs.length === 0 ? (
                <span className="text-muted-foreground/40">No log entries yet</span>
              ) : (
                logs.map((l, i) => <div key={i} className="leading-relaxed">{l}</div>)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Blueprint section viewer ───────────────────────────────────────────────────

interface SectionCardProps {
  section: { section: number; title: string; body: string };
  isNew?: boolean;
}

function SectionCard({ section, isNew }: SectionCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = `## ${section.section}. ${section.title}\n\n${section.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      toast.success("Section copied");
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed"; el.style.left = "-9999px";
      document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      className={`rounded-lg border border-border bg-card/60 overflow-hidden transition-all duration-500 ${
        isNew ? "ring-1 ring-primary/30" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-2.5 bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 text-[10px] font-bold text-primary">
            {section.section}
          </span>
          <span className="text-xs font-semibold text-foreground">{section.title}</span>
        </div>
        <button
          onClick={handleCopy}
          className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Copy section"
        >
          {copied ? (
            <span className="text-green-400 font-medium">Copied</span>
          ) : (
            "Copy"
          )}
        </button>
      </div>
      <div className="px-4 py-3 text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap font-mono">
        {section.body}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onNewChat }: { onNewChat?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="relative">
        <AIPulse size={64} color="#6366f1" active />
      </div>
      <div className="max-w-xs">
        <h2 className="text-base font-semibold text-foreground mb-1">
          AI Agent Planner
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Describe the software you want to build. The AI Agent will generate a complete architecture blueprint in 8 stages.
        </p>
      </div>
      {onNewChat && (
        <Button onClick={onNewChat} size="sm" className="gap-2">
          Start Planning
        </Button>
      )}
    </div>
  );
}

// ── Preview button ─────────────────────────────────────────────────────────────

function PreviewButton({ content, onOpen }: { content: string; onOpen: () => void }) {
  const { html, css, js } = extractCodeBlocks(content);
  const hasCode = !!(html || css || js);

  return (
    <button
      onClick={onOpen}
      title={hasCode ? "Preview the generated code" : "No previewable code found in this blueprint"}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border transition-all ${
        hasCode
          ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 hover:border-green-500/50"
          : "border-border text-muted-foreground/50 cursor-default"
      }`}
    >
      {/* Play icon */}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
        <polygon points="2,1 9,5 2,9" />
      </svg>
      Preview
      {!hasCode && <span className="text-[9px] opacity-60 ml-0.5">(no code)</span>}
    </button>
  );
}

// ── Blueprint display (past / completed) ──────────────────────────────────────

function PastBlueprintView({ content, model }: { content: string; model?: string }) {
  const sections = parseBlueprint(content);
  const [copiedAll, setCopiedAll] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedAll(true); toast.success("Blueprint copied"); setTimeout(() => setCopiedAll(false), 2000);
    }).catch(() => {
      const el = document.createElement("textarea");
      el.value = content; el.style.position = "fixed"; el.style.left = "-9999px";
      document.body.appendChild(el); el.select(); document.execCommand("copy");
      document.body.removeChild(el); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 2000);
    });
  };

  if (sections.length === 0) {
    return (
      <>
        <div className="rounded-lg border border-border bg-card p-4 text-xs text-foreground/80 whitespace-pre-wrap font-mono">
          {content}
        </div>
        {previewOpen && <PreviewModal content={content} onClose={() => setPreviewOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BlueprintCore size={24} color="#22c55e" complete active />
            <span className="text-xs font-semibold text-foreground">Architecture Blueprint</span>
            {model && <span className="text-[10px] text-muted-foreground/50">via {model.split("/").pop()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <PreviewButton content={content} onOpen={() => setPreviewOpen(true)} />
            <button
              onClick={handleCopyAll}
              className="rounded px-2.5 py-1 text-[10px] border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            >
              {copiedAll ? <span className="text-green-400">Copied All</span> : "Copy All"}
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {sections.map((s) => (
            <SectionCard key={s.section} section={s} />
          ))}
        </div>
        <ExecutionPanel blueprint={content} model={model} />
      </div>
      {previewOpen && <PreviewModal content={content} onClose={() => setPreviewOpen(false)} />}
    </>
  );
}

// ── Conversation message (casual replies) ─────────────────────────────────────

function ConversationMessage({ content, timestamp }: { content: string; timestamp?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex gap-3 group">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-muted/50 border border-border">
        <AIPulse size={16} color="#6366f1" active />
      </div>
      <div className="relative rounded-xl rounded-tl-sm bg-muted border border-border px-4 py-2.5 text-sm text-foreground max-w-lg leading-relaxed">
        {content}
        {timestamp && (
          <div className="mt-1 text-[10px] text-muted-foreground/40">{formatTime(timestamp)}</div>
        )}
        <button
          onClick={handleCopy}
          className="absolute right-2 top-2 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        >
          {copied ? <span className="text-[10px] text-green-400">Copied</span> : (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M3 8H2a1 1 0 01-1-1V2a1 1 0 011-1h5a1 1 0 011 1v1" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Live streaming view ────────────────────────────────────────────────────────

function LiveBlueprintView({ content, detectedSections }: { content: string; detectedSections: number }) {
  const sections = parseBlueprint(content);
  const [copiedAll, setCopiedAll] = useState(false);

  const handleCopyAll = () => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedAll(true); toast.success("Blueprint copied"); setTimeout(() => setCopiedAll(false), 2000);
    });
  };

  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 text-xs text-foreground/60 font-mono leading-relaxed whitespace-pre-wrap">
        {content || <span className="animate-pulse">Generating architecture...</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-foreground">
          Architecture Blueprint
          <span className="ml-2 text-muted-foreground/50 font-normal">
            {detectedSections}/12 sections
          </span>
        </span>
        {content.length > 100 && (
          <button
            onClick={handleCopyAll}
            className="rounded px-2.5 py-1 text-[10px] border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            {copiedAll ? <span className="text-green-400">Copied</span> : "Copy All"}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {sections.map((s, i) => (
          <SectionCard key={s.section} section={s} isNew={i === sections.length - 1} />
        ))}
      </div>
    </div>
  );
}

// ── Main PlannerWorkspace ──────────────────────────────────────────────────────

interface PlannerWorkspaceProps {
  conversationId: string;
  messages: AIMessage[];
  isFirstMessage: boolean;
  onSuccess: (conversationId: string) => void;
}

type WorkspacePhase =
  | { kind: "idle" }
  | { kind: "streaming"; stages: StageState[]; content: string; detectedSections: number }
  | { kind: "done_blueprint"; content: string; model: string; stages: StageState[] }
  | { kind: "done_conversation"; content: string }
  | { kind: "error"; message: string };

export function PlannerWorkspace({ conversationId, messages, isFirstMessage, onSuccess }: PlannerWorkspaceProps) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<WorkspacePhase>({ kind: "idle" });
  const [isStreaming, setIsStreaming] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const wasFirstRef = useRef(isFirstMessage);

  const renameMutation = useRenameConversation();

  // Auto-scroll when content grows
  useEffect(() => {
    if (phase.kind === "streaming") {
      contentEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [phase]);

  const handleSend = useCallback(async (overrideContent?: string) => {
    const content = overrideContent !== undefined ? overrideContent : input.trim();
    if (!content || isStreaming) return;

    setInput("");
    setIsStreaming(true);
    wasFirstRef.current = isFirstMessage;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const stages: StageState[] = INITIAL_STAGES.map((s) => ({ ...s }));
    setPhase({ kind: "streaming", stages: [...stages], content: "", detectedSections: 0 });

    let accContent = "";
    let detectedSections = 0;

    const handleEvent = (event: PlannerStreamEvent) => {
      switch (event.type) {
        case "stage_start":
          setPhase((prev) => {
            if (prev.kind !== "streaming") return prev;
            const now = new Date().toISOString();
            const next = prev.stages.map((s) =>
              s.id === event.stage
                ? { ...s, status: "running" as const, startedAt: now }
                : s
            );
            return { ...prev, stages: next };
          });
          break;

        case "stage_complete":
          setPhase((prev) => {
            if (prev.kind !== "streaming") return prev;
            const now = new Date().toISOString();
            const next = prev.stages.map((s) =>
              s.id === event.stage
                ? { ...s, status: "complete" as const, completedAt: now }
                : s
            );
            return { ...prev, stages: next };
          });
          break;

        case "content_chunk":
          accContent += event.text;
          setPhase((prev) => {
            if (prev.kind !== "streaming") return prev;
            return { ...prev, content: accContent };
          });
          break;

        case "section_detected":
          detectedSections = Math.max(detectedSections, event.section);
          setPhase((prev) => {
            if (prev.kind !== "streaming") return prev;
            return { ...prev, detectedSections };
          });
          break;

        case "done":
          setPhase((prev) => {
            const finalStages: StageState[] =
              prev.kind === "streaming"
                ? prev.stages.map((s) => ({
                    ...s,
                    status: "complete" as const,
                    completedAt: s.completedAt ?? new Date().toISOString(),
                  }))
                : INITIAL_STAGES.map((s) => ({ ...s, status: "complete" as const }));
            return { kind: "done_blueprint", content: event.content, model: event.model, stages: finalStages };
          });
          setIsStreaming(false);
          queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          onSuccess(conversationId);
          if (wasFirstRef.current) {
            renameMutation.mutate(
              { conversationId, data: { title: autoTitle(content) } },
              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) }
            );
          }
          break;

        case "conversation":
          setPhase({ kind: "done_conversation", content: event.content });
          setIsStreaming(false);
          queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          onSuccess(conversationId);
          if (wasFirstRef.current) {
            renameMutation.mutate(
              { conversationId, data: { title: autoTitle(content) } },
              { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() }) }
            );
          }
          break;

        case "error":
          setPhase({ kind: "error", message: event.message });
          setIsStreaming(false);
          break;
      }
    };

    try {
      await streamToPlannerEngine(content, conversationId, handleEvent, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "Connection failed";
      setPhase({ kind: "error", message: msg });
      toast.error(msg);
    } finally {
      if (!controller.signal.aborted) setIsStreaming(false);
    }
  }, [input, isStreaming, conversationId, isFirstMessage, queryClient, renameMutation, onSuccess]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const renderContent = () => {
    if (phase.kind === "streaming") {
      return (
        <div className="flex flex-col gap-4 pb-4">
          <LiveBlueprintView content={phase.content} detectedSections={phase.detectedSections} />
          <div ref={contentEndRef} />
        </div>
      );
    }

    if (phase.kind === "done_blueprint") {
      return (
        <div className="flex flex-col gap-4 pb-4">
          <PastBlueprintView content={phase.content} model={phase.model} />
          <div ref={contentEndRef} />
        </div>
      );
    }

    if (phase.kind === "done_conversation") {
      return (
        <div className="flex flex-col gap-4 pb-4">
          <ConversationMessage content={phase.content} />
          <div ref={contentEndRef} />
        </div>
      );
    }

    if (phase.kind === "error") {
      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-foreground/80">
          {phase.message}
        </div>
      );
    }

    // Idle: render last blueprint from persisted messages
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastAssistant) {
      const metadata = lastAssistant.metadata as { module?: string; model?: string } | null;
      const isPlan = metadata?.module === "planner" || lastAssistant.content.includes("## 1.");
      return (
        <div className="flex flex-col gap-3">
          {isPlan ? (
            <PastBlueprintView content={lastAssistant.content} model={metadata?.model ?? undefined} />
          ) : (
            <ConversationMessage content={lastAssistant.content} timestamp={lastAssistant.created_at} />
          )}
          {lastUser && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => handleSend(lastUser.content)}
                disabled={isStreaming}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 hover:bg-muted transition-all disabled:opacity-40"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 2A5 5 0 1 0 9.8 6.5" />
                  <polyline points="9.5,0 9.5,2.5 7,2.5" />
                </svg>
                Regenerate response
              </button>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  // Timeline is shown when streaming or when done with a blueprint
  const showTimeline = phase.kind === "streaming" || phase.kind === "done_blueprint";

  const currentStages: StageState[] =
    phase.kind === "streaming"
      ? phase.stages
      : phase.kind === "done_blueprint"
      ? phase.stages
      : INITIAL_STAGES.map((s) => ({ ...s, status: "pending" as const }));

  // Live preview content (for done_blueprint phase)
  const previewContent = phase.kind === "done_blueprint" ? phase.content : null;

  return (
    <div className="flex h-full flex-col min-w-0 overflow-hidden">

      {/* ── Main content area ────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Timeline panel — desktop */}
        {showTimeline && (
          <div className="hidden lg:flex w-52 flex-shrink-0 flex-col border-r border-border bg-card/30 overflow-y-auto px-3 py-4">
            <div className="mb-3 flex items-center gap-2">
              <AIPulse size={16} color="#6366f1" active={phase.kind === "streaming"} />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Pipeline
              </span>
            </div>
            <AgentTimeline stages={currentStages} />

            {/* Preview shortcut in sidebar */}
            {phase.kind === "done_blueprint" && (
              <div className="mt-4 pt-4 border-t border-border/50">
                <button
                  onClick={() => setPreviewOpen(true)}
                  className="w-full flex items-center gap-2 rounded-lg border border-green-500/25 bg-green-500/8 px-3 py-2.5 text-[11px] font-medium text-green-600 dark:text-green-400 hover:bg-green-500/15 transition-colors"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9" /></svg>
                  Open Preview
                </button>
              </div>
            )}
          </div>
        )}

        {/* Content panel */}
        <div className="flex flex-1 flex-col min-w-0 overflow-hidden">

          {/* Mobile timeline bar */}
          {showTimeline && (
            <div className="flex-shrink-0 border-b border-border bg-card/20 px-3 lg:hidden">
              <AgentTimeline stages={currentStages} compact />
            </div>
          )}

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-4">
            {renderContent() ?? (
              messages.length === 0 ? null : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">Select a message or start a new plan</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 border-t border-border bg-background/95 px-3 pt-3 pb-3 sm:px-4 sm:pt-3.5"
        style={{ paddingBottom: "max(0.75rem, var(--safe-bottom))" }}
      >
        <div className="mx-auto max-w-3xl">
          <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isStreaming ? "Generating blueprint..." : "Describe the software you want to build..."}
              className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-3 text-sm shadow-none focus-visible:ring-0"
              rows={1}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              className="mb-2 mr-2 h-8 w-8 flex-shrink-0"
              onClick={() => handleSend()}
              disabled={!input.trim() || isStreaming}
            >
              {isStreaming ? (
                <AIPulse size={16} color="white" active />
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.5 1.5L6.5 7.5M12.5 1.5L8.5 12.5L6.5 7.5M12.5 1.5L1.5 5.5L6.5 7.5" />
                </svg>
              )}
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/40 hidden sm:block">
            Enter to send  ·  Shift+Enter for newline  ·  The AI Agent generates a structured architecture blueprint
          </p>
        </div>
      </div>

      {/* ── Preview Modal ─────────────────────────────────────────────────── */}
      {previewOpen && previewContent && (
        <PreviewModal content={previewContent} onClose={() => setPreviewOpen(false)} />
      )}
    </div>
  );
}
