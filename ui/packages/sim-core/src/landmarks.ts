/**
 * Stationary point features for the pose-graph SLAM substrate (ADR 0016 §5).
 * A landmark's world position is jointly estimated by the optimizer from
 * agent observations; the values stored here are ground truth used only by
 * the world model + evals.
 *
 * Mirrors the Python `specter.sim.world.Landmark` shape so parity fixtures
 * round-trip Python→TS with byte-equal canonical-JSON encoding.
 */

export type Landmark = {
  id: string;
  x: number;
  y: number;
};

/**
 * Deterministic grid of landmarks across a rectangular AO. Spacing chosen
 * so a single agent at typical workshop kinematics sees 4–8 landmarks per
 * sensor footprint at `BEACON_MAX_RANGE_M = 12 m` (ADR 0005).
 *
 * The id is `lm-{ix}-{iy}` (zero-padded to 2 digits) so it sorts
 * lexicographically and stays stable across regenerations.
 */
export function gridLandmarks(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  spacingM: number,
): Landmark[] {
  const out: Landmark[] = [];
  const nx = Math.floor((maxX - minX) / spacingM) + 1;
  const ny = Math.floor((maxY - minY) / spacingM) + 1;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      out.push({
        id: `lm-${String(ix).padStart(2, "0")}-${String(iy).padStart(2, "0")}`,
        x: minX + ix * spacingM,
        y: minY + iy * spacingM,
      });
    }
  }
  return out;
}

/**
 * Predicate: is landmark `lm` visible from agent at `(ax, ay)` with sensor
 * radius `radiusM`? Pure geometric range check — no occlusion model.
 * Wave 1 may extend with a wall-occlusion test once the world primitive
 * carries walls (TS side currently doesn't ship walls in sim-core).
 */
export function landmarkVisible(
  lm: Landmark,
  ax: number,
  ay: number,
  radiusM: number,
): boolean {
  const dx = lm.x - ax;
  const dy = lm.y - ay;
  return dx * dx + dy * dy <= radiusM * radiusM;
}
