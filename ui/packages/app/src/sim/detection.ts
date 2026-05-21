import type { TickSnapshot } from "@specter/sim-core";
import type { Item } from "./world";

export type DetectionMap = Record<string, Record<string, number>>;

export function itemCenter(item: Item): { x: number; y: number } {
  if (item.kind === "uxo") return { x: item.x, y: item.y };
  if (item.kind === "vehicle") return { x: item.x, y: item.y };
  return { x: item.x + item.w / 2, y: item.y + item.h / 2 };
}

export function computeDetectionMap(
  snapshots: ReadonlyArray<TickSnapshot>,
  items: ReadonlyArray<Item>,
  sensorRadius: number,
): DetectionMap {
  const map: DetectionMap = {};
  for (const item of items) map[item.id] = {};
  const centers = new Map(items.map((it) => [it.id, itemCenter(it)] as const));
  for (const snap of snapshots) {
    for (const drone of snap.agents) {
      if (drone.phantom) continue;
      for (const item of items) {
        const c = centers.get(item.id)!;
        if (map[item.id]![drone.id] !== undefined) continue;
        const dx = drone.x - c.x;
        const dy = drone.y - c.y;
        if (Math.hypot(dx, dy) <= sensorRadius) {
          map[item.id]![drone.id] = snap.tick;
        }
      }
    }
  }
  return map;
}

export function observersAt(
  map: DetectionMap,
  itemId: string,
  tick: number,
): string[] {
  const seen = map[itemId];
  if (!seen) return [];
  const out: string[] = [];
  for (const droneId of Object.keys(seen)) {
    if (seen[droneId]! <= tick) out.push(droneId);
  }
  return out;
}
