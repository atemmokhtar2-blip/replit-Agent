/**
 * MarkdownRenderer — plain text only. No markdown, no colors, no boxes.
 * Renders exactly like a normal chat app (WhatsApp / ChatGPT style).
 */

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  // Split on double newlines = paragraphs; single newlines = <br>
  const paragraphs = content.split(/\n{2,}/);

  return (
    <div className={`text-sm leading-relaxed ${className}`}>
      {paragraphs.map((para, i) => (
        <p key={i} className={i < paragraphs.length - 1 ? "mb-2" : ""}>
          {para.split("\n").map((line, j, arr) => (
            <span key={j}>
              {line}
              {j < arr.length - 1 && <br />}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}
