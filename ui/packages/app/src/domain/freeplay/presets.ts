import type { ComposerPreset } from "./presetSchema";

/** Built-in presets — immutable, prepended to the user's saved list. */
export const BUILT_IN_PRESETS: ReadonlyArray<ComposerPreset> = [
  {
    id: "builtin-l02-beta-recovery",
    name: "L02 BETA RECOVERY",
    attackIds: ["liar_then_heals"],
    attackSchedules: {
      liar_then_heals: { startTick: 60, endTick: 260 },
    },
    flightPattern: null,
    pathPreset: null,
    pathWaypoints: null,
    mapPresetId: "WAREHOUSE_40x40",
    beaconCount: 4,
    beaconLayoutName: "perimeter",
    beaconPositions: null,
    builtIn: true,
  },
  {
    id: "builtin-l05-mid-mission-flip",
    name: "L05 MID-MISSION FLIP",
    attackIds: ["sleeper_pose_liar"],
    attackSchedules: {
      sleeper_pose_liar: { startTick: 300, endTick: 700 },
    },
    flightPattern: null,
    pathPreset: null,
    pathWaypoints: null,
    mapPresetId: "WAREHOUSE_40x40",
    beaconCount: 4,
    beaconLayoutName: "perimeter",
    beaconPositions: null,
    builtIn: true,
  },
];
