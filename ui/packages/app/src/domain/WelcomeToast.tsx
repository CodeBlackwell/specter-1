import { useEffect, useState } from "react";
import { useIsMobile } from "../lib";
import { useSimStore, type AppMode } from "../sim";

const STORAGE_KEY = "specter1.welcome.dismissed.v1";
const FONT_MONO = '"Courier New", "Courier Prime", Courier, ui-monospace, Menlo, monospace';

type Section = {
  id: AppMode;
  label: string;
  badge?: string;
  blurb: string;
};

const SECTIONS: ReadonlyArray<Section> = [
  {
    id: "workshop",
    label: "Workshop",
    blurb:
      "Guided 13-lesson curriculum. Each lesson stages a specific attack and shows how the trust + SLAM layers detect and recover.",
  },
  {
    id: "coursework",
    label: "Coursework",
    blurb:
      "The lessons as long-form notebooks — derivations, citations, and write-ups that go deeper than the interactive console. Jumps back to the matching workshop lesson with one click.",
  },
  {
    id: "research",
    label: "Research",
    blurb:
      "Benchmarks, ADR-cited claims, and the auditable measurement battery — every \"we resist X\" number traces to a scenario test.",
  },
];

function Key({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        border: "1px solid var(--border-subtle)",
        borderBottom: "2px solid var(--border-subtle)",
        borderRadius: 3,
        background: "rgba(255, 255, 255, 0.03)",
        color: "var(--text-mid)",
        fontFamily: FONT_MONO,
        fontWeight: 700,
        fontSize: 11.5,
        letterSpacing: 0.4,
      }}
    >
      {label}
    </span>
  );
}

export function WelcomeToast() {
  const setMode = useSimStore((s) => s.setMode);
  const dismissWelcome = useSimStore((s) => s.dismissWelcome);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const [closing, setClosing] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  useEffect(() => {
    const dismissed = (() => {
      try {
        return localStorage.getItem(STORAGE_KEY) === "1";
      } catch {
        return false;
      }
    })();
    if (!dismissed) setOpen(true);
  }, []);

  const dismiss = (nextMode?: AppMode) => {
    if (dontShow) {
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch {
        // ignore
      }
    }
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      if (nextMode) setMode(nextMode);
      dismissWelcome();
    }, 180);
  };

  if (!open) return null;

  const visible = !closing;
  const liquid = "cubic-bezier(0.22, 1, 0.36, 1)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to SPECTER"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: isMobile ? 12 : 24,
        background: "rgba(2, 4, 8, 0.5)",
        backdropFilter: "blur(18px) saturate(120%)",
        WebkitBackdropFilter: "blur(18px) saturate(120%)",
        opacity: visible ? 1 : 0,
        transition: `opacity 180ms ${liquid}`,
      }}
      onClick={() => dismiss()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(540px, 100%)",
          maxHeight: isMobile ? "calc(100vh - 24px)" : "calc(100vh - 48px)",
          overflowY: "auto",
          fontFamily: "var(--font-sans)",
          color: "var(--text-hi)",
          background: "rgba(14, 16, 20, 0.97)",
          border: "1px solid rgba(255, 255, 255, 0.07)",
          borderRadius: 4,
          boxShadow: [
            "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
            "0 1px 2px rgba(0, 0, 0, 0.5)",
            "0 24px 64px rgba(0, 0, 0, 0.55)",
          ].join(", "),
          padding: isMobile ? "20px 18px 16px" : "28px 32px 22px",
          transform: visible ? "scale(1) translateY(0)" : "scale(0.985) translateY(6px)",
          opacity: visible ? 1 : 0,
          transition: [
            `opacity 200ms ${liquid}`,
            `transform 220ms ${liquid}`,
          ].join(", "),
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                letterSpacing: 2.4,
                color: "var(--text-mid)",
                fontWeight: 700,
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              Specter · 1
            </div>
            <div
              style={{
                fontSize: isMobile ? 18 : 22,
                fontWeight: 500,
                letterSpacing: -0.2,
                lineHeight: 1.25,
                color: "var(--text-hi)",
              }}
            >
              Byzantine-resilient cooperative SLAM,
              {isMobile ? " " : <br />}
              demonstrated in the browser.
            </div>
          </div>
          <button
            aria-label="Close"
            onClick={() => dismiss()}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-low)",
              cursor: "pointer",
              fontFamily: FONT_MONO,
              fontWeight: 400,
              fontSize: 20,
              lineHeight: 1,
              padding: 4,
              marginTop: -2,
              opacity: 0.6,
              transition: `opacity 120ms ${liquid}`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
          >
            ×
          </button>
        </div>

        <p
          style={{
            margin: "0 0 24px",
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--text-mid)",
          }}
        >
          A swarm of agents maps together while detecting and surviving compromised
          peers — signed envelopes, Beta(α,β) reputation, range-only voting, and
          trust-weighted factor graphs, all running locally.
        </p>

        <div
          style={{
            marginBottom: isMobile ? 18 : 26,
            borderTop: "1px solid var(--border-subtle)",
            borderBottom: "1px solid var(--border-subtle)",
            padding: isMobile ? "12px 0" : "14px 0",
            display: "grid",
            gap: 10,
          }}
        >
          {isMobile ? (
            <div
              style={{
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "var(--text-mid)",
              }}
            >
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  letterSpacing: 1.8,
                  color: "var(--accent-primary)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  display: "block",
                  marginBottom: 4,
                }}
              >
                On mobile
              </span>
              <span>
                The live swarm needs a wider screen. Coursework and Research are the
                two reading surfaces designed to work here.
              </span>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  flexWrap: "wrap",
                  fontSize: 12,
                  color: "var(--text-mid)",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    letterSpacing: 1.8,
                    color: "var(--accent-primary)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    width: 56,
                  }}
                >
                  Keys
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Key label="Space" />
                  <span style={{ color: "var(--text-low)" }}>play / pause</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Key label="← →" />
                  <span style={{ color: "var(--text-low)" }}>step</span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <Key label="[ ]" />
                  <span style={{ color: "var(--text-low)" }}>lesson</span>
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 16,
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--text-mid)",
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    letterSpacing: 1.8,
                    color: "var(--accent-primary)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    width: 56,
                    flexShrink: 0,
                    paddingTop: 1,
                  }}
                >
                  Hover
                </span>
                <span>
                  Any agent, edge, landmark, or map element reveals a plain-English
                  explanation with live numeric data — range, residual, reputation,
                  confidence.
                </span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: "grid", gap: 0, marginBottom: isMobile ? 16 : 22 }}>
          {SECTIONS.map((s, i) => {
            const isHovered = hoveredIdx === i;
            const desktopOnly = isMobile && s.id === "workshop";
            const badge = desktopOnly ? "Desktop" : s.badge;
            return (
              <button
                key={s.id}
                onClick={() => dismiss(s.id)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "24px 1fr auto" : "32px 1fr auto",
                  alignItems: "center",
                  gap: isMobile ? 10 : 16,
                  padding: isMobile ? "12px 2px" : "14px 4px",
                  background: "transparent",
                  border: 0,
                  borderTop: i === 0 ? "none" : "1px solid var(--border-subtle)",
                  color: "var(--text-hi)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "var(--font-sans)",
                  transition: `color 140ms ${liquid}`,
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11.5,
                    letterSpacing: 1.2,
                    fontWeight: 700,
                    color: "var(--accent-primary)",
                    opacity: isHovered ? 1 : 0.9,
                    transition: `opacity 140ms ${liquid}`,
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 14,
                      fontWeight: 500,
                      letterSpacing: 0.1,
                      color: isHovered ? "var(--accent-primary)" : "var(--text-hi)",
                      transition: `color 140ms ${liquid}`,
                    }}
                  >
                    {s.label}
                    {badge && (
                      <span
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 10.5,
                          letterSpacing: 1,
                          padding: "2px 6px",
                          borderRadius: 3,
                          border: `1px solid ${desktopOnly ? "var(--status-flagged)" : "var(--border-subtle)"}`,
                          color: desktopOnly ? "var(--status-flagged)" : "var(--text-mid)",
                          fontWeight: 700,
                          textTransform: "uppercase",
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </span>
                  <span
                    style={{
                      fontSize: isMobile ? 13 : 13.5,
                      lineHeight: 1.5,
                      color: "var(--text-mid)",
                      fontWeight: 400,
                    }}
                  >
                    {desktopOnly
                      ? "Live swarm with canvas + inspector + scrubber. Needs a wider screen — opening this on mobile shows a stub with links."
                      : s.blurb}
                  </span>
                </span>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 14,
                    color: isHovered ? "var(--accent-primary)" : "var(--text-low)",
                    transform: isHovered ? "translateX(2px)" : "translateX(0)",
                    transition: `transform 160ms ${liquid}, color 140ms ${liquid}`,
                  }}
                >
                  →
                </span>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            paddingTop: 16,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text-mid)",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{ accentColor: "var(--accent-primary)" }}
            />
            Don't show this again
          </label>
          <button
            onClick={() => dismiss()}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--text-mid)",
              padding: "4px 0",
              fontFamily: FONT_MONO,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.4,
              cursor: "pointer",
              textTransform: "uppercase",
              transition: `color 120ms ${liquid}`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-mid)")}
          >
            Continue →
          </button>
        </div>
      </div>
    </div>
  );
}
