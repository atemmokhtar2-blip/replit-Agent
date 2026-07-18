/**
 * Variant B — Structured Chat
 * User bubble right (solid dark), assistant in subtle card on left
 * More contained, slightly denser, clearer visual hierarchy
 * Full markdown: headers, code blocks + copy, tables, lists, blockquotes, links
 */
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Copy } from "lucide-react";

// ── Markdown renderer ──────────────────────────────────────────────────────────

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-lg overflow-hidden border border-[#2a2a2e] my-2.5">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-[#18181b] border-b border-[#2a2a2e]">
        <span className="text-[10px] uppercase tracking-widest text-white/20 font-mono">{lang || "code"}</span>
        <button onClick={copy} className="flex items-center gap-1 text-[10.5px] text-white/25 hover:text-white/55 transition-colors">
          {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
          <span>{copied ? "تم النسخ" : "نسخ"}</span>
        </button>
      </div>
      <pre className="px-4 py-3 text-[12px] leading-[1.75] overflow-x-auto font-mono bg-[#0f0f12] text-[#7dd3fc]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="text-[12px] font-mono bg-white/6 text-[#fda4af] px-1.5 py-0.5 rounded border border-white/8">
      {children}
    </code>
  );
}

function parseInline(text: string): React.ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\(([^)]+)\))/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) return <InlineCode key={i}>{p.slice(1, -1)}</InlineCode>;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i} className="font-semibold text-white/95">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i} className="italic text-white/65">{p.slice(1, -1)}</em>;
    if (p.startsWith("[")) {
      const m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) return <a key={i} href={m[2]} className="text-[#60a5fa] underline underline-offset-2 hover:text-[#93c5fd]">{m[1]}</a>;
    }
    return p;
  });
}

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { codeLines.push(lines[i]); i++; }
      nodes.push(<CodeBlock key={`c${i}`} code={codeLines.join("\n")} lang={lang} />);
      i++; continue;
    }

    if (line.startsWith("# ")) {
      nodes.push(<h1 key={i} className="text-[16px] font-bold text-white/95 mt-3 mb-2 leading-snug">{parseInline(line.slice(2))}</h1>);
      i++; continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(<h2 key={i} className="text-[14px] font-semibold text-white/88 mt-2.5 mb-1.5 pb-1 border-b border-white/8">{parseInline(line.slice(3))}</h2>);
      i++; continue;
    }
    if (line.startsWith("### ")) {
      nodes.push(<h3 key={i} className="text-[13px] font-semibold text-white/75 mt-2 mb-1">{parseInline(line.slice(4))}</h3>);
      i++; continue;
    }

    if (line.startsWith("> ")) {
      nodes.push(
        <blockquote key={i} className="border-l-[3px] border-[#404040] pl-3 my-2 text-white/45 text-[12.5px] italic">
          {parseInline(line.slice(2))}
        </blockquote>
      );
      i++; continue;
    }

    if (line.startsWith("|") && lines[i + 1]?.startsWith("|---")) {
      const headers = line.split("|").map(c => c.trim()).filter(Boolean);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i].split("|").map(c => c.trim()).filter(Boolean));
        i++;
      }
      nodes.push(
        <div key={`t${i}`} className="overflow-x-auto my-2.5 rounded-lg border border-[#242428]">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-white/4">{headers.map((h, j) => (
                <th key={j} className="text-left px-3 py-2 text-white/55 font-medium border-b border-[#242428]">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j} className={`border-b border-[#1e1e22] last:border-0 ${j % 2 === 0 ? "" : "bg-white/2"}`}>
                  {row.map((cell, k) => <td key={k} className="px-3 py-2 text-white/65">{parseInline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (line.match(/^[-•*] /)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-•*] /)) { items.push(lines[i].replace(/^[-•*] /, "")); i++; }
      nodes.push(
        <ul key={`ul${i}`} className="my-1.5 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 text-[13px] text-white/70 leading-[1.7]">
              <span className="flex-shrink-0 text-white/25 mt-[7px] w-1 h-1 rounded-full bg-white/30 block" />
              <span>{parseInline(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.match(/^\d+\. /)) {
      const items: { n: number; text: string }[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        const m = lines[i].match(/^(\d+)\. (.+)/);
        if (m) items.push({ n: +m[1], text: m[2] });
        i++;
      }
      nodes.push(
        <ol key={`ol${i}`} className="my-1.5 space-y-1 pl-1">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2.5 text-[13px] text-white/70 leading-[1.7]">
              <span className="flex-shrink-0 font-mono text-[10.5px] text-white/25 mt-0.5 w-4">{item.n}.</span>
              <span>{parseInline(item.text)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (line === "---") { nodes.push(<hr key={i} className="border-white/8 my-2.5" />); i++; continue; }
    if (line.trim() === "") { i++; continue; }

    nodes.push(<p key={i} className="text-[13px] text-white/70 leading-[1.75] mb-0.5">{parseInline(line)}</p>);
    i++;
  }

  return <div>{nodes}</div>;
}

// ── Types & demo ───────────────────────────────────────────────────────────────

type Role = "user" | "assistant";
interface Msg { id: number; role: Role; content: string }

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

// ── Typing dots ────────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-1.5">
      {[0, 1, 2].map(i => (
        <motion.span key={i} className="w-[5px] h-[5px] rounded-full bg-white/30 block"
          animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </div>
  );
}

// ── Messages ───────────────────────────────────────────────────────────────────

function UserMsg({ content }: { content: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="flex justify-end">
      <div className="max-w-[72%] rounded-2xl rounded-br-sm bg-[#1f1f22] border border-white/8 px-4 py-2.5">
        <p className="text-[13px] text-white/82 leading-[1.7] whitespace-pre-wrap" style={{ direction: "rtl" }}>{content}</p>
      </div>
    </motion.div>
  );
}

function AssistantMsg({ content, isTyping }: { content: string; isTyping?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className="flex gap-2.5">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5">
        <div className="w-6 h-6 rounded-lg border border-white/10 bg-[#1a1a1d] flex items-center justify-center">
          <span className="text-[9px] font-bold text-white/40">7</span>
        </div>
      </div>
      {/* Content card */}
      <div className="flex-1 min-w-0 rounded-2xl rounded-tl-sm border border-[#232328] bg-[#131316] px-4 py-3">
        {isTyping ? <TypingDots /> : <MarkdownContent content={content} />}
      </div>
    </motion.div>
  );
}

// ── Input ──────────────────────────────────────────────────────────────────────

function InputBar({ onSend, disabled }: { onSend: (v: string) => void; disabled: boolean }) {
  const [val, setVal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = Math.min(ref.current.scrollHeight, 150) + "px";
    }
  }, [val]);

  const send = () => {
    if (!val.trim() || disabled) return;
    onSend(val.trim());
    setVal("");
  };

  return (
    <div className="px-5 pb-5 pt-2">
      <div className="relative flex items-end gap-2 rounded-xl border border-[#252529] bg-[#0e0e11] px-4 py-3 focus-within:border-[#3a3a40] transition-all duration-200">
        <textarea
          ref={ref}
          rows={1}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="اكتب رسالتك..."
          className="flex-1 resize-none bg-transparent text-[13px] text-white/75 placeholder-white/18 outline-none leading-relaxed min-h-[22px] max-h-[150px]"
          style={{ direction: "rtl" }}
        />
        <button
          onClick={send}
          disabled={!val.trim() || disabled}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-all disabled:opacity-20 bg-white/10 hover:bg-white/18 border border-white/10"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/70">
            <path d="M12.5 1.5L6.5 7.5M12.5 1.5L8.5 12.5L6.5 7.5M12.5 1.5L1.5 5.5L6.5 7.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function VariantB() {
  const [msgs, setMsgs] = useState<Msg[]>(DEMO);
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(DEMO.length + 1);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, typing]);

  const handleSend = (text: string) => {
    setMsgs(p => [...p, { id: nextId.current++, role: "user", content: text }]);
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      setMsgs(p => [...p, { id: nextId.current++, role: "assistant", content: "بالتأكيد، سأعمل على ذلك الآن.\n\nيمكنك متابعة التقدم في الوقت الفعلي." }]);
    }, 2200);
  };

  return (
    <div className="flex flex-col h-screen bg-[#0b0b0e] text-white overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0b0b0e]/80 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-white/8 border border-white/8 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white/40">7</span>
          </div>
          <span className="text-[12.5px] font-medium text-white/55">مساعد 7</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
          <span className="text-[10.5px] text-white/25">متصل</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        <AnimatePresence initial={false}>
          {msgs.map(msg =>
            msg.role === "user"
              ? <UserMsg key={msg.id} content={msg.content} />
              : <AssistantMsg key={msg.id} content={msg.content} />
          )}
          {typing && <AssistantMsg key="typing" content="" isTyping />}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <InputBar onSend={handleSend} disabled={typing} />
    </div>
  );
}
