/**
 * MarkdownRenderer — full Markdown support (ChatGPT-style).
 * Supports: headings, bold/italic, bullet & numbered lists,
 * code blocks with copy button, tables, blockquotes, links, hr.
 */

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

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
      className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors text-zinc-400 hover:text-zinc-200 hover:bg-white/10"
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
            <rect x="3" y="3" width="6" height="6" rx="1" />
            <path d="M2 7H1.5a1 1 0 01-1-1V1.5a1 1 0 011-1h4.5a1 1 0 011 1V2" />
          </svg>
          Copy
        </>
      )}
    </button>
  );
}

const components: Components = {
  // Headings
  h1: ({ children }) => (
    <h1 className="text-xl font-bold text-foreground mt-5 mb-3 first:mt-0 leading-snug border-b border-border/40 pb-2">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-foreground mt-5 mb-2.5 first:mt-0 leading-snug">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-foreground/90 mt-4 mb-2 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium text-foreground/80 mt-3 mb-1.5 first:mt-0">
      {children}
    </h4>
  ),

  // Paragraph
  p: ({ children }) => (
    <p className="text-sm text-foreground leading-relaxed mb-3 last:mb-0">
      {children}
    </p>
  ),

  // Bold / Italic
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-foreground/85">{children}</em>
  ),

  // Unordered list
  ul: ({ children }) => (
    <ul className="mb-3 last:mb-0 space-y-1 pl-5 list-disc marker:text-muted-foreground/50">
      {children}
    </ul>
  ),

  // Ordered list
  ol: ({ children }) => (
    <ol className="mb-3 last:mb-0 space-y-1 pl-5 list-decimal marker:text-muted-foreground/60 marker:text-[11px]">
      {children}
    </ol>
  ),

  // List item — works for both ul and ol via native semantics
  li: ({ children }) => (
    <li className="text-sm text-foreground leading-relaxed">
      {children}
    </li>
  ),

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/30 pl-4 py-0.5 mb-3 last:mb-0 text-sm text-muted-foreground/80 italic">
      {children}
    </blockquote>
  ),

  // Horizontal rule
  hr: () => (
    <hr className="my-4 border-none border-t border-border/40" />
  ),

  // Code — block (fenced) and inline
  // react-markdown wraps fenced code in <pre><code>; block code always ends with \n
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  code: ({ children, className, node, ...rest }) => {
    const match = /language-(\w+)/.exec(className || "");
    const rawText = String(children);
    // Detect block code: has an explicit language class OR trailing newline (fenced without lang)
    const isBlock = match !== null || rawText.endsWith("\n");
    const codeText = rawText.replace(/\n$/, "");

    if (isBlock) {
      const language = match?.[1] ?? "";
      return (
        <div className="mb-3 last:mb-0 rounded-xl overflow-hidden border border-border/30 bg-[#0d0d0d]">
          {/* Header bar */}
          <div className="flex items-center justify-between px-4 py-2 bg-white/[0.03] border-b border-border/20">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
              {language || "code"}
            </span>
            <CopyButton text={codeText} />
          </div>
          {/* Code */}
          <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed font-mono text-zinc-200 m-0">
            <code>{codeText}</code>
          </pre>
        </div>
      );
    }

    // Inline
    return (
      <code className="px-1.5 py-0.5 rounded-md bg-muted/60 border border-border/40 text-[12px] font-mono text-foreground/90">
        {children}
      </code>
    );
  },

  // Pre — handled inside code above for blocks
  pre: ({ children }) => <>{children}</>,

  // Table
  table: ({ children }) => (
    <div className="mb-3 last:mb-0 overflow-x-auto rounded-lg border border-border/40">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/30 border-b border-border/40">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border/20 last:border-0 hover:bg-muted/10 transition-colors">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-foreground/70 uppercase tracking-wide">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-sm text-foreground/80">{children}</td>
  ),

  // Links
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors"
    >
      {children}
    </a>
  ),
};

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
