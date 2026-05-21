import { useEffect, useState } from "react";
import { Mono } from "../lib";
import { LESSON_PREVIEW } from "../data/lessonPreviews";

const COUNTDOWN_MS = 15_000;
const TICK_MS = 100;

export function LessonAdvanceOverlay({
  nextId,
  nextTitle,
  onContinue,
  onCancel,
}: {
  nextId: string;
  nextTitle: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(COUNTDOWN_MS);
  const preview = LESSON_PREVIEW[nextId];

  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => {
      const left = Math.max(0, COUNTDOWN_MS - (performance.now() - start));
      setRemainingMs(left);
      if (left <= 0) {
        window.clearInterval(id);
        onContinue();
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [onContinue]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        onContinue();
      } else if (e.key === "Escape" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onContinue, onCancel]);

  const seconds = Math.ceil(remainingMs / 1000);
  const progressPct = ((COUNTDOWN_MS - remainingMs) / COUNTDOWN_MS) * 100;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Next lesson: ${nextTitle}`}
      onClick={onContinue}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(11, 13, 16, 0.82)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        backdropFilter: "blur(4px)",
        cursor: "pointer",
        padding: "var(--space-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          width: "min(640px, 100%)",
          maxHeight: "calc(100vh - var(--space-7))",
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            height: 3,
            width: `${progressPct}%`,
            background: "var(--accent-primary)",
            transition: `width ${TICK_MS}ms linear`,
            borderTopLeftRadius: "var(--radius-lg)",
            borderTopRightRadius: progressPct >= 99.5 ? "var(--radius-lg)" : 0,
          }}
        />
        <header
          style={{
            padding: "var(--space-4) var(--space-5) var(--space-3)",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-1)",
          }}
        >
          <Mono size="sm" muted className="t-label">
            Up next · Lesson {nextId}
          </Mono>
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              fontSize: 22,
              lineHeight: "28px",
              letterSpacing: "-0.3px",
              color: "var(--text-hi)",
            }}
          >
            {nextTitle}
          </div>
        </header>
        <div
          style={{
            padding: "var(--space-4) var(--space-5)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3)",
          }}
        >
          {preview ? (
            <>
              <PreviewRow tag="Problem" tone="var(--status-byzantine)" body={preview.problem} />
              <PreviewRow tag="Solution" tone="var(--accent-primary)" body={preview.solution} />
              <PreviewRow tag="Proof" tone="var(--status-nominal)" body={preview.proof} />
            </>
          ) : (
            <div style={{ color: "var(--text-mid)", fontSize: 14 }}>
              The next scene is loading.
            </div>
          )}
        </div>
        <footer
          style={{
            padding: "var(--space-3) var(--space-5) var(--space-4)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={onContinue}
            className="btn btn--primary"
            style={{ minWidth: 140 }}
          >
            Continue · {seconds}s
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            className="btn btn--ghost"
          >
            Stay here · esc
          </button>
          <Mono size="sm" muted style={{ marginLeft: "auto" }}>
            space · → continue   ·   esc · ← stay
          </Mono>
        </footer>
      </div>
    </div>
  );
}

function PreviewRow({ tag, tone, body }: { tag: string; tone: string; body: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "84px 1fr",
        gap: "var(--space-3)",
        alignItems: "baseline",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          fontWeight: 700,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: tone,
        }}
      >
        {tag}
      </span>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13.5,
          lineHeight: "20px",
          color: "var(--text-hi)",
        }}
      >
        {body}
      </span>
    </div>
  );
}
