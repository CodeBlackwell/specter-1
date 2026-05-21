import type { BeaconLayoutName, FlightPattern } from "@specter/sim-core";
import type { AttackSchedule, PathPresetId } from "../../sim/scenarioWorker.types";

const PRESETS_STORAGE_KEY = "specter1.freeplay.presets.v1";
const CURRENT_VERSION = 1;

export type ComposerPreset = {
  id: string;
  name: string;
  attackIds: ReadonlyArray<string>;
  attackSchedules: Record<string, AttackSchedule>;
  flightPattern: FlightPattern | null;
  pathPreset: PathPresetId | null;
  pathWaypoints: ReadonlyArray<[number, number]> | null;
  mapPresetId: string;
  beaconCount: number;
  beaconLayoutName: BeaconLayoutName;
  beaconPositions: ReadonlyArray<[number, number]> | null;
  builtIn?: boolean;
};

type Persisted = {
  version: number;
  presets: ComposerPreset[];
};

export function loadUserPresets(): ComposerPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.version !== CURRENT_VERSION || !Array.isArray(parsed.presets)) return [];
    return parsed.presets;
  } catch {
    return [];
  }
}

export function saveUserPresets(presets: ReadonlyArray<ComposerPreset>): void {
  try {
    const payload: Persisted = { version: CURRENT_VERSION, presets: [...presets] };
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage unavailable (private mode, quota) — silently no-op.
  }
}

export function newPresetId(): string {
  return `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
