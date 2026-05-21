import type { TickSnapshot } from "@specter/sim-core";
import type { MapAttack } from "./contacts";

export type PhantomWitnessMap = Record<string, ReadonlyArray<string>>;

export function computePhantomWitnesses(
  snapshots: ReadonlyArray<TickSnapshot>,
  mapAttacks: ReadonlyArray<MapAttack>,
  sensorRadiusM: number,
): PhantomWitnessMap {
  const out: Record<string, Set<string>> = {};
  for (const m of mapAttacks) {
    for (const p of m.phantomContacts) {
      out[p.id] = new Set();
    }
  }
  if (mapAttacks.length === 0) return {};
  const r2 = sensorRadiusM * sensorRadiusM;
  const phantoms: Array<{ id: string; x: number; y: number }> = [];
  for (const m of mapAttacks) {
    for (const p of m.phantomContacts) phantoms.push({ id: p.id, x: p.x, y: p.y });
  }
  for (const snap of snapshots) {
    for (const a of snap.agents) {
      if (a.phantom) continue;
      for (const p of phantoms) {
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        if (dx * dx + dy * dy <= r2) {
          out[p.id]!.add(a.id);
        }
      }
    }
  }
  const result: PhantomWitnessMap = {};
  for (const key of Object.keys(out)) {
    result[key] = [...out[key]!].sort();
  }
  return result;
}
