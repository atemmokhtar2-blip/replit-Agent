/**
 * remarkCallouts — remark AST plugin for GitHub-style callout blocks.
 *
 * Transforms blockquotes whose first paragraph starts with [!TYPE] into a
 * <div data-callout="type"> hast element — no raw HTML injection, no XSS surface.
 *
 * Supported types: NOTE · TIP · WARNING · IMPORTANT · CAUTION · INFO · SUCCESS · ERROR
 *
 * Input markdown:
 *   > [!NOTE]
 *   > This is a note.
 *
 * Output hast:
 *   <div data-callout="note">
 *     <p>This is a note.</p>
 *   </div>
 */

import { visit } from "unist-util-visit";

const CALLOUT_RE = /^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION|INFO|SUCCESS|ERROR)\][ \t]*/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function remarkCallouts(): (tree: any) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    visit(tree, "blockquote", (node: any) => {
      const firstChild = node.children?.[0];
      if (!firstChild || firstChild.type !== "paragraph") return;

      const firstInline = firstChild.children?.[0];
      if (!firstInline || firstInline.type !== "text") return;

      const match = CALLOUT_RE.exec(firstInline.value as string);
      if (!match) return;

      const calloutType = match[1].toLowerCase();

      // Strip the [!TYPE] prefix from the text node
      const remaining = (firstInline.value as string).slice(match[0].length).trimStart();
      if (remaining) {
        firstInline.value = remaining;
      } else {
        // Remove the now-empty text node
        firstChild.children.shift();
        // If the whole first paragraph is now empty, remove it too
        if (firstChild.children.length === 0) {
          node.children.shift();
        }
      }

      // Attach hast properties — rehype converts this blockquote into
      // <div data-callout="…"> with no raw HTML involved.
      node.data = {
        ...(node.data ?? {}),
        hName: "div",
        hProperties: { "data-callout": calloutType },
      };
    });
  };
}
