/**
 * GeneratedFilesPanel — shows files actually written to disk by the execution
 * pipeline. Fetched from /api/v1/ai/projects/:conversationId/files/download.
 *
 * Features:
 *  - File tree grouped by directory
 *  - Preview selected file content
 *  - Download individual file
 *  - Download all as ZIP (via jszip)
 */
import { useState, useEffect, useCallback } from "react";
import JSZip from "jszip";

interface RemoteFile {
  path: string;
  content: string;
  size: number;
  extension: string;
}

interface GeneratedFilesPanelProps {
  conversationId: string;
  onClose?: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fileIcon(ext: string): string {
  const map: Record<string, string> = {
    ts: "TS", tsx: "⚛", js: "JS", jsx: "⚛",
    css: "CS", scss: "CS", html: "HT", json: "{}",
    md: "MD", sql: "DB", py: "PY", go: "GO",
    rs: "RS", env: "EN", sh: "SH", yml: "YM", yaml: "YM",
    txt: "TX", png: "IM", svg: "SV",
  };
  return map[ext?.toLowerCase()] ?? "FI";
}

function fileIconColor(ext: string): string {
  const map: Record<string, string> = {
    ts: "bg-sky-500/20 text-sky-400",
    tsx: "bg-violet-500/20 text-violet-400",
    js: "bg-yellow-500/20 text-yellow-400",
    jsx: "bg-yellow-500/20 text-yellow-400",
    css: "bg-pink-500/20 text-pink-400",
    html: "bg-orange-500/20 text-orange-400",
    json: "bg-amber-500/20 text-amber-400",
    sql: "bg-blue-500/20 text-blue-400",
    py: "bg-green-500/20 text-green-400",
    md: "bg-zinc-500/20 text-zinc-400",
  };
  return map[ext?.toLowerCase()] ?? "bg-zinc-600/20 text-zinc-400";
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function downloadBlob(content: string, filename: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── File tree node ─────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  ext?: string;
  size?: number;
  content?: string;
  children?: TreeNode[];
}

function buildTree(files: RemoteFile[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "dir", children: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      if (isLast) {
        node.children = node.children ?? [];
        node.children.push({
          name: part,
          path: file.path,
          type: "file",
          ext: file.extension,
          size: file.size,
          content: file.content,
        });
      } else {
        node.children = node.children ?? [];
        let dir = node.children.find((c) => c.name === part && c.type === "dir");
        if (!dir) {
          dir = { name: part, path: parts.slice(0, i + 1).join("/"), type: "dir", children: [] };
          node.children.push(dir);
        }
        node = dir;
      }
    }
  }

  return root.children ?? [];
}

function TreeNodeItem({
  node,
  depth,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (file: TreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.type === "dir") {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-muted/20 transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded((v) => !v)}
        >
          <svg
            width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round"
            className={`flex-shrink-0 text-muted-foreground/50 transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <polyline points="2,1 6,4 2,7" />
          </svg>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="flex-shrink-0 text-yellow-500/60">
            <path d="M1 3a1 1 0 011-1h3l1 1h5a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" fill="currentColor" opacity="0.2" />
            <path d="M1 3a1 1 0 011-1h3l1 1h5a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V3z" />
          </svg>
          <span className="text-[11px] text-foreground/70 font-medium truncate">{node.name}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/30">{node.children?.length ?? 0}</span>
        </button>
        {expanded && node.children?.map((child) => (
          <TreeNodeItem key={child.path} node={child} depth={depth + 1} selected={selected} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  const iconClass = fileIconColor(node.ext ?? "");
  const isSelected = selected === node.path;

  return (
    <button
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors ${
        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted/20 text-foreground/70"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onSelect(node)}
    >
      <span className={`flex-shrink-0 flex h-4 w-5 items-center justify-center rounded text-[8px] font-bold ${iconClass}`}>
        {fileIcon(node.ext ?? "")}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px]">{node.name}</span>
      {node.size != null && (
        <span className="flex-shrink-0 text-[9px] text-muted-foreground/30">{humanSize(node.size)}</span>
      )}
    </button>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function GeneratedFilesPanel({ conversationId, onClose }: GeneratedFilesPanelProps) {
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [activeTab, setActiveTab] = useState<"tree" | "preview">("tree");

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("access_token");
      const res = await fetch(`/api/v1/ai/projects/${conversationId}/files/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" })) as { error?: string };
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

  useEffect(() => { void fetchFiles(); }, [fetchFiles]);

  const handleDownloadAll = async () => {
    if (files.length === 0) return;
    setDownloading(true);
    try {
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.path, file.content);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${conversationId.slice(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadFile = (node: TreeNode) => {
    if (node.content == null) return;
    downloadBlob(node.content, node.name);
  };

  const tree = buildTree(files);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-4 py-3 bg-card/50">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3" className="text-primary flex-shrink-0">
          <path d="M1 2a1 1 0 011-1h4l1.5 1.5H12a1 1 0 011 1V11a1 1 0 01-1 1H2a1 1 0 01-1-1V2z" />
        </svg>
        <span className="flex-1 text-sm font-semibold text-foreground">Generated Files</span>
        {files.length > 0 && (
          <span className="text-[10px] text-muted-foreground/50">{files.length} file{files.length !== 1 ? "s" : ""}</span>
        )}
        <button
          onClick={handleDownloadAll}
          disabled={files.length === 0 || downloading}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/30 disabled:opacity-40 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <path d="M5 1v6M2 7l3 2 3-2M1 9h8" />
          </svg>
          {downloading ? "Zipping…" : "Download ZIP"}
        </button>
        {onClose && (
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <line x1="1" y1="1" x2="11" y2="11" /><line x1="11" y1="1" x2="1" y2="11" />
            </svg>
          </button>
        )}
      </div>

      {/* Tabs */}
      {selected && (
        <div className="flex flex-shrink-0 border-b border-border bg-card/30 px-4">
          {(["tree", "preview"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative px-3 py-2 text-xs font-medium capitalize transition-colors ${
                activeTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {activeTab === tab && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary rounded-t" />}
            </button>
          ))}
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Tree */}
        <div className={`overflow-y-auto py-2 ${selected && activeTab === "preview" ? "hidden" : "flex-1"} ${selected && activeTab === "tree" ? "border-r border-border w-56 flex-shrink-0" : ""}`}>
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
              <button onClick={fetchFiles} className="mt-2 text-xs text-primary hover:underline">Retry</button>
            </div>
          ) : files.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-2xl mb-2">🗂️</div>
              <p className="text-xs text-muted-foreground">No generated files yet</p>
              <p className="text-[10px] text-muted-foreground/50 mt-1">Files appear after execution completes</p>
            </div>
          ) : (
            <div className="min-w-0">
              {tree.map((node) => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selected={selected?.path ?? null}
                  onSelect={(n) => { setSelected(n); setActiveTab("preview"); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        {selected && activeTab === "preview" && (
          <div className="flex flex-1 flex-col overflow-hidden min-w-0">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-border px-3 py-2 bg-card/30">
              <span className={`flex h-4 w-5 items-center justify-center rounded text-[8px] font-bold flex-shrink-0 ${fileIconColor(selected.ext ?? "")}`}>
                {fileIcon(selected.ext ?? "")}
              </span>
              <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-foreground/80">{selected.path}</span>
              {selected.size != null && (
                <span className="text-[10px] text-muted-foreground/40">{humanSize(selected.size)}</span>
              )}
              <button
                onClick={() => handleDownloadFile(selected)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                  <path d="M4.5 1v5M2 6l2.5 2 2.5-2M1 8h7" />
                </svg>
                Download
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[11px] font-mono text-zinc-300 leading-relaxed bg-zinc-950/60">
              {selected.content ?? "(empty)"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
