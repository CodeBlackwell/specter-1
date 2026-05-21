import type { CSSProperties, ReactNode } from "react";

/** Markdown-light renderer for lesson/attack copy. Splits paragraphs on
 * blank lines, parses inline `code`, **bold**, *italic*, then applies
 * visual hierarchy:
 *  - First paragraph rendered as the lead (larger, brighter, often a
 *    rhetorical question).
 *  - Italic paragraphs starting with "Engineering sidebar:" /
 *    "Pedagogical note:" / "Honest framing." render as a callout box.
 *  - Inline `code` uses the same paper-code chip as the Research page.
 */
export function RichText({ source }: { source: string }) {
  const paragraphs = source.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {paragraphs.map((para, i) => {
        const callout = detectCallout(para);
        if (callout) return <Callout key={i} label={callout.label} body={callout.body} />;
        const isLead = i === 0;
        return (
          <p
            key={i}
            style={{
              margin: 0,
              color: isLead ? "var(--text-hi)" : "var(--text-mid)",
              fontFamily: "var(--font-sans)",
              fontSize: isLead ? 15 : 14,
              lineHeight: isLead ? "23px" : "21px",
              fontWeight: isLead ? 500 : 400,
              letterSpacing: isLead ? "-0.1px" : 0,
            }}
          >
            {renderInline(para)}
          </p>
        );
      })}
    </div>
  );
}

type CalloutKind = { label: string; body: string };

const CALLOUT_PREFIXES: Array<{ prefix: string; label: string }> = [
  { prefix: "*Engineering sidebar:", label: "Engineering sidebar" },
  { prefix: "*Pedagogical note:", label: "Pedagogical note" },
  { prefix: "*Honest framing.", label: "Honest framing" },
];

function detectCallout(para: string): CalloutKind | null {
  for (const { prefix, label } of CALLOUT_PREFIXES) {
    if (para.startsWith(prefix)) {
      // Strip enclosing asterisks (italic markers around the whole block).
      const body = para.replace(/^\*/, "").replace(/\*$/, "");
      // Strip the label itself from the body — we render it as a chip.
      const stripped = body.replace(new RegExp(`^${label}[:.] *`), "");
      return { label, body: stripped };
    }
  }
  return null;
}

function Callout({ label, body }: { label: string; body: string }) {
  return (
    <aside
      style={{
        padding: "8px 10px",
        background: "rgba(var(--accent-rgb), 0.05)",
        border: "1px solid var(--border-subtle)",
        borderLeft: "2px solid var(--accent-primary)",
        borderRadius: "var(--radius-sm)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: "var(--accent-primary)",
        }}
      >
        {label}
      </span>
      <p
        style={{
          margin: 0,
          color: "var(--text-mid)",
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: "20px",
          fontStyle: "italic",
        }}
      >
        {renderInline(body)}
      </p>
    </aside>
  );
}

/** Inline parser for backticks, bold (**...**), italic (*...*). Operates in
 * a single pass producing React nodes — no recursive markdown features. */
function renderInline(text: string): ReactNode[] {
  const tokens = tokenizeInline(text);
  return tokens.map((t, i) => {
    if (t.kind === "code") {
      return (
        <code
          key={i}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
            background: "rgba(var(--accent-rgb), 0.10)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 3,
            padding: "1px 5px",
            color: "var(--accent-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {t.text}
        </code>
      );
    }
    if (t.kind === "bold") {
      return (
        <strong key={i} style={{ color: "var(--text-hi)", fontWeight: 600 }}>
          {t.text}
        </strong>
      );
    }
    if (t.kind === "italic") {
      return (
        <em key={i} style={{ fontStyle: "italic", color: "var(--text-hi)" }}>
          {t.text}
        </em>
      );
    }
    return <span key={i}>{t.text}</span>;
  });
}

type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string };

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;

function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index! > last) out.push({ kind: "text", text: text.slice(last, m.index!) });
    const raw = m[0]!;
    if (raw.startsWith("`")) out.push({ kind: "code", text: raw.slice(1, -1) });
    else if (raw.startsWith("**")) out.push({ kind: "bold", text: raw.slice(2, -2) });
    else out.push({ kind: "italic", text: raw.slice(1, -1) });
    last = m.index! + raw.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export const richTextStylesExport: CSSProperties = {};
