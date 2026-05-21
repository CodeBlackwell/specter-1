import { Button, Cluster, Mono, Stack, Surface } from "../../lib";
import { useSimStore } from "../../sim";
import { ScheduleBlock } from "./ScheduleBlock";
import { MissionBlock } from "./MissionBlock";
import { EnvironmentBlock } from "./EnvironmentBlock";
import { MapEditor } from "./MapEditor";
import { PresetRow } from "./PresetRow";

export function Composer() {
  const launch = useSimStore((s) => s.launch);
  const attackIds = useSimStore((s) => s.attackIds);
  const flightPattern = useSimStore((s) => s.flightPattern);
  const pathPreset = useSimStore((s) => s.pathPreset);
  const mapPresetId = useSimStore((s) => s.mapPresetId);

  const motionRecap = flightPattern ?? (pathPreset ? `path:${pathPreset}` : "default");
  const attackRecap =
    attackIds.length === 0
      ? "honest baseline"
      : `${attackIds.length} attack${attackIds.length === 1 ? "" : "s"}`;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: "var(--space-4)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <Surface
        level={2}
        pad={4}
        style={{
          width: "100%",
          maxWidth: 1180,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
        }}
      >
        <Cluster gap={3} align="center">
          <Mono size="md" style={{ color: "var(--accent-primary)" }}>
            COMPOSE
          </Mono>
          <Mono size="sm" muted>
            Configure attacks, motion, and environment · LAUNCH ▶ to watch
          </Mono>
        </Cluster>

        <PresetRow />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 420px)",
            gap: "var(--space-4)",
          }}
          className="composer-grid"
        >
          <Stack gap={3} style={{ minWidth: 0 }}>
            <ScheduleBlock />
            <MissionBlock />
            <EnvironmentBlock />
          </Stack>
          <Stack gap={3} style={{ minWidth: 0 }}>
            <MapEditor />
          </Stack>
        </div>

        <Cluster gap={3} align="center">
          <Mono size="sm" muted style={{ flex: 1 }}>
            {attackRecap} · motion: {motionRecap} · map: {mapPresetId.replace(/_/g, " ")}
          </Mono>
          <Button variant="primary" onClick={launch}>
            LAUNCH ▶
          </Button>
        </Cluster>
      </Surface>
    </div>
  );
}
