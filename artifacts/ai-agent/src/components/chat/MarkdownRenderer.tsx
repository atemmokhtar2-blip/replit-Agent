/**
 * MarkdownRenderer — plain, clean text output. No boxes, no colors, no badges.
 * Just readable prose the same way a normal chat app shows messages.
 */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  // Code: inline stays inline, blocks just use a monospace pre
  code({ className, children }) {
    const isBlock = className?.startsWith("language-");
    const code = String(children).replace(/\n$/, "");
    if (isBlock) {
      return (
        <pre className="my-2 overflow-x-auto rounded bg-muted/40 px-3 py-2 text-[13px] font-mono leading-relaxed whitespace-pre-wrap">
          <code>{code}</code>
        </pre>
      );
    }
    return (
      <code className="font-mono text-[0.9em] bg-muted/40 rounded px-1">
        {children}
      </code>
    );
  },

  pre({ children }) {
    return <>{children}</>;
  },

  // Headings — same weight as bold text, no separators
  h1({ children }) { return <p className="mb-2 font-semibold">{children}</p>; },
  h2({ children }) { return <p className="mb-2 font-semibold">{children}</p>; },
  h3({ children }) { return <p className="mb-1 font-medium">{children}</p>; },
  h4({ children }) { return <p className="mb-1 font-medium">{children}</p>; },

  // Paragraphs
  p({ children }) {
    return <p className="mb-2 leading-relaxed last:mb-0">{children}</p>;
  },

  // Lists — plain, no markers with color
  ul({ children }) { return <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>; },
  ol({ children }) { return <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>; },
  li({ children }) { return <li className="leading-relaxed">{children}</li>; },

  // Blockquote — subtle indent, no colored border
  blockquote({ children }) {
    return (
      <blockquote className="my-2 ml-3 pl-3 border-l border-muted-foreground/30 text-muted-foreground italic">
        {children}
      </blockquote>
    );
  },

  // Table — plain text table, no background fills
  table({ children }) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) { return <thead>{children}</thead>; },
  th({ children }) {
    return <th className="border-b border-border/40 pb-1 pr-4 text-left font-semibold text-xs">{children}</th>;
  },
  td({ children }) {
    return <td className="border-b border-border/10 py-1 pr-4 text-xs">{children}</td>;
  },

  // Inline
  strong({ children }) { return <strong className="font-semibold">{children}</strong>; },
  em({ children }) { return <em className="italic">{children}</em>; },
  hr() { return <hr className="my-3 border-border/30" />; },

  // Links — underline only, no color change
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    );
  },
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
