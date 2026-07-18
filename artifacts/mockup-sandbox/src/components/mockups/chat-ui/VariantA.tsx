/**
 * Variant A — Minimal Chat
 * ChatGPT-style: user bubble right, assistant flows left with avatar
 * Full markdown: headers, code blocks + copy, tables, lists, blockquotes, links
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy, ChevronDown } from "lucide-react";

// ── Markdown renderer ──────────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl overflow-hidden border border-white/8 my-3">
      <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/8">
        <span className="text-[11px] text-white/30 font-mono">{lang || "code"}</span>
        <button onClick={copy} className="flex items-center gap-1.5 text-[11px] text-white/30 hover:text-white/60 transition-colors">
          {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="px-4 py-3 text-[12.5px] leading-[1.7] overflow-x-auto text-emerald-300/90 font-mono bg-[#0d1117]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="text-[12.5px] font-mono bg-white/8 text-rose-300/80 px-1.5 py-0.5 rounded-md border border-white/8">
      {children}
    </code>
  );
}

function parseInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g);
  const result: React.ReactNode[] = [];
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (!p) { i++; continue; }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      result.push(<InlineCode key={i}>{p.slice(1, -1)}</InlineCode>);
    } else if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      result.push(<strong key={i} className="font-semibold text-white/90">{p.slice(2, -2)}</strong>);
    } else if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
      result.push(<em key={i} className="italic text-white/70">{p.slice(1, -1)}</em>);
    } else if (p.startsWith("[")) {
      const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) result.push(<a key={i} href={m[2]} className="text-blue-400 underline underline-offset-2 hover:text-blue-300">{m[1]}</a>);
      else result.push(p);
    } else {
      result.push(p);
    }
    i++;
  }
  return result;
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push(<CodeBlock key={i} code={codeLines.join("\n")} lang={lang} />);
      i++;
      continue;
    }

    // Heading 1
    if (line.startsWith("# ")) {
      nodes.push(<h1 key={i} className="text-[17px] font-bold text-white/95 mt-4 mb-2 leading-snug">{parseInline(line.slice(2))}</h1>);
      i++; continue;
    }

    // Heading 2
    if (line.startsWith("## ")) {
      nodes.push(<h2 key={i} className="text-[15px] font-semibold text-white/90 mt-3 mb-1.5 leading-snug">{parseInline(line.slice(3))}</h2>);
      i++; continue;
    }

    // Heading 3
    if (line.startsWith("### ")) {
      nodes.push(<h3 key={i} className="text-[13.5px] font-semibold text-white/80 mt-2 mb-1 leading-snug">{parseInline(line.slice(4))}</h3>);
      i++; continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote key={i} className="border-l-2 border-white/20 pl-3 my-2 italic text-white/50 text-[13px]">
          {parseInline(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    // Table
    if (line.startsWith("|") && lines[i + 1]?.startsWith("|---")) {
      const headers = line.split("|").map(c => c.trim()).filter(Boolean);
      i += 2; // skip separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].split("|").map(c => c.trim()).filter(Boolean));
        i++;
      }
      nodes.push(
        <div key={i} className="overflow-x-auto my-3">
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr>{headers.map((h, j) => (
                <th key={j} className="text-left px-3 py-2 text-white/60 font-semibold border-b border-white/10 bg-white/5">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                  {row.map((cell, k) => <td key={k} className="px-3 py-2 text-white/70">{parseInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Unordered list
    if (line.match(/^[-•*] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-•*] /)) {
        items.push(lines[i].replace(/^[-•*] /, ""));
        i++;
      }
      nodes.push(
        <ul key={i} className="my-2 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2 text-[13.5px] text-white/75 leading-relaxed">
              <span className="text-white/30 flex-shrink-0 mt-1.5 w-1 h-1 rounded-full bg-white/30 block" />
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\. /)) {
      const items: { n: number; text: string }[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        const m = lines[i].match(/^(\d+)\. (.+)/);
        if (m) items.push({ n: +m[1], text: m[2] });
        i++;
      }
      nodes.push(
        <ol key={i} className="my-2 space-y-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-3 text-[13.5px] text-white/75 leading-relaxed">
              <span className="text-white/30 flex-shrink-0 font-mono text-[11px] mt-0.5">{item.n}.</span>
              <span>{parseInline(item.text)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (line === "---" || line === "***") {
      nodes.push(<hr key={i} className="border-white/10 my-3" />);
      i++; continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++; continue;
    }

    // Paragraph
    nodes.push(
      <p key={i} className="text-[13.5px] text-white/75 leading-[1.75] mb-1">{parseInline(line)}</p>
    );
    i++;
  }

  return <div className="space-y-0.5">{nodes}</div>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type Role = "user" | "assistant";
interface Msg { id: number; role: Role; content: string; typing?: boolean }

// ── Avatar ─────────────────────────────────────────────────────────────────────

function AssistantAvatar() {
  return (
    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-white/15 to-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 mt-1">
      <span className="text-[11px] font-bold text-white/60 font-mono">7</span>
    </div>
  );
}

// ── Typing indicator ───────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-white/25"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function Message({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="flex justify-end"
      >
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[#1c1c1e] border border-white/8 px-4 py-2.5">
          <p className="text-[13.5px] text-white/85 leading-[1.7] whitespace-pre-wrap">{msg.content}</p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="flex gap-3"
    >
      <AssistantAvatar />
      <div className="flex-1 min-w-0 pt-0.5">
        {msg.typing ? <TypingDots /> : <MarkdownContent content={msg.content} />}
      </div>
    </motion.div>
  );
}

// ── Input bar ──────────────────────────────────────────────────────────────────

function InputBar({ onSend, disabled }: { onSend: (v: string) => void; disabled: boolean }) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    if (!val.trim() || disabled) return;
    onSend(val.trim());
    setVal("");
  };

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 160) + "px";
    }
  }, [val]);

  return (
    <div className="px-4 pb-5">
      <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 focus-within:border-white/20 transition-colors">
        <textarea
          ref={ref}
          rows={1}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="اكتب رسالتك..."
          className="flex-1 resize-none bg-transparent text-[13.5px] text-white/80 placeholder-white/20 outline-none leading-relaxed min-h-[22px] max-h-[160px]"
          style={{ direction: "rtl" }}
        />
        <button
          onClick={send}
          disabled={!val.trim() || disabled}
          className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-150 disabled:opacity-20 bg-white/90 hover:bg-white text-black"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.5 1.5L6.5 7.5M12.5 1.5L8.5 12.5L6.5 7.5M12.5 1.5L1.5 5.5L6.5 7.5" />
          </svg>
        </button>
      </div>
      <p className="text-center text-[10px] text-white/15 mt-2">Enter للإرسال · Shift+Enter لسطر جديد</p>
    </div>
  );
}

// ── Demo messages ──────────────────────────────────────────────────────────────

const DEMO: Msg[] = [
  { id: 1, role: "user", content: "اعمل لي موقع للمطعم" },
  {
    id: 2, role: "assistant", content: `## موقع المطعم

سأبني لك موقعاً احترافياً يتضمن الأقسام التالية:

### الصفحات المقترحة

1. **الرئيسية** — صورة hero مع شعار وزر "احجز طاولة"
2. **القائمة** — عرض الأطباق مع الصور والأسعار
3. **الحجز** — نموذج حجز مع التقويم
4. **التواصل** — الخريطة وساعات العمل

### التقنيات المستخدمة

| المكوّن | التقنية |
|---|---|
| الواجهة | React + Tailwind |
| الخلفية | Node.js + Express |
| قاعدة البيانات | PostgreSQL |
| الاستضافة | Replit |

### البدء السريع

\`\`\`bash
npm create vite@latest restaurant-site
cd restaurant-site
npm install react-router-dom framer-motion
\`\`\`

> ملاحظة: يمكن إضافة نظام الدفع الإلكتروني لاحقاً عبر Stripe.

تريد أبدأ بأي قسم أولاً؟`
  },
  { id: 3, role: "user", content: "ابدأ بالصفحة الرئيسية" },
  {
    id: 4, role: "assistant", content: `سأبني الصفحة الرئيسية الآن.

المكوّنات التي سأنشئها:

- \`Hero.tsx\` — صورة خلفية + عنوان + أزرار CTA
- \`Navbar.tsx\` — شريط التنقل مع اللوغو
- \`FeaturedDishes.tsx\` — عرض أبرز الأطباق

\`\`\`tsx
// src/pages/Home.tsx
export function Home() {
  return (
    <main>
      <Navbar />
      <Hero />
      <FeaturedDishes />
    </main>
  );
}
\`\`\`

جارٍ توليد الكود الكامل...`
  },
];

// ── Main component ─────────────────────────────────────────────────────────────

export function VariantA() {
  const [msgs, setMsgs] = useState<Msg[]>(DEMO);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  let nextId = useRef(DEMO.length + 1);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, typing]);

  const handleSend = (text: string) => {
    const userMsg: Msg = { id: nextId.current++, role: "user", content: text };
    setMsgs(p => [...p, userMsg]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs(p => [...p, {
        id: nextId.current++, role: "assistant",
        content: "بالتأكيد، سأعمل على ذلك الآن.\n\nيمكنك متابعة التقدم في الوقت الفعلي."
      }]);
    }, 2200);
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0b] text-white overflow-hidden" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/6">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
            <span className="text-[10px] font-bold text-white/60">7</span>
          </div>
          <span className="text-[13px] font-medium text-white/70">مساعد 7</span>
        </div>
        <button className="text-[11px] text-white/25 hover:text-white/50 transition-colors">محادثة جديدة</button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {msgs.map(msg => <Message key={msg.id} msg={msg} />)}
        {typing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <AssistantAvatar />
            <TypingDots />
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <InputBar onSend={handleSend} disabled={typing} />
    </div>
  );
}
