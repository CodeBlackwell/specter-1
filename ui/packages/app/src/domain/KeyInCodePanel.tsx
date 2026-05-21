import { useEffect, useState } from "react";
import { Mono, Stack, Surface } from "../lib";
import { LESSON_KEY_CODE, type LessonKeyCode, keyCodeGithubUrl } from "../data/lessonKeyCode";

export function KeyInCodePanel({ lessonId }: { lessonId: string }) {
  const entry = LESSON_KEY_CODE[lessonId];
  const [expanded, setExpanded] = useState(false);
  if (!entry) return null;
  const open = () => setExpanded(true);
  return (
    <>
      <Surface level={1} pad={2}>
        <Stack gap={2}>
          <Stack gap={1}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-2)",
                justifyContent: "space-between",
              }}
            >
              <Mono size="sm" muted className="t-label">
                The Key in Code
              </Mono>
              <button
                type="button"
                onClick={open}
                title="Expand code · roomier view"
                aria-label="Expand code"
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 6px",
                  borderRadius: 3,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  letterSpacing: 0.8,
                  textTransform: "uppercase",
                  color: "var(--text-mid)",
                  border: "1px solid var(--border-subtle)",
                  transition: "color 120ms ease, border-color 120ms ease, background 120ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "var(--accent-primary)";
                  e.currentTarget.style.borderColor = "var(--accent-primary)";
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "var(--text-mid)";
                  e.currentTarget.style.borderColor = "var(--border-subtle)";
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span aria-hidden>⤢</span>
                <span>expand</span>
              </button>
            </div>
            <span
              style={{
                fontFamily: "var(--font-sans)",
                fontWeight: 600,
                fontSize: 13,
                lineHeight: "18px",
                color: "var(--text-hi)",
              }}
            >
              {entry.title}
            </span>
            <a
              href={keyCodeGithubUrl(entry.file)}
              target="_blank"
              rel="noopener noreferrer"
              title="Open on GitHub"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                color: "var(--accent-primary)",
                textDecoration: "none",
                borderBottom: "1px dotted var(--accent-primary)",
                alignSelf: "flex-start",
                letterSpacing: 0.2,
                maxWidth: "100%",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
              }}
            >
              {entry.file} ↗
            </a>
          </Stack>
          <CodeBlock entry={entry} onExpand={open} />
          {entry.note ? (
            <p style={{ margin: 0, font: "400 12.5px/19px var(--font-sans)", color: "var(--text-mid)" }}>
              {entry.note}
            </p>
          ) : null}
        </Stack>
      </Surface>
      {expanded ? <KeyInCodeOverlay entry={entry} onClose={() => setExpanded(false)} /> : null}
    </>
  );
}

function CodeBlock({ entry, onExpand }: { entry: LessonKeyCode; onExpand: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <pre
        onClick={onExpand}
        title="Click to expand"
        style={{
          margin: 0,
          padding: "var(--space-2) var(--space-3)",
          background: "rgba(0, 0, 0, 0.28)",
          borderLeft: "2px solid var(--accent-primary)",
          borderRadius: 3,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: "16px",
          color: "var(--text-hi)",
          overflowX: "auto",
          whiteSpace: "pre",
          tabSize: 2,
          cursor: "zoom-in",
        }}
      >
        <code>{entry.code}</code>
      </pre>
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 4,
          right: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: 0.6,
          color: "var(--accent-primary)",
          opacity: hover ? 0.85 : 0,
          transition: "opacity 140ms ease",
          pointerEvents: "none",
          background: "rgba(11,13,16,0.65)",
          padding: "1px 5px",
          borderRadius: 3,
        }}
      >
        ⤢
      </span>
    </div>
  );
}

function KeyInCodeOverlay({ entry, onClose }: { entry: LessonKeyCode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Key in code · ${entry.title}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 13, 16, 0.82)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: "var(--space-4)",
        cursor: "pointer",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          width: "min(960px, 100%)",
          maxHeight: "calc(100vh - var(--space-7))",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          cursor: "auto",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "var(--space-4) var(--space-5) var(--space-3)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
            }}
          >
            <Mono size="sm" muted className="t-label">
              The Key in Code
            </Mono>
            <button
              type="button"
              onClick={onClose}
              title="Close · esc"
              aria-label="Close"
              className="btn btn--ghost"
              style={{ padding: "2px 10px", fontSize: 12 }}
            >
              close · esc
            </button>
          </div>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: 18,
              lineHeight: "24px",
              letterSpacing: "-0.2px",
              color: "var(--text-hi)",
            }}
          >
            {entry.title}
          </div>
          <a
            href={keyCodeGithubUrl(entry.file)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              color: "var(--accent-primary)",
              textDecoration: "none",
              borderBottom: "1px dotted var(--accent-primary)",
              alignSelf: "flex-start",
              letterSpacing: 0.2,
            }}
          >
            {entry.file} ↗
          </a>
        </header>
        <div
          style={{
            padding: "var(--space-4) var(--space-5)",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          <pre
            style={{
              margin: 0,
              padding: "var(--space-3) var(--space-4)",
              background: "rgba(0, 0, 0, 0.32)",
              borderLeft: "3px solid var(--accent-primary)",
              borderRadius: 4,
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: "20px",
              color: "var(--text-hi)",
              whiteSpace: "pre",
              overflowX: "auto",
              tabSize: 2,
            }}
          >
            <code>{entry.code}</code>
          </pre>
          {entry.note ? (
            <p
              style={{
                margin: 0,
                font: "400 14px/22px var(--font-sans)",
                color: "var(--text-mid)",
              }}
            >
              {entry.note}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
