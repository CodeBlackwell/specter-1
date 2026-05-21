import { Button, Mono } from "../lib";
import { useSimStore } from "../sim";

export function PlayerOverlay() {
  const total = useSimStore((s) => s.result?.snapshots.length ?? 0);
  const tickIndex = useSimStore((s) => s.tickIndex);
  const isPlaying = useSimStore((s) => s.isPlaying);
  const attackStartTick = useSimStore((s) => s.spec?.attackStartTick ?? 0);
  const hasAttackers = useSimStore((s) => (s.spec?.attackers?.length ?? 0) > 0);
  const setPlaying = useSimStore((s) => s.setPlaying);
  const setTick = useSimStore((s) => s.setTick);
  const reset = useSimStore((s) => s.reset);

  const displayTick = total === 0 ? 0 : tickIndex + 1;
  const denom = total || 1;
  const attackPct =
    hasAttackers && total > 1 && attackStartTick > 0
      ? (Math.min(attackStartTick - 1, total - 1) / (total - 1)) * 100
      : null;

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: "var(--space-3)",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "6px 10px",
        background: "color-mix(in srgb, var(--surface-0) 88%, transparent)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        backdropFilter: "blur(6px)",
        minWidth: 360,
        maxWidth: "min(560px, calc(100% - var(--space-4) * 2))",
        pointerEvents: "auto",
        zIndex: 2,
      }}
    >
      <Button
        size="sm"
        variant={isPlaying ? "danger" : "primary"}
        onClick={() => setPlaying(!isPlaying)}
        disabled={total === 0}
        aria-label={isPlaying ? "Pause" : "Play"}
        style={{ minWidth: 56 }}
      >
        {isPlaying ? "⏸ Pause" : "▶ Play"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          reset();
          setPlaying(true);
        }}
        disabled={total === 0}
        aria-label="Restart"
        title="Restart from tick 0"
      >
        ⟲ Restart
      </Button>
      <div style={{ position: "relative", flex: 1 }}>
        <input
          type="range"
          min={0}
          max={Math.max(total - 1, 0)}
          value={tickIndex}
          onChange={(e) => setTick(Number(e.target.value))}
          disabled={total === 0}
          style={{
            width: "100%",
            accentColor: "var(--accent-primary)",
            display: "block",
          }}
        />
        {attackPct !== null ? (
          <div
            style={{
              position: "absolute",
              left: `${attackPct}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: "var(--status-byzantine)",
              opacity: 0.85,
              pointerEvents: "none",
              transform: "translateX(-1px)",
            }}
            title={`attack starts at tick ${attackStartTick}`}
          />
        ) : null}
      </div>
      <Mono size="sm">
        {String(displayTick).padStart(4, "0")}/{String(denom).padStart(4, "0")}
      </Mono>
      <Mono size="sm" muted>
        (space to pause/play)
      </Mono>
    </div>
  );
}
