import type { FlightPattern } from "@specter/sim-core";
import { Chip, Cluster, Mono, Stack, Surface } from "../../lib";
import { useSimStore } from "../../sim";
import type { PathPresetId } from "../../sim/scenarioWorker.types";
import { DRONE_COUNT } from "../../sim/droneSwarm";

const FLIGHT_PATTERNS: ReadonlyArray<{ id: FlightPattern; label: string }> = [
  { id: "LAWNMOWER", label: "LAWNMOWER" },
  { id: "ORBIT", label: "ORBIT" },
  { id: "RENDEZVOUS", label: "RENDEZVOUS" },
  { id: "RANDOM_WALK", label: "RANDOM WALK" },
];

const PATH_PRESETS: ReadonlyArray<{ id: PathPresetId; label: string }> = [
  { id: "LOOP", label: "LOOP" },
  { id: "LINEAR", label: "LINEAR" },
  { id: "FIGURE-8", label: "FIGURE-8" },
  { id: "FREEHAND", label: "FREEHAND" },
];

export function MissionBlock() {
  const flightPattern = useSimStore((s) => s.flightPattern);
  const pathPreset = useSimStore((s) => s.pathPreset);
  const setFlightPattern = useSimStore((s) => s.setFlightPattern);
  const setPathPreset = useSimStore((s) => s.setPathPreset);

  return (
    <Surface level={1} pad={3}>
      <Stack gap={3}>
        <Mono size="sm" muted className="t-label">
          Mission
        </Mono>

        <Stack gap={2}>
          <Mono size="sm" muted>
            Agents · fixed at {DRONE_COUNT}
          </Mono>
        </Stack>

        <Stack gap={2}>
          <Mono size="sm" muted className="t-label">
            Flight pattern
          </Mono>
          <Cluster gap={1} wrap>
            <Chip
              selected={flightPattern === null}
              onClick={() => setFlightPattern(null)}
            >
              DEFAULT
            </Chip>
            {FLIGHT_PATTERNS.map((p) => (
              <Chip
                key={p.id}
                selected={flightPattern === p.id}
                onClick={() => setFlightPattern(p.id)}
              >
                {p.label}
              </Chip>
            ))}
          </Cluster>
        </Stack>

        <Stack gap={2}>
          <Mono size="sm" muted className="t-label">
            Path
          </Mono>
          <Cluster gap={1} wrap>
            <Chip
              selected={pathPreset === null}
              onClick={() => setPathPreset(null)}
              disabled={flightPattern !== null}
              title={flightPattern !== null ? "Pattern is active; clear pattern to use a path" : undefined}
            >
              NONE
            </Chip>
            {PATH_PRESETS.map((p) => (
              <Chip
                key={p.id}
                selected={pathPreset === p.id}
                onClick={() => setPathPreset(p.id)}
                disabled={flightPattern !== null}
                title={
                  flightPattern !== null
                    ? "Pattern is active; clear pattern to use a path"
                    : p.id === "FREEHAND"
                      ? "Add waypoints with the +WAYPOINT tool on the map editor"
                      : undefined
                }
              >
                {p.label}
              </Chip>
            ))}
          </Cluster>
          {flightPattern !== null ? (
            <Mono size="sm" muted>
              Pattern wins when both are set — path will be ignored at launch.
            </Mono>
          ) : null}
        </Stack>
      </Stack>
    </Surface>
  );
}
