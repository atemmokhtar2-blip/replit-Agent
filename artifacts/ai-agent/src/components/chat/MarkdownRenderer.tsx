/**
 * MarkdownRenderer — Premium AI response engine.
 *
 * Supports:
 *  - Full GFM (tables, task lists, strikethrough, etc.)
 *  - Syntax-highlighted code blocks + copy button + language badge
 *  - Mermaid diagrams (lazy-loaded, auto-detected via language="mermaid")
 *  - LaTeX / KaTeX math (inline $…$ and block $$…$$)
 *  - GitHub-style callout blocks  > [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT] / [!CAUTION]
 *    ↳ rendered via a safe remark AST plugin — zero raw-HTML injection, zero XSS surface
 *  - Mobile-optimised: horizontal-scrolling tables & code, consistent spacing
 *
 * Security: rehypeRaw is intentionally NOT used. All transformations go through
 * the remark/rehype AST pipeline so no arbitrary HTML reaches the DOM.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { remarkCallouts } from "@/lib/remark-callouts";

// ── KaTeX CSS (injected once) ─────────────────────────────────────────────────

(function injectKatexCss() {
  if (typeof document === "undefined") return;
  if (document.getElementById("katex-css")) return;
  const link = document.createElement("link");
  link.id = "katex-css";
  link.rel = "stylesheet";
  link.href = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css";
  document.head.appendChild(link);
})();

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-all text-zinc-500 hover:text-zinc-200 hover:bg-white/10 active:scale-95"
      aria-label="نسخ الكود"
    >
      {copied ? (
        <>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1.5,5 3.5,7.5 8.5,2.5" />
          </svg>
          <span>تم النسخ</span>
        </>
      ) : (
        <>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
            <rect x="3" y="3" width="6" height="6" rx="1" />
            <path d="M2 7H1.5a1 1 0 01-1-1V1.5a1 1 0 011-1h4.5a1 1 0 011 1V2" />
          </svg>
          <span>نسخ</span>
        </>
      )}
    </button>
  );
}

// ── Mermaid diagram renderer ──────────────────────────────────────────────────

function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            background: "#111111",
            primaryColor: "#6366f1",
            primaryTextColor: "#e5e7eb",
            lineColor: "#4b5563",
            edgeLabelBackground: "#1f2937",
            fontSize: "13px",
          },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setRendered(true);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "خطأ في رسم المخطط");
      }
    }
    render();
    return () => { cancelled = true; };
  }, [code]);

  if (error) {
    return (
      <div className="my-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
        <p className="text-xs text-red-400/80">⚠ خطأ في رسم المخطط: {error}</p>
        <pre className="mt-2 text-[11px] text-zinc-500 overflow-x-auto whitespace-pre-wrap">{code}</pre>
      </div>
    );
  }

  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/[0.07] bg-[#0d0d0d] p-4">
      {!rendered && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="h-3 w-3 rounded-full border border-zinc-500 border-t-transparent animate-spin" />
          جاري رسم المخطط…
        </div>
      )}
      <div ref={ref} className="mermaid-output [&_svg]:max-w-full [&_svg]:h-auto" />
    </div>
  );
}

// ── Callout config ────────────────────────────────────────────────────────────

type CalloutType = "note" | "tip" | "warning" | "important" | "caution" | "info" | "success" | "error";

const CALLOUT_CONFIG: Record<CalloutType, {
  label: string;
  icon: string;
  border: string;
  bg: string;
  title: string;
}> = {
  note:      { label: "ملاحظة",  icon: "ℹ",  border: "border-blue-500/30",    bg: "bg-blue-500/5",    title: "text-blue-400"    },
  info:      { label: "معلومة",  icon: "ℹ",  border: "border-blue-500/30",    bg: "bg-blue-500/5",    title: "text-blue-400"    },
  tip:       { label: "نصيحة",   icon: "💡", border: "border-emerald-500/30", bg: "bg-emerald-500/5", title: "text-emerald-400" },
  success:   { label: "نجاح",    icon: "✓",  border: "border-emerald-500/30", bg: "bg-emerald-500/5", title: "text-emerald-400" },
  warning:   { label: "تحذير",   icon: "⚠",  border: "border-amber-500/30",   bg: "bg-amber-500/5",   title: "text-amber-400"   },
  caution:   { label: "تنبيه",   icon: "⚠",  border: "border-orange-500/30",  bg: "bg-orange-500/5",  title: "text-orange-400"  },
  important: { label: "مهم",     icon: "★",  border: "border-violet-500/30",  bg: "bg-violet-500/5",  title: "text-violet-400"  },
  error:     { label: "خطأ",     icon: "✕",  border: "border-red-500/30",     bg: "bg-red-500/5",     title: "text-red-400"     },
};

function CalloutBlock({ type, children }: { type: CalloutType; children: React.ReactNode }) {
  const cfg = CALLOUT_CONFIG[type] ?? CALLOUT_CONFIG.note;
  return (
    <div className={`my-4 rounded-xl border ${cfg.border} ${cfg.bg} px-4 py-3.5`}>
      <div className={`flex items-center gap-2 mb-2 text-xs font-semibold tracking-wide uppercase ${cfg.title}`}>
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
      </div>
      <div className="text-[0.875rem] text-foreground/85 leading-[1.75] [&>p:last-child]:mb-0">
        {children}
      </div>
    </div>
  );
}

// ── Component map ─────────────────────────────────────────────────────────────

const components: Components = {
  // ── Headings ───────────────────────────────────────────────────────────────
  h1: ({ children }) => (
    <h1 className="text-[1.15rem] font-bold text-foreground mt-7 mb-3 first:mt-0 leading-snug border-b border-border/30 pb-2">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-foreground mt-6 mb-2.5 first:mt-0 leading-snug">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[0.9rem] font-semibold text-foreground/90 mt-5 mb-2 first:mt-0 leading-snug">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium text-foreground/80 mt-4 mb-1.5 first:mt-0">
      {children}
    </h4>
  ),

  // ── Paragraph ──────────────────────────────────────────────────────────────
  p: ({ children }) => (
    <p className="text-[0.875rem] text-foreground leading-[1.85] mb-3.5 last:mb-0">
      {children}
    </p>
  ),

  // ── Emphasis ───────────────────────────────────────────────────────────────
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-foreground/85">{children}</em>
  ),
  del: ({ children }) => (
    <del className="line-through text-muted-foreground/60">{children}</del>
  ),

  // ── Lists ──────────────────────────────────────────────────────────────────
  ul: ({ children }) => (
    <ul className="mb-3.5 last:mb-0 space-y-1.5 pl-5 list-disc marker:text-muted-foreground/40">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3.5 last:mb-0 space-y-1.5 pl-5 list-decimal marker:text-muted-foreground/50 marker:text-[0.8rem]">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="text-[0.875rem] text-foreground leading-[1.75] pl-0.5">
      {children}
    </li>
  ),

  // ── Blockquote ─────────────────────────────────────────────────────────────
  // Note: callout blockquotes are intercepted earlier by remarkCallouts and
  // converted to <div data-callout="…"> hast nodes — they never reach here.
  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-primary/40 pl-4 pr-1 py-1 mb-3.5 last:mb-0 bg-muted/10 rounded-r-md">
      <div className="text-[0.875rem] text-muted-foreground/80 italic leading-relaxed [&>p:last-child]:mb-0">
        {children}
      </div>
    </blockquote>
  ),

  // ── Horizontal rule ────────────────────────────────────────────────────────
  hr: () => (
    <hr className="my-6 border-0 border-t border-border/30" />
  ),

  // ── Code — block & inline ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  code: ({ children, className, node, ...rest }) => {
    const match = /language-(\w+)/.exec(className || "");
    const rawText = String(children);
    const isBlock = match !== null || rawText.endsWith("\n");
    const codeText = rawText.replace(/\n$/, "");
    const language = match?.[1] ?? "";

    if (isBlock) {
      // Mermaid diagrams — rendered client-side via the mermaid library
      if (language === "mermaid") {
        return <MermaidDiagram code={codeText} />;
      }

      return (
        <div className="mb-4 last:mb-0 rounded-xl overflow-hidden border border-white/[0.07] bg-[#111111] shadow-sm">
          {/* Header: language badge + copy */}
          <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-white/[0.06]">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest select-none">
              {language || "code"}
            </span>
            <CopyButton text={codeText} />
          </div>
          {/* Syntax-highlighted body */}
          <div className="overflow-x-auto">
            <SyntaxHighlighter
              language={language || "text"}
              style={oneDark}
              customStyle={{
                margin: 0,
                padding: "1rem",
                background: "transparent",
                fontSize: "12.5px",
                lineHeight: "1.7",
                fontFamily: "'JetBrains Mono','Fira Code','Cascadia Code',ui-monospace,monospace",
              }}
              codeTagProps={{ style: { fontFamily: "inherit" } }}
              wrapLongLines={false}
            >
              {codeText}
            </SyntaxHighlighter>
          </div>
        </div>
      );
    }

    // Inline code
    return (
      <code className="px-1.5 py-[0.15em] rounded-md bg-muted/50 border border-border/40 text-[0.8em] font-mono text-foreground/90 align-baseline">
        {children}
      </code>
    );
  },

  // Pre wrapper — handled inside code component above
  pre: ({ children }) => <>{children}</>,

  // ── Tables ─────────────────────────────────────────────────────────────────
  table: ({ children }) => (
    <div className="mb-4 last:mb-0 overflow-x-auto rounded-xl border border-border/40 shadow-sm">
      <table className="w-full text-sm border-collapse min-w-[400px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/20 border-b border-border/40">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border/15 last:border-0 hover:bg-muted/10 transition-colors">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="px-3.5 py-2.5 text-left text-xs font-semibold text-foreground/60 uppercase tracking-wide whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3.5 py-2.5 text-[0.875rem] text-foreground/80 leading-relaxed">
      {children}
    </td>
  ),

  // ── Links ──────────────────────────────────────────────────────────────────
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/75 underline underline-offset-[3px] decoration-primary/40 hover:decoration-primary/70 transition-colors"
    >
      {children}
    </a>
  ),

  // ── Callout div — produced by remarkCallouts AST plugin ────────────────────
  // remarkCallouts rewrites matching blockquote nodes to hast <div data-callout="…">
  // elements before any HTML reaches the DOM. rehypeRaw is NOT used.
  div: ({ children, ...props }) => {
    const calloutType = (props as Record<string, unknown>)["data-callout"] as CalloutType | undefined;
    if (calloutType && CALLOUT_CONFIG[calloutType]) {
      return <CalloutBlock type={calloutType}>{children}</CalloutBlock>;
    }
    // Plain div passthrough (e.g. from KaTeX display math wrappers)
    return <div {...(props as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCallouts]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
