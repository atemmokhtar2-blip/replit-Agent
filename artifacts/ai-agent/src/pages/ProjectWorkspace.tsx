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
import { ChevronLeft, Play, Settings, Send, Loader2, Bot, User } from "lucide-react";

// ─── AI Chat Panel ─────────────────────────────────────────────────────────────

function AIChatPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: conversations } = useListConversations({ project_id: projectId });

  const createConversation = useCreateConversation();
  const sendMessage = useSendMessage();

  const activeConversationId = conversationId ?? conversations?.items?.[0]?.id ?? null;

  const { data: messagesData } = useListMessages(
    activeConversationId ?? "",
    { query: { enabled: !!activeConversationId, queryKey: getListMessagesQueryKey(activeConversationId ?? "") } }
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
              queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(convId) });
              resolve();
            },
            onError: reject,
          }
        );
      });
    } catch {
      // error handled by mutation
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
    <div className="p-4 h-full flex flex-col">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        AI Assistant
      </h3>

      {/* Messages */}
      <div className="flex-1 bg-background rounded-lg border border-border p-3 mb-3 overflow-y-auto space-y-3 min-h-0">
        {messages.length === 0 && !activeConversationId && (
          <div className="text-xs text-muted-foreground text-center pt-4">
            <Bot className="h-6 w-6 mx-auto mb-2 opacity-50" />
            <p>Ask me to help build this project.</p>
            <p className="mt-1 opacity-70">Configure an AI provider in Settings first.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Bot className="h-3 w-3 text-primary" />
              </div>
            )}
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-tr-none"
                  : "bg-muted text-foreground rounded-tl-none"
              }`}
              style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {msg.content}
            </div>
            {msg.role === "user" && (
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <User className="h-3 w-3 text-primary" />
              </div>
            )}
          </div>
        ))}
        {isSending && (
          <div className="flex gap-2 justify-start">
            <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Bot className="h-3 w-3 text-primary" />
            </div>
            <div className="bg-muted rounded-lg rounded-tl-none px-3 py-2 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Ask me to build something..."
        />
        <Button
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleSend}
          disabled={isSending || !input.trim()}
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

// ─── Main Workspace ────────────────────────────────────────────────────────────

export default function ProjectWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { data: project, isLoading } = useGetProject(id || "", {
    query: { enabled: !!id, queryKey: getGetProjectQueryKey(id || "") },
  });

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-8 w-[200px]" /></div>;
  }

  if (!project) return <div className="p-8 text-muted-foreground">Project not found</div>;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top Toolbar */}
      <header className="h-14 border-b border-border flex items-center justify-between px-4 bg-card flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{project.name}</span>
            <span className="px-2 py-0.5 rounded-full bg-muted text-xs text-muted-foreground capitalize">
              {project.status}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings">
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" /> Settings
            </Button>
          </Link>
          <Button variant="default" size="sm">
            <Play className="mr-2 h-4 w-4" /> Deploy
          </Button>
        </div>
      </header>

      {/* Main IDE Area */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* File Explorer */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="bg-card/50 border-r">
            <div className="p-4 h-full">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Explorer</h3>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div className="px-2 py-1 rounded cursor-pointer hover:bg-muted hover:text-foreground">index.tsx</div>
                <div className="px-2 py-1 rounded cursor-pointer hover:bg-muted hover:text-foreground">styles.css</div>
                <div className="px-2 py-1 rounded cursor-pointer hover:bg-muted hover:text-foreground">config.json</div>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle />

          {/* Editor + Terminal */}
          <ResizablePanel defaultSize={55}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={70} className="bg-background">
                <div className="p-4 h-full flex flex-col">
                  <div className="flex border-b border-border mb-4">
                    <div className="px-4 py-2 border-b-2 border-primary text-sm font-medium">index.tsx</div>
                  </div>
                  <div className="flex-1 font-mono text-sm text-muted-foreground p-4 bg-muted/20 rounded-lg border border-border">
                    {`// Write your code here\nexport default function App() {\n  return <div>Hello World</div>;\n}`}
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={30} className="bg-card border-t">
                <div className="p-4 h-full">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Terminal</h3>
                  <div className="font-mono text-xs text-muted-foreground space-y-1">
                    <div>$ npm run build</div>
                    <div>&gt; Building application...</div>
                    <div className="text-primary">✓ Success</div>
                  </div>
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
          <ResizableHandle />

          {/* AI Chat Panel */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={40} className="bg-card/50 border-l">
            <AIChatPanel projectId={id || ""} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
