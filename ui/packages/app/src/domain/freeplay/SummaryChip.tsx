import { useSimStore } from "../../sim";

export function SummaryChip() {
  const mode = useSimStore((s) => s.mode);
  const isRunning = useSimStore((s) => s.isRunning);
  const attackIds = useSimStore((s) => s.attackIds);
  const flightPattern = useSimStore((s) => s.flightPattern);
  const pathPreset = useSimStore((s) => s.pathPreset);
  const mapPresetId = useSimStore((s) => s.mapPresetId);
  const exitRun = useSimStore((s) => s.exitRun);

  if (mode !== "freeplay" || !isRunning) return null;

  const attackRecap =
    attackIds.length === 0 ? "honest" : `${attackIds.length} atk`;
  const motionRecap = flightPattern ?? pathPreset ?? "default";

  return (
    <button
      type="button"
      onClick={exitRun}
      title="Return to compose"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "4px 12px",
        border: "1px solid var(--accent-dim)",
        borderRadius: "var(--radius-pill)",
        background: "rgba(0,0,0,0.20)",
        color: "var(--text-mid)",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: 0.6,
        cursor: "pointer",
      }}
    >
      <span style={{ color: "var(--accent-primary)" }}>
        {attackRecap} · {motionRecap} · {mapPresetId.replace(/_/g, " ")}
      </span>
      <span style={{ color: "var(--text-low)" }}>✎ EDIT</span>
    </button>
  );
}
