import { useState, useRef, useEffect, useCallback } from "react";
import {
  useListConversations,
  useCreateConversation,
  useGetConversation,
  useRenameConversation,
  useDeleteConversation,
  useSendMessage,
  getListConversationsQueryKey,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import type { AIConversation, AIMessage } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Plus,
  Send,
  Trash2,
  Pencil,
  Check,
  X,
  MessageSquare,
  Loader2,
  Paperclip,
  Bot,
  User,
  Menu,
  ChevronLeft,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function autoTitle(content: string) {
  return content.slice(0, 60).trim() || "New conversation";
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: AIMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex gap-2 sm:gap-3 ${isUser ? "flex-row-reverse" : "flex-row"} group`}>
      <div
        className={`flex h-7 w-7 sm:h-8 sm:w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold
          ${isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground border border-border"}`}
      >
        {isUser ? <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Bot className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
      </div>

      <div
        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 text-sm leading-relaxed whitespace-pre-wrap break-words
          ${isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground border border-border rounded-tl-sm"
          }`}
      >
        {message.content}
        <div
          className={`mt-1 text-[10px] opacity-50 ${isUser ? "text-right" : "text-left"}`}
        >
          {formatTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}

// ── Thinking indicator ─────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm bg-muted border border-border px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </div>
    </div>
  );
}

// ── Conversation item ──────────────────────────────────────────────────────────

interface ConversationItemProps {
  conv: AIConversation;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

function ConversationItem({
  conv,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(conv.title ?? "New conversation");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const submitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== conv.title) onRename(trimmed);
    setIsEditing(false);
  };

  if (confirmDelete) {
    return (
      <div className="mx-2 mb-1 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
        <p className="mb-2 text-xs text-foreground">Delete this chat?</p>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="destructive"
            className="h-7 flex-1 text-xs"
            onClick={onDelete}
          >
            Delete
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 flex-1 text-xs"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group mx-2 mb-0.5 flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors min-h-[2.5rem]
        ${isActive
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      onClick={!isEditing ? onSelect : undefined}
    >
      <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 opacity-60" />

      {isEditing ? (
        <div
          className="flex flex-1 items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
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
          <button
            onClick={submitRename}
            className="text-primary hover:opacity-80 p-1"
            aria-label="Save rename"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setIsEditing(false)}
            className="text-muted-foreground hover:opacity-80 p-1"
            aria-label="Cancel rename"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">
            {conv.title ?? "New conversation"}
          </span>
          <div className="flex flex-shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditValue(conv.title ?? "");
                setIsEditing(true);
              }}
              className="rounded p-1 hover:bg-background/50"
              aria-label="Rename conversation"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete(true);
              }}
              className="rounded p-1 hover:bg-destructive/20 hover:text-destructive"
              aria-label="Delete conversation"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ChatWorkspace() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  // Default: open on md+ screens, closed on mobile
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [isFirstMessage, setIsFirstMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data: convList, isLoading: listLoading } = useListConversations();

  const { data: activeConv, isLoading: convLoading } = useGetConversation(
    selectedId!,
    {
      query: {
        enabled: !!selectedId,
        queryKey: getGetConversationQueryKey(selectedId ?? ""),
      },
    }
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useCreateConversation();
  const renameMutation = useRenameConversation();
  const deleteMutation = useDeleteConversation();
  const sendMutation = useSendMessage();

  // ── Auto-scroll ────────────────────────────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [activeConv?.messages, sendMutation.isPending, scrollToBottom]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleNewChat = () => {
    createMutation.mutate(
      { data: { title: "New conversation" } },
      {
        onSuccess: (conv) => {
          queryClient.invalidateQueries({
            queryKey: getListConversationsQueryKey(),
          });
          setSelectedId(conv.id);
          setIsFirstMessage(true);
          // On mobile: close sidebar after creating new chat
          if (window.innerWidth < 768) setSidebarOpen(false);
          textareaRef.current?.focus();
        },
        onError: () => toast.error("Failed to create conversation"),
      }
    );
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setIsFirstMessage(false);
    // Always close sidebar on mobile after selecting
    if (window.innerWidth < 768) setSidebarOpen(false);
  };

  const handleRename = (conversationId: string, title: string) => {
    renameMutation.mutate(
      { conversationId, data: { title } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListConversationsQueryKey(),
          });
          if (selectedId === conversationId) {
            queryClient.invalidateQueries({
              queryKey: getGetConversationQueryKey(conversationId),
            });
          }
        },
        onError: () => toast.error("Failed to rename conversation"),
      }
    );
  };

  const handleDelete = (conversationId: string) => {
    deleteMutation.mutate(
      { conversationId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListConversationsQueryKey(),
          });
          if (selectedId === conversationId) setSelectedId(null);
        },
        onError: () => toast.error("Failed to delete conversation"),
      }
    );
  };

  const handleSend = () => {
    const content = input.trim();
    if (!content || !selectedId || sendMutation.isPending) return;

    const wasFirst = isFirstMessage;
    setInput("");
    setIsFirstMessage(false);

    sendMutation.mutate(
      { conversationId: selectedId, data: { content } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetConversationQueryKey(selectedId),
          });
          queryClient.invalidateQueries({
            queryKey: getListConversationsQueryKey(),
          });

          if (wasFirst) {
            renameMutation.mutate(
              {
                conversationId: selectedId,
                data: { title: autoTitle(content) },
              },
              {
                onSuccess: () => {
                  queryClient.invalidateQueries({
                    queryKey: getListConversationsQueryKey(),
                  });
                },
              }
            );
          }
        },
        onError: () => toast.error("Failed to send message"),
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const conversations = convList?.items ?? [];
  const messages = activeConv?.messages ?? [];

  return (
    <div className="relative flex h-full w-full overflow-hidden">

      {/* ── Mobile overlay backdrop ──────────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-20 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Conversation sidebar ─────────────────────────────────────────────── */}
      {/*
        Mobile: absolute overlay, slides in/out via translate
        md+: inline flex column, collapses to w-0
      */}
      <aside
        className={[
          "flex flex-col border-r border-border bg-card",
          // Mobile: absolute overlay
          "absolute inset-y-0 left-0 z-30 w-72",
          "transition-transform duration-200 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          // md+: switch to in-flow, width-based collapse
          "md:relative md:z-auto md:translate-x-0 md:transition-all md:duration-200",
          sidebarOpen
            ? "md:w-72 md:min-w-[18rem]"
            : "md:w-0 md:min-w-0 md:overflow-hidden md:border-0",
        ].join(" ")}
        aria-label="Conversations"
      >
        {/* New Chat */}
        <div className="flex-shrink-0 p-3 border-b border-border">
          <Button
            onClick={handleNewChat}
            disabled={createMutation.isPending}
            className="w-full gap-2"
            size="sm"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Chat
          </Button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto py-2">
          {listLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">No chats yet</p>
              <p className="text-xs text-muted-foreground/60">
                Click "New Chat" to begin
              </p>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isActive={conv.id === selectedId}
                onSelect={() => handleSelect(conv.id)}
                onRename={(title) => handleRename(conv.id, title)}
                onDelete={() => handleDelete(conv.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Chat area ────────────────────────────────────────────────────────── */}
      <div ref={chatAreaRef} className="flex flex-1 flex-col overflow-hidden min-w-0">

        {/* Chat header */}
        <div className="flex flex-shrink-0 items-center gap-3 border-b border-border px-3 py-2.5 bg-card/50 sm:px-4 sm:py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? "Close conversations" : "Open conversations"}
          >
            {sidebarOpen ? (
              <ChevronLeft className="h-4 w-4" />
            ) : (
              <Menu className="h-4 w-4" />
            )}
          </Button>
          <h1 className="truncate text-sm font-medium text-foreground">
            {selectedId && activeConv
              ? (activeConv.title ?? "New conversation")
              : "Chat"}
          </h1>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {!selectedId ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <Bot className="h-7 w-7 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold sm:text-xl">
                  Start a conversation
                </h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-xs">
                  Click "New Chat" or select an existing conversation.
                </p>
              </div>
              <Button
                onClick={handleNewChat}
                disabled={createMutation.isPending}
                className="gap-2 mt-1"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                New Chat
              </Button>
            </div>
          ) : convLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <MessageSquare className="h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                Send a message to start
              </p>
              <p className="text-xs text-muted-foreground/60">
                Enter to send · Shift+Enter for newline
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3 sm:p-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {sendMutation.isPending && <ThinkingIndicator />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input area — safe area aware */}
        {selectedId && (
          <div
            className="flex-shrink-0 border-t border-border bg-background px-3 pt-3 pb-3 sm:px-4 sm:pt-4"
            style={{
              paddingBottom: "max(0.75rem, var(--safe-bottom))",
            }}
          >
            <div className="mx-auto max-w-3xl">
              <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mb-2 ml-2 h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-foreground"
                  title="Attach file (coming soon)"
                  onClick={() => toast.info("File upload coming soon")}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>

                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message AI Agent… (Enter to send)"
                  className="min-h-[44px] max-h-[160px] flex-1 resize-none border-0 bg-transparent p-3 pl-0 text-sm shadow-none focus-visible:ring-0"
                  rows={1}
                  disabled={sendMutation.isPending}
                />

                <Button
                  size="icon"
                  className="mb-2 mr-2 h-8 w-8 flex-shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim() || sendMutation.isPending}
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="mt-2 text-center text-[11px] text-muted-foreground/50 hidden sm:block">
                AI responses are generated by your configured provider. Configure in Settings → AI Providers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
