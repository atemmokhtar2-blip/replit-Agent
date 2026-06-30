import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetProject,
  getGetProjectQueryKey,
  useCreateConversation,
  useListConversations,
  useListMessages,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { sendToPlannerEngine } from "@/lib/planner-api";
import { useParams, Link } from "wouter";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Play, Settings, Send, Loader2, Bot, User, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// ── Workspace message bubble ────────────────────────────────────────────────────

function WorkspaceMessageBubble({ msg }: { msg: { id: string; role: string; content: string } }) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const doIt = () => {
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    };
    navigator.clipboard.writeText(msg.content).then(doIt).catch(() => {
      const el = document.createElement("textarea");
      el.value = msg.content;
      el.style.position = "fixed";
      el.style.left = "-9999px";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      doIt();
    });
  };

  return (
    <div className={`flex gap-2 group ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-3 w-3 text-primary" />
        </div>
      )}
      <div
        className={`relative max-w-[85%] rounded-lg px-3 py-2 text-xs break-words ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-none"
            : "bg-muted text-foreground rounded-tl-none pr-7"
        }`}
        style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {!isUser && (
          <button
            onClick={handleCopy}
            aria-label={copied ? "Copied!" : "Copy message"}
            title={copied ? "Copied!" : "Copy message"}
            className="absolute right-1.5 top-1.5 rounded p-0.5 opacity-100 transition-opacity text-muted-foreground hover:text-foreground hover:bg-background/60"
          >
            {copied ? (
              <span className="flex items-center gap-0.5 text-[9px] font-semibold text-green-500">
                <Check className="h-2.5 w-2.5 flex-shrink-0" />
                Copied
              </span>
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        )}
        {msg.content}
      </div>
      {isUser && (
        <div className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="h-3 w-3 text-primary" />
        </div>
      )}
    </div>
  );
}

// ── AI Chat Panel ──────────────────────────────────────────────────────────────

function AIChatPanel({
  projectId,
  onActiveConversation,
}: {
  projectId: string;
  onActiveConversation?: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListConversations({ project_id: projectId });

  const createConversation = useCreateConversation();
  const plannerMutation = useMutation({
    mutationFn: ({ message, conversationId }: { message: string; conversationId: string }) =>
      sendToPlannerEngine(message, conversationId),
  });

  const activeConversationId =
    conversationId ?? conversations?.items?.[0]?.id ?? null;

  useEffect(() => {
    onActiveConversation?.(activeConversationId);
  }, [activeConversationId, onActiveConversation]);

  const { data: messagesData } = useListMessages(
    activeConversationId ?? "",
    {
      query: {
        enabled: !!activeConversationId,
        queryKey: getListMessagesQueryKey(activeConversationId ?? ""),
      },
    }
  );

  const messages = messagesData?.items ?? [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const ensureConversation = async (): Promise<string> => {
    if (activeConversationId) return activeConversationId;
    return new Promise((resolve, reject) => {
      createConversation.mutate(
        { data: { project_id: projectId, title: "Workspace Chat" } },
        {
          onSuccess: (c) => {
            setConversationId(c.id);
            resolve(c.id);
          },
          onError: reject,
        }
      );
    });
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || plannerMutation.isPending) return;
    setInput("");

    try {
      const convId = await ensureConversation();
      await new Promise<void>((resolve, reject) => {
        plannerMutation.mutate(
          { message: content, conversationId: convId },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({
                queryKey: getListMessagesQueryKey(convId),
              });
              resolve();
            },
            onError: reject,
          }
        );
      });
    } catch {
      // handled by mutation
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col p-3 sm:p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        AI Assistant
      </h3>

      <div className="mb-3 flex-1 overflow-y-auto rounded-lg border border-border bg-background p-3 space-y-3 min-h-0">
        {messages.length === 0 && !activeConversationId && (
          <div className="pt-4 text-center text-xs text-muted-foreground">
            <Bot className="mx-auto mb-2 h-6 w-6 opacity-50" />
            <p>Ask me to help build this project.</p>
            <p className="mt-1 opacity-70">
              Configure an AI provider in Settings first.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <WorkspaceMessageBubble key={msg.id} msg={msg} />
        ))}
        {plannerMutation.isPending && (
          <div className="flex gap-2">
            <div className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-3 w-3 text-primary" />
            </div>
            <div className="rounded-lg rounded-tl-none bg-muted px-3 py-2 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={plannerMutation.isPending}
          className="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Ask me to build something..."
        />
        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleSend}
          disabled={plannerMutation.isPending || !input.trim()}
        >
          {plannerMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Explorer panel — connected to real generated files ─────────────────────────

interface RemoteFile { path: string; content: string; size: number; extension: string }

function extBadge(ext: string): { label: string; cls: string } {
  const m: Record<string, { label: string; cls: string }> = {
    ts:   { label: "TS",  cls: "bg-sky-500/20 text-sky-400" },
    tsx:  { label: "⚛",  cls: "bg-violet-500/20 text-violet-400" },
    js:   { label: "JS",  cls: "bg-yellow-500/20 text-yellow-400" },
    jsx:  { label: "⚛",  cls: "bg-yellow-500/20 text-yellow-400" },
    css:  { label: "CS",  cls: "bg-pink-500/20 text-pink-400" },
    html: { label: "HT",  cls: "bg-orange-500/20 text-orange-400" },
    json: { label: "{}",  cls: "bg-amber-500/20 text-amber-400" },
    md:   { label: "MD",  cls: "bg-muted/40 text-muted-foreground" },
    sql:  { label: "DB",  cls: "bg-blue-500/20 text-blue-400" },
    py:   { label: "PY",  cls: "bg-green-500/20 text-green-400" },
    sh:   { label: "SH",  cls: "bg-emerald-500/20 text-emerald-400" },
    env:  { label: "EN",  cls: "bg-orange-500/20 text-orange-400" },
  };
  return m[ext?.toLowerCase()] ?? { label: "FI", cls: "bg-muted/30 text-muted-foreground" };
}

function humanSize(b: number) {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

function authHdr(): Record<string, string> {
  const tok = localStorage.getItem("access_token");
  return tok ? { Authorization: `Bearer ${tok}` } : {};
}

function ExplorerPanel({ conversationId }: { conversationId: string | null }) {
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RemoteFile | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/ai/projects/${conversationId}/files/download`, {
        headers: authHdr(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { files?: RemoteFile[] };
      setFiles(data.files ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { void load(); }, [load]);

  const handleCopy = async () => {
    if (!selected?.content) return;
    await navigator.clipboard.writeText(selected.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!conversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-muted-foreground/30 mb-3">
          <path d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
        </svg>
        <p className="text-xs text-muted-foreground/50">No project yet</p>
        <p className="text-[10px] text-muted-foreground/35 mt-1">Use the AI assistant to generate files</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Files {files.length > 0 && <span className="ml-1 text-muted-foreground/50">({files.length})</span>}
        </span>
        <button
          onClick={() => void load()}
          disabled={loading}
          title="Refresh"
          className="rounded p-1 text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        </div>
      ) : error ? (
        <div className="px-4 py-8 text-center">
          <p className="text-xs text-red-400">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-xs text-primary hover:underline">Retry</button>
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-muted-foreground/30 mb-2">
            <path d="M2 5a2 2 0 012-2h5l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V5z"/>
          </svg>
          <p className="text-[11px] text-muted-foreground/50">No files yet</p>
          <p className="text-[10px] text-muted-foreground/35 mt-1">Run a generation first</p>
        </div>
      ) : selected ? (
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/10 flex-shrink-0">
            <button
              onClick={() => setSelected(null)}
              className="text-muted-foreground/50 hover:text-foreground transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><polyline points="6,1 2,5 6,9"/></svg>
            </button>
            <span className="flex-1 truncate font-mono text-[10px] text-foreground/60">{selected.path}</span>
            <button onClick={() => void handleCopy()} title="Copy" className="rounded p-0.5 text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 transition-colors">
              {copied ? <Check className="h-3 w-3 text-green-400"/> : <Copy className="h-3 w-3"/>}
            </button>
          </div>
          <pre className="flex-1 overflow-auto p-3 text-[10px] font-mono text-foreground/70 leading-relaxed">
            {selected.content || <span className="text-muted-foreground/40">(empty file)</span>}
          </pre>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {files.map((f) => {
            const { label, cls } = extBadge(f.extension);
            return (
              <button
                key={f.path}
                onClick={() => setSelected(f)}
                className="flex w-full items-center gap-2 px-3 py-[5px] hover:bg-muted/20 transition-colors text-left"
              >
                <span className={`flex h-4 w-5 flex-shrink-0 items-center justify-center rounded text-[8px] font-bold ${cls}`}>
                  {label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/65">
                  {f.path}
                </span>
                <span className="flex-shrink-0 text-[9px] text-muted-foreground/25">{humanSize(f.size)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Editor panel (shared) ──────────────────────────────────────────────────────

function EditorPanel() {
  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex border-b border-border mb-4">
        <div className="px-4 py-2 border-b-2 border-primary text-sm font-medium">
          index.tsx
        </div>
      </div>
      <div className="flex-1 min-h-0 font-mono text-sm text-muted-foreground p-4 bg-muted/20 rounded-lg border border-border overflow-auto">
        {`// Write your code here\nexport default function App() {\n  return <div>Hello World</div>;\n}`}
      </div>
    </div>
  );
}

// ── Terminal panel (shared) ────────────────────────────────────────────────────

function TerminalPanel() {
  return (
    <div className="p-4 h-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Terminal
      </h3>
      <div className="font-mono text-xs text-muted-foreground space-y-1">
        <div>$ npm run build</div>
        <div>&gt; Building application...</div>
        <div className="text-primary">✓ Success</div>
      </div>
    </div>
  );
}

// ── Shared toolbar ─────────────────────────────────────────────────────────────

function WorkspaceToolbar({
  projectName,
  projectStatus,
}: {
  projectName: string;
  projectStatus: string;
}) {
  return (
    <header className="h-[var(--header-height)] flex-shrink-0 border-b border-border flex items-center justify-between px-3 sm:px-4 bg-card">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        <Link href="/projects">
          <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold text-sm truncate">{projectName}</span>
          <span className="flex-shrink-0 hidden xs:inline-flex px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground capitalize">
            {projectStatus}
          </span>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
        <Link href="/settings">
          <Button variant="outline" size="sm" className="hidden sm:flex">
            <Settings className="mr-2 h-4 w-4" /> Settings
          </Button>
          <Button variant="outline" size="icon" className="flex sm:hidden h-8 w-8">
            <Settings className="h-4 w-4" />
          </Button>
        </Link>
        <Button variant="default" size="sm">
          <Play className="mr-2 h-4 w-4" />
          <span className="hidden xs:inline">Deploy</span>
        </Button>
      </div>
    </header>
  );
}

// ── Main Workspace ─────────────────────────────────────────────────────────────

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useGetProject(id || "", {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id || "") },
  });

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="p-6 sm:p-8">
        <Skeleton className="h-8 w-[200px]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 sm:p-8 text-muted-foreground">
        Project not found
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-background"
      style={{ height: "100dvh" }}
    >
      <WorkspaceToolbar
        projectName={project.name}
        projectStatus={project.status}
      />

      {/* ── Mobile/tablet: tab layout ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden lg:hidden">
        <Tabs defaultValue="editor" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-3 mt-2 mb-0 flex-shrink-0 grid grid-cols-4 h-9">
            <TabsTrigger value="explorer" className="text-xs">Files</TabsTrigger>
            <TabsTrigger value="editor" className="text-xs">Editor</TabsTrigger>
            <TabsTrigger value="terminal" className="text-xs">Terminal</TabsTrigger>
            <TabsTrigger value="ai" className="text-xs">AI</TabsTrigger>
          </TabsList>

          <TabsContent
            value="explorer"
            className="flex-1 overflow-hidden m-0 mt-0 data-[state=active]:flex flex-col"
          >
            <div className="flex-1 overflow-hidden bg-card/50">
              <ExplorerPanel conversationId={activeConversationId} />
            </div>
          </TabsContent>

          <TabsContent
            value="editor"
            className="flex-1 overflow-hidden m-0 mt-0 data-[state=active]:flex flex-col"
          >
            <div className="flex-1 overflow-hidden bg-background">
              <EditorPanel />
            </div>
          </TabsContent>

          <TabsContent
            value="terminal"
            className="flex-1 overflow-hidden m-0 mt-0 data-[state=active]:flex flex-col"
          >
            <div className="flex-1 overflow-hidden bg-card">
              <TerminalPanel />
            </div>
          </TabsContent>

          <TabsContent
            value="ai"
            className="flex-1 overflow-hidden m-0 mt-0 data-[state=active]:flex flex-col"
          >
            <div className="flex-1 overflow-hidden bg-card/50">
              <AIChatPanel
                projectId={id || ""}
                onActiveConversation={setActiveConversationId}
              />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Desktop: resizable IDE layout ────────────────────────────────────── */}
      <div className="hidden lg:flex flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            defaultSize={18}
            minSize={12}
            maxSize={28}
            className="bg-card/50 border-r"
          >
            <ExplorerPanel conversationId={activeConversationId} />
          </ResizablePanel>
          <ResizableHandle />

          <ResizablePanel defaultSize={57}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={70} className="bg-background">
                <EditorPanel />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={30} className="bg-card border-t">
                <TerminalPanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />

          <ResizablePanel
            defaultSize={25}
            minSize={20}
            maxSize={40}
            className="bg-card/50 border-l"
          >
            <AIChatPanel
              projectId={id || ""}
              onActiveConversation={setActiveConversationId}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
