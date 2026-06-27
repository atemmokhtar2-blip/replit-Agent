/**
 * ChatWorkspace — outer shell: sidebar + PlannerWorkspace.
 * Manages conversation lifecycle; delegates all AI interaction to PlannerWorkspace.
 *
 * Persistence: conversations and messages are stored in the database.
 * After refresh, the last active conversation is automatically restored.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSearch } from "wouter";
import {
  useListConversations,
  useCreateConversation,
  useGetConversation,
  useRenameConversation,
  useDeleteConversation,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { AIConversation } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlannerWorkspace } from "@/components/PlannerWorkspace";
import { AIPulse } from "@/components/design-system/AIPulse";
import { NeuralGrid } from "@/components/design-system/NeuralGrid";

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return "Yesterday";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

const PINNED_KEY = "aiagent_pinned_convs";
const LAST_CONV_KEY = "aiagent_last_conv_id";

function loadPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function savePinned(pinned: Set<string>) {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
  } catch { /* ignore */ }
}

function loadLastConvId(): string | null {
  try { return localStorage.getItem(LAST_CONV_KEY); } catch { return null; }
}

function saveLastConvId(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_CONV_KEY, id);
    else localStorage.removeItem(LAST_CONV_KEY);
  } catch { /* ignore */ }
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 1L8 1A1 1 0 018 3L7.5 5.5L9 7H3L4.5 5.5L4 3A1 1 0 014 1H5Z" />
      <line x1="6" y1="7" x2="6" y2="11" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="5.5" cy="5.5" r="3.5" />
      <line x1="8.5" y1="8.5" x2="11" y2="11" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1" y1="1" x2="9" y2="9" />
      <line x1="9" y1="1" x2="1" y2="9" />
    </svg>
  );
}

// ── Conversation sidebar item ──────────────────────────────────────────────────

interface ConversationItemProps {
  conv: AIConversation;
  isActive: boolean;
  isPinned: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePin: () => void;
}

function ConversationItem({ conv, isActive, isPinned, onSelect, onRename, onDelete, onTogglePin }: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title ?? "New conversation");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (isEditing) inputRef.current?.focus(); }, [isEditing]);
  useEffect(() => {
    if (!isEditing) setEditValue(conv.title ?? "New conversation");
  }, [conv.title, isEditing]);

  const submitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conv.title) onRename(trimmed);
    setIsEditing(false);
  };

  if (confirmDelete) {
    return (
      <div className="mx-2 mb-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
        <p className="mb-2 text-xs text-foreground">Delete this conversation?</p>
        <div className="flex gap-1">
          <Button size="sm" variant="destructive" className="h-7 flex-1 text-xs" onClick={onDelete}>Delete</Button>
          <Button size="sm" variant="ghost" className="h-7 flex-1 text-xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "group mx-2 mb-0.5 flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors min-h-[2.25rem]",
        isActive ? "bg-muted/70 text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      ].join(" ")}
      onClick={!isEditing ? onSelect : undefined}
    >
      {/* Left indicator */}
      <div className="flex-shrink-0 mt-1">
        {isPinned && !isActive ? (
          <span className="text-primary/50"><PinIcon filled /></span>
        ) : isActive ? (
          <div className="h-1.5 w-1.5 rounded-full bg-primary mt-0.5" />
        ) : (
          <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20 mt-0.5" />
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitRename();
              if (e.key === "Escape") setIsEditing(false);
            }}
            className="h-6 flex-1 border-primary/40 bg-background px-1.5 text-xs text-foreground"
          />
          <button onClick={submitRename} className="text-primary hover:opacity-80 p-1" aria-label="Save">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="1,5.5 4,8.5 10,2.5" /></svg>
          </button>
          <button onClick={() => setIsEditing(false)} className="text-muted-foreground hover:opacity-80 p-1" aria-label="Cancel">
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="10" y2="10" /><line x1="10" y1="1" x2="1" y2="10" /></svg>
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="min-w-0 flex-1 truncate text-sm leading-snug">{conv.title ?? "New conversation"}</span>
            {/* Action buttons — shown on hover */}
            <div className="flex flex-shrink-0 gap-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={onTogglePin}
                className={`rounded p-1 transition-colors ${isPinned ? "text-primary/60 hover:text-primary" : "hover:bg-background/50"}`}
                aria-label={isPinned ? "Unpin" : "Pin"}
                title={isPinned ? "Unpin" : "Pin"}
              >
                <PinIcon filled={isPinned} />
              </button>
              <button
                onClick={() => { setEditValue(conv.title ?? ""); setIsEditing(true); }}
                className="rounded p-1 hover:bg-background/50"
                aria-label="Rename"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 1.5l2 2-6 6H1.5v-2l6-6z" /></svg>
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded p-1 hover:bg-destructive/20 hover:text-destructive"
                aria-label="Delete"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 3h8M4 3V2h3v1M2.5 3l.5 6h5l.5-6" /></svg>
              </button>
            </div>
          </div>
          {/* Timestamp */}
          <span className={`text-[10px] mt-0.5 transition-colors ${isActive ? "text-primary/50" : "text-muted-foreground/40"}`}>
            {relativeTime(conv.updated_at)}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Section label ──────────────────────────────────────────────────────────────

function SidebarSection({ label }: { label: string }) {
  return (
    <div className="mx-3 mb-1 mt-3 flex items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40">{label}</span>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  );
}

// ── No conversation selected ───────────────────────────────────────────────────

function NoConversationState({ onCreate, isCreating }: { onCreate: () => void; isCreating: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <NeuralGrid width={120} height={80} color="#6366f1" active />
      <div className="max-w-xs">
        <h2 className="text-base font-semibold text-foreground mb-1">AI Agent Planner</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Describe the software you want to build. The AI Agent will design a complete architecture blueprint across 8 real execution stages.
        </p>
      </div>
      <Button onClick={onCreate} disabled={isCreating} size="sm" className="gap-2">
        {isCreating
          ? <AIPulse size={14} color="white" active />
          : <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="6.5" y1="1" x2="6.5" y2="12" /><line x1="1" y1="6.5" x2="12" y2="6.5" /></svg>
        }
        New Plan
      </Button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const AUTO_START_MESSAGE =
  "This repository has just been imported. Analyze its structure, understand the tech stack, install all required dependencies, and run the project. Fix any errors that prevent it from starting.";

export default function ChatWorkspace() {
  const queryClient = useQueryClient();
  const urlSearch = useSearch();
  const initialRepoId = useMemo(() => new URLSearchParams(urlSearch).get("repo") ?? undefined, [urlSearch]);
  const autoStart = useMemo(() => new URLSearchParams(urlSearch).get("autostart") === "1", [urlSearch]);
  const [selectedId, setSelectedId] = useState<string | null>(() => loadLastConvId());
  const [isFirstMessage, setIsFirstMessage] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<Set<string>>(() => loadPinned());
  const [autoRestored, setAutoRestored] = useState(false);
  // Track which conversationId was auto-created by the import autostart so we
  // only pass autoStartMessage to that exact conversation and never to later ones.
  const [autoStartConvId, setAutoStartConvId] = useState<string | null>(null);
  const autoStartInitiatedRef = useRef(false);
  const mountedRef = useRef(true);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cleanup flag so mutation callbacks don't update state after unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { data: convList, isLoading: listLoading } = useListConversations();
  const { data: activeConv, isLoading: convLoading } = useGetConversation(selectedId!, {
    query: { enabled: !!selectedId, queryKey: getGetConversationQueryKey(selectedId ?? "") },
  });

  const createMutation = useCreateConversation();
  const renameMutation = useRenameConversation();
  const deleteMutation = useDeleteConversation();

  // ── Auto-restore: select most recent conversation after load ─────────────────
  useEffect(() => {
    if (autoRestored || listLoading) return;

    // When autostart=1 is in the URL, skip restore — a new conversation will be
    // created automatically by the autostart effect below.
    if (autoStart) {
      setAutoRestored(true);
      return;
    }

    const items = convList?.items ?? [];
    if (items.length === 0) {
      setAutoRestored(true);
      return;
    }

    const savedId = loadLastConvId();
    if (savedId) {
      // Verify the saved conversation still exists
      const exists = items.some((c) => c.id === savedId);
      if (exists) {
        setSelectedId(savedId);
        setAutoRestored(true);
        return;
      }
    }

    // Fall back to the most recently updated conversation
    const mostRecent = items[0];
    if (mostRecent) {
      setSelectedId(mostRecent.id);
      saveLastConvId(mostRecent.id);
    }
    setAutoRestored(true);
  }, [convList, listLoading, autoRestored, autoStart]);

  // ── Auto-create conversation when coming from import with autostart=1 ────────
  useEffect(() => {
    if (!autoStart || !autoRestored || autoStartInitiatedRef.current) return;
    autoStartInitiatedRef.current = true;

    createMutation.mutate(
      { data: { title: "Repository Setup" } },
      {
        onSuccess: (conv) => {
          if (!mountedRef.current) return;
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          setSelectedId(conv.id);
          setIsFirstMessage(true);
          // Tie autostart message to this specific conversation only
          setAutoStartConvId(conv.id);
          // Clean the autostart param from the URL so a refresh doesn't re-trigger
          const cleanUrl = window.location.pathname + `?repo=${initialRepoId ?? ""}`;
          window.history.replaceState(null, "", cleanUrl);
          if (window.innerWidth < 768) setSidebarOpen(false);
        },
        onError: () => {
          if (!mountedRef.current) return;
          toast.error("Failed to create conversation");
        },
      }
    );
  }, [autoStart, autoRestored]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist selected conversation ID ─────────────────────────────────────────
  useEffect(() => {
    saveLastConvId(selectedId);
  }, [selectedId]);

  const handleTogglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      savePinned(next);
      return next;
    });
  }, []);

  const handleNewChat = () => {
    createMutation.mutate(
      { data: { title: "New conversation" } },
      {
        onSuccess: (conv) => {
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          setSelectedId(conv.id);
          setIsFirstMessage(true);
          setSearch("");
          if (window.innerWidth < 768) setSidebarOpen(false);
        },
        onError: () => toast.error("Failed to create conversation"),
      }
    );
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setIsFirstMessage(false);
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleRename = (conversationId: string, title: string) => {
    renameMutation.mutate(
      { conversationId, data: { title } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          if (selectedId === conversationId) queryClient.invalidateQueries({ queryKey: getGetConversationQueryKey(conversationId) });
        },
        onError: () => toast.error("Failed to rename"),
      }
    );
  };

  const handleDelete = (conversationId: string) => {
    deleteMutation.mutate(
      { conversationId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          if (selectedId === conversationId) {
            // Auto-select the next available conversation
            const remaining = (convList?.items ?? []).filter((c) => c.id !== conversationId);
            const next = remaining[0] ?? null;
            setSelectedId(next?.id ?? null);
          }
        },
        onError: () => toast.error("Failed to delete"),
      }
    );
  };

  const handleWorkspaceSuccess = useCallback((_conversationId: string) => {
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  }, [queryClient]);

  const allConversations = convList?.items ?? [];
  const messages = activeConv?.messages ?? [];

  // Filter by search
  const filtered = search.trim()
    ? allConversations.filter((c) =>
        (c.title ?? "New conversation").toLowerCase().includes(search.toLowerCase())
      )
    : allConversations;

  // Partition into pinned + rest
  const pinnedConvs = filtered.filter((c) => pinned.has(c.id));
  const unpinnedConvs = filtered.filter((c) => !pinned.has(c.id));

  const hasPinned = pinnedConvs.length > 0;
  const hasUnpinned = unpinnedConvs.length > 0;

  return (
    <div className="relative flex h-full w-full overflow-hidden">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="absolute inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={[
          "flex flex-col border-r border-border/60 bg-background",
          "absolute inset-y-0 left-0 z-30 w-72 transition-transform duration-200 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          "md:relative md:z-auto md:translate-x-0 md:transition-all md:duration-200",
          sidebarOpen ? "md:w-64 md:min-w-[16rem]" : "md:w-0 md:min-w-0 md:overflow-hidden md:border-0",
        ].join(" ")}
        aria-label="Conversations"
      >
        {/* Header */}
        <div className="flex-shrink-0 border-b border-border/60 px-3 py-3 space-y-2.5">
          <div className="flex items-center gap-2 px-1">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 flex-shrink-0">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-primary">
                <path d="M8 1.5L10 6L14.5 8L10 10L8 14.5L6 10L1.5 8L6 6L8 1.5Z" fill="currentColor" opacity="0.9"/>
              </svg>
            </div>
            <span className="text-sm font-medium text-foreground flex-1">AI Agent</span>
            <button
              onClick={() => { setSidebarOpen(false); }}
              className="md:hidden flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label="Close sidebar"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="1" y1="1" x2="11" y2="11" /><line x1="11" y1="1" x2="1" y2="11" /></svg>
            </button>
          </div>
          <Button onClick={handleNewChat} disabled={createMutation.isPending} className="w-full gap-1.5 h-8 text-xs" size="sm">
            {createMutation.isPending
              ? <AIPulse size={13} color="white" active />
              : <svg width="11" height="11" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="6.5" y1="1" x2="6.5" y2="12" /><line x1="1" y1="6.5" x2="12" y2="6.5" /></svg>
            }
            New conversation
          </Button>
          {/* Search */}
          {allConversations.length > 0 && (
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none">
                <SearchIcon />
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plans..."
                className="w-full rounded-md border border-border bg-background/60 py-1.5 pl-7 pr-7 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
              />
              {search && (
                <button
                  onClick={() => { setSearch(""); searchRef.current?.focus(); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground transition-colors"
                >
                  <ClearIcon />
                </button>
              )}
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto py-1">
          {listLoading ? (
            <div className="flex justify-center py-8"><AIPulse size={24} color="#6366f1" active /></div>
          ) : allConversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">No plans yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Click "New Plan" to start</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-muted-foreground">No matching plans</p>
            </div>
          ) : (
            <>
              {hasPinned && (
                <>
                  <SidebarSection label="Pinned" />
                  {pinnedConvs.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === selectedId}
                      isPinned={true}
                      onSelect={() => handleSelect(conv.id)}
                      onRename={(title) => handleRename(conv.id, title)}
                      onDelete={() => handleDelete(conv.id)}
                      onTogglePin={() => handleTogglePin(conv.id)}
                    />
                  ))}
                </>
              )}
              {hasUnpinned && (
                <>
                  <SidebarSection label="Recent Conversations" />
                  {unpinnedConvs.map((conv) => (
                    <ConversationItem
                      key={conv.id}
                      conv={conv}
                      isActive={conv.id === selectedId}
                      isPinned={false}
                      onSelect={() => handleSelect(conv.id)}
                      onRename={(title) => handleRename(conv.id, title)}
                      onDelete={() => handleDelete(conv.id)}
                      onTogglePin={() => handleTogglePin(conv.id)}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-border/50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground/40">Planner · Architecture Engine</p>
            {allConversations.length > 0 && (
              <p className="text-[10px] text-muted-foreground/30 tabular-nums">{allConversations.length} plan{allConversations.length !== 1 ? "s" : ""}</p>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 bg-background sm:px-4">
          <button
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            {sidebarOpen
              ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polyline points="9,1 3,7 9,13" /></svg>
              : <svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><line x1="1" y1="2" x2="15" y2="2" /><line x1="1" y1="7" x2="15" y2="7" /><line x1="1" y1="12" x2="15" y2="12" /></svg>
            }
          </button>
          <h1 className="truncate text-sm text-muted-foreground/70">
            {selectedId && activeConv ? (activeConv.title ?? "New conversation") : "AI Agent"}
          </h1>
        </div>

        {/* Workspace */}
        <div className="flex-1 overflow-hidden min-h-0">
          {listLoading ? (
            <div className="flex h-full items-center justify-center"><AIPulse size={32} color="#6366f1" active /></div>
          ) : !selectedId ? (
            <NoConversationState onCreate={handleNewChat} isCreating={createMutation.isPending} />
          ) : convLoading ? (
            <div className="flex h-full items-center justify-center"><AIPulse size={32} color="#6366f1" active /></div>
          ) : (
            <PlannerWorkspace
              key={selectedId}
              conversationId={selectedId}
              messages={messages}
              isFirstMessage={isFirstMessage}
              onSuccess={handleWorkspaceSuccess}
              initialRepoId={initialRepoId}
              autoStartMessage={selectedId === autoStartConvId ? AUTO_START_MESSAGE : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
