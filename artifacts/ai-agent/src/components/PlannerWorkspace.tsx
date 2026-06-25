/**
 * PlannerWorkspace
 *
 * The main AI Agent planning interface. Displays:
 *  - An 8-stage execution timeline (left panel on desktop, compact bar on mobile)
 *  - Progressive blueprint rendering as sections stream in (right panel)
 *  - A conversation reply area for non-project responses
 *  - Past blueprint display for already-completed conversations
 *  - Execution summary + file tree preview after blueprint generation
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

// ── Blueprint display (past / completed) ──────────────────────────────────────

function PastBlueprintView({ content, model }: { content: string; model?: string }) {
  const sections = parseBlueprint(content);
  const [copiedAll, setCopiedAll] = useState(false);

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
      <div className="rounded-lg border border-border bg-card p-4 text-xs text-foreground/80 whitespace-pre-wrap font-mono">
        {content}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BlueprintCore size={24} color="#22c55e" complete active />
          <span className="text-xs font-semibold text-foreground">Architecture Blueprint</span>
          {model && <span className="text-[10px] text-muted-foreground/50">via {model.split("/").pop()}</span>}
        </div>
        <button
          onClick={handleCopyAll}
          className="rounded px-2.5 py-1 text-[10px] border border-border text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          {copiedAll ? <span className="text-green-400">Copied All</span> : "Copy All"}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {sections.map((s) => (
          <SectionCard key={s.section} section={s} />
        ))}
      </div>
      <ExecutionPanel blueprint={content} model={model} />
    </div>
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

  const handleSend = useCallback(async () => {
    const content = input.trim();
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
    if (lastAssistant) {
      const metadata = lastAssistant.metadata as { module?: string; model?: string } | null;
      const isPlan = metadata?.module === "planner" || lastAssistant.content.includes("## 1.");
      if (isPlan) {
        return <PastBlueprintView content={lastAssistant.content} model={metadata?.model ?? undefined} />;
      }
      return <ConversationMessage content={lastAssistant.content} timestamp={lastAssistant.created_at} />;
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
              onClick={handleSend}
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
    </div>
  );
}
