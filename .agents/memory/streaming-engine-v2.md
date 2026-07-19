---
name: Streaming Engine V2
description: rAF-based token batching + segmented streaming renderer architecture
---

## Rule
All streaming rendering goes through StreamingRenderer (artifacts/ai-agent/src/components/chat/StreamingRenderer.tsx), NOT directly through MarkdownRenderer during active streaming.

## What changed
- PlannerWorkspace: content_chunk uses pendingTokensRef + requestAnimationFrame flush (not setState per token)
- StreamingRenderer: FrozenSegment (React.memo) for completed blocks + live block for in-progress
- healCodeFences: closes open ``` mid-stream to prevent markdown parser swallowing text
- TypingBubble: accepts optional stageName prop → shows stage name with pulse animation before first token
- showScrollBtn state + "آخر رسالة" button appears when user scrolls up during streaming
- CSS: cursor-blink keyframe (.streaming-cursor) + token-fade-in (.streaming-bubble-enter) in index.css

**Why:** One setState per token caused 100+ re-renders/sec. ReactMarkdown re-parses entire string each render → O(n²) for long responses. FrozenSegment ensures only the live block re-renders.

**How to apply:** Import StreamingRenderer not MarkdownRenderer for streaming surfaces. Always cancel flushRafRef in stop/done/error handlers.
