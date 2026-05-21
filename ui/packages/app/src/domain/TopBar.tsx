import { Cluster, Mono, Pill, useIsMobile } from "../lib";
import { useSimStore, type AppMode } from "../sim";
import { SummaryChip } from "./freeplay/SummaryChip";

const MODES: ReadonlyArray<{ id: AppMode; label: string; short: string }> = [
  { id: "workshop", label: "WORKSHOP", short: "WORK" },
  { id: "coursework", label: "COURSEWORK", short: "COURSE" },
  { id: "research", label: "RESEARCH", short: "RSCH" },
  { id: "freeplay", label: "FREE PLAY", short: "PLAY" },
];

export function TopBar({ lessonChip }: { lessonChip: string }) {
  const total = useSimStore((s) => s.result?.snapshots.length ?? 0);
  const tickIndex = useSimStore((s) => s.tickIndex);
  const mode = useSimStore((s) => s.mode);
  const setMode = useSimStore((s) => s.setMode);
  const gossipRound = useSimStore(
    (s) => s.result?.snapshots[s.tickIndex]?.gossipRound ?? false,
  );
  const displayTick = tickIndex + 1;
  const isResearch = mode === "research";
  const isCoursework = mode === "coursework";
  const isStatic = isResearch || isCoursework;
  const isMobile = useIsMobile();
  const showLive = !isStatic && !isMobile;
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        borderBottom: "1px solid var(--border-subtle)",
        background: "var(--surface-1)",
      }}
    >
      <Mono size="md" style={{ color: "var(--accent-primary)" }}>
        SPECTER · 1
      </Mono>
      {!isStatic && !isMobile && <Pill tone="accent">{lessonChip}</Pill>}
      <ModeSegments mode={mode} onSelect={setMode} compact={isMobile} />
      <SummaryChip />
      <div style={{ flex: 1 }} />
      {showLive && gossipRound && <Pill tone="accent">GOSSIP ROUND · t={displayTick}</Pill>}
      {showLive && (
        <Cluster gap={2} align="center">
          <Mono size="sm" muted className="t-label">
            TICK
          </Mono>
          <Mono size="md">
            {String(displayTick).padStart(4, "0")} / {String(total || 1).padStart(4, "0")}
          </Mono>
        </Cluster>
      )}
      <Pill tone={isStatic ? "accent" : "nominal"}>
        {isCoursework ? "READ" : isResearch ? "BRIEF" : isMobile ? "DESKTOP" : "LIVE"}
      </Pill>
    </div>
  );
}

function ModeSegments({
  mode,
  onSelect,
  compact,
}: {
  mode: AppMode;
  onSelect: (m: AppMode) => void;
  compact: boolean;
}) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-pill)",
        padding: 2,
        background: "rgba(0,0,0,0.20)",
      }}
    >
      {MODES.map((m) => {
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(m.id)}
            style={{
              background: active ? "var(--accent-dim)" : "transparent",
              border: 0,
              color: active ? "var(--accent-primary)" : "var(--text-mid)",
              borderRadius: "var(--radius-pill)",
              padding: compact ? "5px 10px" : "6px 14px",
              fontFamily: "var(--font-mono)",
              fontSize: compact ? 11 : 12,
              fontWeight: active ? 700 : 600,
              letterSpacing: 0.8,
              cursor: "pointer",
              transition: "background 120ms, color 120ms",
            }}
          >
            {compact ? m.short : m.label}
          </button>
        );
      })}
    </div>
  );
}
