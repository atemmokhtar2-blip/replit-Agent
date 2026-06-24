import { useState, useRef, useEffect } from "react";
import {
  useGetProject,
  getGetProjectQueryKey,
  useCreateConversation,
  useSendMessage,
  useListConversations,
  useListMessages,
  getListMessagesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, Play, Settings, Send, Loader2, Bot, User } from "lucide-react";

// ── AI Chat Panel ──────────────────────────────────────────────────────────────

function AIChatPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListConversations({ project_id: projectId });

  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();

  const activeConversationId =
    conversationId ?? conversations?.items?.[0]?.id ?? null;

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
    if (!content || isSending) return;
    setInput("");
    setIsSending(true);

    try {
      const convId = await ensureConversation();
      await new Promise<void>((resolve, reject) => {
        sendMessage.mutate(
          { conversationId: convId, data: { content } },
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
    } finally {
      setIsSending(false);
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
          <div
            key={msg.id}
            className={`flex gap-2 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "assistant" && (
              <div className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-3 w-3 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs break-words ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-none"
                  : "bg-muted text-foreground rounded-tl-none"
              }`}
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {msg.content}
            </div>
            {msg.role === "user" && (
              <div className="mt-0.5 h-6 w-6 flex-shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-3 w-3 text-primary" />
              </div>
            )}
          </div>
        ))}
        {isSending && (
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
          disabled={isSending}
          className="flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Ask me to build something..."
        />
        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleSend}
          disabled={isSending || !input.trim()}
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

// ── Explorer panel (shared) ────────────────────────────────────────────────────

function ExplorerPanel() {
  return (
    <div className="p-4 h-full overflow-y-auto">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Explorer
      </h3>
      <div className="space-y-1 text-sm text-muted-foreground">
        {["index.tsx", "styles.css", "config.json"].map((f) => (
          <div
            key={f}
            className="px-2 py-1.5 rounded cursor-pointer hover:bg-muted hover:text-foreground transition-colors"
          >
            {f}
          </div>
        ))}
      </div>
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
              <ExplorerPanel />
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
              <AIChatPanel projectId={id || ""} />
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
            <ExplorerPanel />
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
            <AIChatPanel projectId={id || ""} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
