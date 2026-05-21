import { MAP_PRESETS, type BeaconLayoutName } from "@specter/sim-core";
import { Chip, Cluster, Mono, Stack, Surface } from "../../lib";
import { useSimStore } from "../../sim";

const LAYOUTS: ReadonlyArray<{ id: BeaconLayoutName; label: string }> = [
  { id: "perimeter", label: "PERIMETER" },
  { id: "corners", label: "CORNERS" },
  { id: "dense", label: "DENSE" },
];

const MIN_BEACONS = 0;
const MAX_BEACONS = 24;

export function EnvironmentBlock() {
  const mapPresetId = useSimStore((s) => s.mapPresetId);
  const beaconCount = useSimStore((s) => s.beaconCount);
  const beaconLayoutName = useSimStore((s) => s.beaconLayoutName);
  const setMapPreset = useSimStore((s) => s.setMapPreset);
  const setBeaconCount = useSimStore((s) => s.setBeaconCount);
  const setBeaconLayoutName = useSimStore((s) => s.setBeaconLayoutName);

  const countDisabled = beaconLayoutName === "corners";

  return (
    <Surface level={1} pad={3}>
      <Stack gap={3}>
        <Mono size="sm" muted className="t-label">
          Environment
        </Mono>

        <Stack gap={2}>
          <Mono size="sm" muted className="t-label">
            Map
          </Mono>
          <Cluster gap={1} wrap>
            {MAP_PRESETS.map((preset) => (
              <Chip
                key={preset.id}
                selected={mapPresetId === preset.id}
                onClick={() => setMapPreset(preset.id)}
                title={`${preset.sizeM.width}×${preset.sizeM.height} m`}
              >
                {preset.id.replace(/_/g, " ")}
              </Chip>
            ))}
          </Cluster>
        </Stack>

        <Stack gap={2}>
          <Mono size="sm" muted className="t-label">
            Beacons
          </Mono>
          <Cluster gap={1} wrap>
            {LAYOUTS.map((l) => (
              <Chip
                key={l.id}
                selected={beaconLayoutName === l.id}
                onClick={() => setBeaconLayoutName(l.id)}
              >
                {l.label}
              </Chip>
            ))}
          </Cluster>
          <Cluster gap={2} align="center">
            <Mono size="sm" muted>
              Count
            </Mono>
            <input
              type="range"
              min={MIN_BEACONS}
              max={MAX_BEACONS}
              step={1}
              value={beaconCount}
              onChange={(e) => setBeaconCount(Number(e.currentTarget.value))}
              disabled={countDisabled}
              style={{ flex: 1, minWidth: 120, opacity: countDisabled ? 0.4 : 1 }}
            />
            <Mono size="sm" style={{ width: 28, textAlign: "right" }}>
              {countDisabled ? 4 : beaconCount}
            </Mono>
          </Cluster>
          {countDisabled ? (
            <Mono size="sm" muted>
              CORNERS always places 4 beacons.
            </Mono>
          ) : null}
        </Stack>
      </Stack>
    </Surface>
  );
}
