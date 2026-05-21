import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type HintRow = { label: string; value: string; tone?: "accent" | "warn" | "danger" | "mute" };

export type Hint = {
  title: string;
  blurb: ReactNode;
  rows: ReadonlyArray<HintRow>;
  accent?: string;
};

export type SetHint = (h: Hint | null) => void;

const FONT_STACK = '"Courier New", "Courier Prime", Courier, ui-monospace, Menlo, monospace';

const EXIT_MS = 140;

export function HoverHintOverlay({
  hint,
  containerRef,
  pinned = false,
}: {
  hint: Hint | null;
  containerRef: React.RefObject<HTMLElement>;
  pinned?: boolean;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0, ready: false });
  const [cardSize, setCardSize] = useState({ w: 320, h: 120 });
  const [displayHint, setDisplayHint] = useState<Hint | null>(hint);
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pinned) return;
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top, ready: true });
    };
    el.addEventListener("mousemove", onMove);
    return () => el.removeEventListener("mousemove", onMove);
  }, [containerRef, pinned]);

  useEffect(() => {
    if (hint) {
      setDisplayHint(hint);
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setDisplayHint(null), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [hint]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el || !displayHint) return;
    const rect = el.getBoundingClientRect();
    setCardSize((prev) =>
      Math.abs(prev.w - rect.width) > 1 || Math.abs(prev.h - rect.height) > 1
        ? { w: rect.width, h: rect.height }
        : prev,
    );
  }, [displayHint]);

  if (!displayHint) return null;
  if (!pinned && !pos.ready) return null;

  const containerRect = containerRef.current?.getBoundingClientRect();
  const containerW = containerRect?.width ?? 800;
  const containerH = containerRect?.height ?? 600;
  const margin = 8;
  const offset = 14;
  const cardW = cardSize.w;
  const cardH = cardSize.h;

  let x = pos.x + offset;
  if (x + cardW + margin > containerW) {
    const flipped = pos.x - offset - cardW;
    x = flipped >= margin ? flipped : Math.max(margin, containerW - cardW - margin);
  }
  x = Math.max(margin, Math.min(x, containerW - cardW - margin));

  let y = pos.y - cardH / 2;
  y = Math.max(margin, Math.min(y, containerH - cardH - margin));

  const accent = displayHint.accent ?? "var(--accent-primary)";
  const liquid = "cubic-bezier(0.22, 1, 0.36, 1)";

  const positionStyle: React.CSSProperties = pinned
    ? { left: 12, bottom: 12 }
    : { left: x, top: y };
  const transformOrigin = pinned ? "left bottom" : "left center";
  const positionTransitions = pinned
    ? []
    : [`left 90ms ${liquid}`, `top 90ms ${liquid}`];

  return (
    <div
      ref={cardRef}
      style={{
        position: "absolute",
        ...positionStyle,
        width: 320,
        pointerEvents: "none",
        zIndex: 30,
        fontFamily: FONT_STACK,
        background:
          "linear-gradient(180deg, rgba(20, 24, 32, 0.96) 0%, rgba(8, 10, 14, 0.96) 100%)",
        backdropFilter: "blur(10px) saturate(140%)",
        WebkitBackdropFilter: "blur(10px) saturate(140%)",
        color: "var(--text-hi)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 10,
        boxShadow: [
          "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
          "inset 0 0 0 1px rgba(0, 0, 0, 0.25)",
          "0 1px 2px rgba(0, 0, 0, 0.4)",
          "0 12px 32px rgba(0, 0, 0, 0.55)",
          `0 0 0 1px ${accent}22`,
          `0 0 18px ${accent}26`,
        ].join(", "),
        padding: "11px 13px 13px",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1) translateY(0)" : "scale(0.97) translateY(3px)",
        filter: visible ? "blur(0)" : "blur(2px)",
        transformOrigin,
        willChange: "opacity, transform, filter, left, top",
        transition: [
          `opacity 140ms ${liquid}`,
          `transform 160ms ${liquid}`,
          `filter 140ms ease-out`,
          ...positionTransitions,
        ].join(", "),
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.8,
          textTransform: "uppercase",
          color: accent,
          marginBottom: 8,
          fontFamily: "var(--font-mono)",
        }}
      >
        {displayHint.title}
      </div>
      <div
        style={{
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "var(--text-mid)",
          marginBottom: displayHint.rows.length > 0 ? 10 : 0,
          fontFamily: "var(--font-sans)",
        }}
      >
        {displayHint.blurb}
      </div>
      {displayHint.rows.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            columnGap: 12,
            rowGap: 4,
            paddingTop: 8,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          {displayHint.rows.map((r, i) => (
            <div key={i} style={{ display: "contents" }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  color: "var(--text-mid)",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {r.label}
              </span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: rowColor(r.tone),
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function rowColor(tone: HintRow["tone"]): string {
  if (tone === "accent") return "var(--accent-primary)";
  if (tone === "warn") return "var(--status-flagged)";
  if (tone === "danger") return "var(--status-byzantine)";
  if (tone === "mute") return "var(--text-mid)";
  return "var(--text-hi)";
}

export function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function fmtMeters(n: number): string {
  return `${fmt(n, 2)} m`;
}

export function fmtRad(n: number): string {
  return `${fmt((n * 180) / Math.PI, 1)}°`;
}

export function fmtPct(n: number): string {
  return `${fmt(n * 100, 0)}%`;
}
