/** Reportable point feature in the world — UXO, FOB, vehicle, etc.
 * TS parity to `src/specter/sim/world.py:Item` (ADR 0019). Distinguished
 * from `Landmark` (jointly-estimated SLAM feature, ADR 0016) by being a
 * *contact* reported into the Common Operating Picture.
 */
export type Item = {
  id: string;
  kind: string;
  x: number;
  y: number;
};

export const DEFAULT_COP_SENSOR_RADIUS_M = 50.0;

/** Euclidean distance from a peer to an item. Used to gate which honest
 * peers emit a ContactReport for which Item each tick. */
export function distanceToItem(peerX: number, peerY: number, item: Item): number {
  const dx = peerX - item.x;
  const dy = peerY - item.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function withinSensorRadius(
  peerX: number,
  peerY: number,
  item: Item,
  radiusM: number = DEFAULT_COP_SENSOR_RADIUS_M,
): boolean {
  return distanceToItem(peerX, peerY, item) <= radiusM;
}
