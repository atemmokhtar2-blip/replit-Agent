/**
 * MarkdownRenderer — premium markdown with syntax-highlighted code blocks,
 * copy buttons, tables, and all GFM features.
 */
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

// ── Copy button ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={handle}
      className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60 transition-colors"
      aria-label="Copy code"
    >
      {copied ? (
        <>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5 3.5,7.5 8.5,2.5" />
          </svg>
          Copied
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="0.8" />
            <path d="M2 6.5H1.5a1 1 0 01-1-1V1.5a1 1 0 011-1h4a1 1 0 011 1V2" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

// ── Code block with language badge + copy ──────────────────────────────────────

const LANG_COLORS: Record<string, string> = {
  tsx: "text-sky-400",
  ts: "text-sky-400",
  typescript: "text-sky-400",
  jsx: "text-violet-400",
  js: "text-yellow-400",
  javascript: "text-yellow-400",
  python: "text-green-400",
  py: "text-green-400",
  go: "text-cyan-400",
  rust: "text-orange-400",
  rs: "text-orange-400",
  sql: "text-blue-400",
  bash: "text-emerald-400",
  sh: "text-emerald-400",
  css: "text-pink-400",
  html: "text-orange-400",
  json: "text-yellow-300",
  yaml: "text-amber-400",
  yml: "text-amber-400",
  markdown: "text-zinc-400",
  md: "text-zinc-400",
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const displayLang = lang || "code";
  const langColor = LANG_COLORS[lang.toLowerCase()] ?? "text-zinc-400";

  return (
    <div className="relative my-3 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-lg">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/80 bg-zinc-900">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
            <div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          </div>
          <span className={`text-[11px] font-mono font-medium ${langColor}`}>{displayLang}</span>
        </div>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] font-mono text-zinc-200 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

// ── Markdown components ────────────────────────────────────────────────────────

const components: Components = {
  // Code: inline vs block
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const isBlock = "node" in props && (props.node as { type?: string })?.type === undefined
      ? false
      : className?.startsWith("language-");
    const code = String(children).replace(/\n$/, "");

    if (isBlock || match) {
      return <CodeBlock lang={match?.[1] ?? ""} code={code} />;
    }
    return (
      <code className="rounded-md bg-zinc-800/70 px-1.5 py-0.5 font-mono text-[0.85em] text-violet-300 border border-zinc-700/50">
        {children}
      </code>
    );
  },

  pre({ children }) {
    // If the child is our CodeBlock, just pass through
    return <>{children}</>;
  },

  // Headings
  h1({ children }) {
    return <h1 className="mt-5 mb-3 text-lg font-bold text-foreground border-b border-border/40 pb-1">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mt-4 mb-2 text-base font-semibold text-foreground">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="mt-3 mb-1.5 text-sm font-semibold text-foreground/90">{children}</h3>;
  },
  h4({ children }) {
    return <h4 className="mt-2 mb-1 text-sm font-medium text-foreground/80">{children}</h4>;
  },

  // Paragraph
  p({ children }) {
    return <p className="mb-3 leading-relaxed text-foreground/90 last:mb-0">{children}</p>;
  },

  // Lists
  ul({ children }) {
    return <ul className="mb-3 ml-4 space-y-1 list-disc marker:text-muted-foreground/50">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-3 ml-4 space-y-1 list-decimal marker:text-muted-foreground/50">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-foreground/90 leading-relaxed pl-1">{children}</li>;
  },

  // Blockquote
  blockquote({ children }) {
    return (
      <blockquote className="my-3 border-l-2 border-primary/40 pl-4 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },

  // Table
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-muted/40">{children}</thead>;
  },
  th({ children }) {
    return <th className="border-b border-border/40 px-3 py-2 text-left text-xs font-semibold text-foreground/70 uppercase tracking-wide">{children}</th>;
  },
  td({ children }) {
    return <td className="border-b border-border/20 px-3 py-2 text-xs text-foreground/80">{children}</td>;
  },

  // Strong / em
  strong({ children }) {
    return <strong className="font-semibold text-foreground">{children}</strong>;
  },
  em({ children }) {
    return <em className="italic text-foreground/80">{children}</em>;
  },

  // Horizontal rule
  hr() {
    return <hr className="my-4 border-border/40" />;
  },

  // Links
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
      >
        {children}
      </a>
    );
  },
};

// ── Main export ────────────────────────────────────────────────────────────────

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`prose-sm ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
