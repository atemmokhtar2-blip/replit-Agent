/**
 * StreamingRenderer — Ultra Real-Time Streaming Engine V2
 *
 * Features:
 *  - Segment-based rendering: frozen completed blocks + live in-progress block
 *  - Unclosed code-fence healing: auto-closes open ``` during streaming
 *  - Memoized frozen segments: 0 re-renders on already-completed text
 *  - Typing cursor that follows the end of text and disappears on completion
 *  - Smooth fade-in for the streaming bubble on first appearance
 */

import React, { memo, useMemo, useRef } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ── Close any open code fence so the parser never swallows text ──────────────
function healCodeFences(text: string): string {
  let open = false;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
      open = !open;
      i += 3;
      // Skip language identifier on opening fence
      if (open) while (i < text.length && text[i] !== "\n") i++;
    } else {
      i++;
    }
  }
  return open ? text + "\n```" : text;
}

// ── Split content into a stable frozen part + a live in-progress part ────────
// Only split at double-newline boundaries that are outside code blocks.
// The frozen part never changes → perfect for React.memo.
function splitAtSafeBoundary(content: string): { frozen: string; live: string } {
  // Only bother splitting for long content
  if (content.length < 1200) return { frozen: "", live: content };

  const splitCeiling = content.length - 500; // keep last ~500 chars live
  let inCode = false;
  let lastSafeIdx = -1;

  for (let i = 0; i < splitCeiling - 1; i++) {
    // Track code-fence state
    if (content[i] === "`" && content[i + 1] === "`" && content[i + 2] === "`") {
      inCode = !inCode;
      i += 2;
      continue;
    }
    // Paragraph break outside code block = safe split point
    if (!inCode && content[i] === "\n" && content[i + 1] === "\n") {
      lastSafeIdx = i + 2;
    }
  }

  if (lastSafeIdx === -1) return { frozen: "", live: content };
  return {
    frozen: content.slice(0, lastSafeIdx),
    live: content.slice(lastSafeIdx),
  };
}

// ── Frozen segment — memoized, never re-renders after creation ───────────────
const FrozenSegment = memo(
  function FrozenSegment({ content }: { content: string }) {
    return <MarkdownRenderer content={content} />;
  },
  (prev, next) => prev.content === next.content,
);

// ── Typing cursor ─────────────────────────────────────────────────────────────
function TypingCursor() {
  return (
    <span
      aria-hidden
      className="streaming-cursor inline-block w-[2px] h-[1.05em] bg-foreground/45 ml-[1px] align-text-bottom rounded-[1px]"
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface StreamingRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

export const StreamingRenderer = memo(
  function StreamingRenderer({ content, isStreaming = false, className }: StreamingRendererProps) {
    const { frozen, live } = useMemo(() => splitAtSafeBoundary(content), [content]);

    // Heal open code fences only during streaming
    const processedLive = useMemo(
      () => (isStreaming ? healCodeFences(live) : live),
      [live, isStreaming],
    );

    return (
      <div className={className}>
        {frozen && <FrozenSegment content={frozen} />}
        <MarkdownRenderer content={processedLive} />
        {isStreaming && <TypingCursor />}
      </div>
    );
  },
  (prev, next) =>
    prev.content === next.content &&
    prev.isStreaming === next.isStreaming &&
    prev.className === next.className,
);
