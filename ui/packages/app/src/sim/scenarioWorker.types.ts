import type { BeaconLayoutName, FlightPattern, TickSnapshot } from "@specter/sim-core";
import type { CoverageGrid } from "./coverage";
import type { ContactReport, MapAttack } from "./contacts";
import type { DetectionMap } from "./detection";
import type { PhantomWitnessMap } from "./phantomWitnesses";
import type { RejectionEvent } from "./rejections";

export type AttackSchedule = { startTick: number; endTick: number };

export type PathPresetId = "LOOP" | "LINEAR" | "FIGURE-8" | "FREEHAND";

/** Wave 4 — Free Play map config. When supplied to the worker, beacon
 * positions are derived from `presetId` + `beaconLayoutName` + `beaconCount`,
 * unless the caller passes explicit `beaconPositions` (Wave 6 map editor).
 * Absence preserves the legacy `AO_WORLD` behavior byte-for-byte. */
export type MapConfig = {
  presetId: string;
  beaconCount: number;
  beaconLayoutName: BeaconLayoutName;
  beaconPositions?: ReadonlyArray<[number, number]>;
};

export type WorkerRequest = {
  id: number;
  attackIds: ReadonlyArray<string>;
  attackStartTick?: number;
  /** Per-attack-id window. When present, every Attacker emitted by that
   * attack's bundle gets `startTick`/`endTick` set to this window. */
  attackSchedules?: Record<string, AttackSchedule>;
  /** Flight pattern (Wave 2). When set and the composed spec doesn't already
   * have a planner of its own, the worker attaches a default planner derived
   * from this pattern + the AO world bounds. */
  flightPattern?: FlightPattern;
  /** Wave 3: preset name driving the agents' path. Resolved against
   * `AO_WORLD.bounds` for LOOP/LINEAR/FIGURE-8; FREEHAND requires
   * `pathWaypoints`. Only honored when the composed spec has no planner
   * of its own (so lesson fixtures keep their own motion). Composition with
   * `flightPattern` is a Wave 5 UI concern — at the engine layer, whichever
   * config is set first attaches its planner; the other is ignored. */
  pathPreset?: PathPresetId | null;
  /** Wave 3: explicit waypoints, supplied by the Wave 6 map editor or any
   * caller that wants to bypass preset geometry. Required for FREEHAND. */
  pathWaypoints?: ReadonlyArray<[number, number]> | null;
  /** Wave 4: map preset + beacon layout. When omitted, worker uses the
   * legacy `AO_WORLD` items byte-for-byte (back-compat for lessons). */
  mapConfig?: MapConfig;
};

export type WorkerSliceTail = {
  attackStartTick: number;
  hasAttackers: boolean;
  /** De-duplicated agent ids that the composed scenario marked as adversarial.
   * Carries IDs only (the AttackFn closures can't cross the worker boundary).
   * Powers lesson-level overlays that need to identify the lying agents
   * before the trust layer's reputation collapse makes them visible. */
  attackerIds: ReadonlyArray<string>;
  sensorRadiusM: number;
  coverageGrid: CoverageGrid;
  mapAttacks: ReadonlyArray<MapAttack>;
  rejections: ReadonlyArray<RejectionEvent>;
  detectionMap: DetectionMap;
  contactReports: ContactReport[];
  phantomWitnesses: PhantomWitnessMap;
  rumorSubject?: string;
  cliques?: ReadonlyArray<ReadonlyArray<string>>;
  /** Wave 4 — effective beacon anchor positions for the active map config.
   * Undefined when no `mapConfig` was supplied (legacy AO_WORLD path). */
  beaconPositions?: ReadonlyArray<[number, number]>;
};

export type WorkerResponse =
  | { id: number; kind: "chunk"; chunk: TickSnapshot[]; soFar: number; total: number }
  | { id: number; kind: "done"; tail: WorkerSliceTail }
  | { id: number; kind: "error"; error: string };
