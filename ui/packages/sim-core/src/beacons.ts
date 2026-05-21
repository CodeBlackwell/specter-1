import type { Agent } from "./agent";
import type { Rng } from "./rng";

export const BEACON_MAX_RANGE_M = 8.0;
export const BEACON_RANGE_SIGMA = 0.10;
export const BEACON_BEARING_SIGMA = (5.0 * Math.PI) / 180.0;
export const BEACON_NLOS_PROB = 0.02;
export const BEACON_NLOS_BIAS = 0.5;

export type BeaconReturn = {
  subject_id: string;
  range_m: number;
  bearing_rad: number;
  t: number;
};

export type BeaconOptions = {
  maxRangeM?: number;
  rangeSigma?: number;
  bearingSigma?: number;
  nlosProb?: number;
  nlosBias?: number;
};

export function rangeBeaconsExact(observer: Agent, peers: ReadonlyArray<Agent>, t: number, maxRangeM = BEACON_MAX_RANGE_M): BeaconReturn[] {
  const out: BeaconReturn[] = [];
  for (const peer of peers) {
    if (peer.id === observer.id) continue;
    const dx = peer.x - observer.x;
    const dy = peer.y - observer.y;
    const trueRange = Math.hypot(dx, dy);
    if (trueRange > maxRangeM) continue;
    const trueBearing = Math.atan2(dy, dx) - observer.theta;
    out.push({ subject_id: peer.id, range_m: trueRange, bearing_rad: trueBearing, t });
  }
  return out;
}

export function rangeBeacons(
  observer: Agent,
  peers: ReadonlyArray<Agent>,
  rng: Rng,
  t: number,
  opts: BeaconOptions = {},
): BeaconReturn[] {
  const maxRangeM = opts.maxRangeM ?? BEACON_MAX_RANGE_M;
  const rangeSigma = opts.rangeSigma ?? BEACON_RANGE_SIGMA;
  const bearingSigma = opts.bearingSigma ?? BEACON_BEARING_SIGMA;
  const nlosProb = opts.nlosProb ?? BEACON_NLOS_PROB;
  const nlosBias = opts.nlosBias ?? BEACON_NLOS_BIAS;
  const out: BeaconReturn[] = [];
  for (const peer of peers) {
    if (peer.id === observer.id) continue;
    const dx = peer.x - observer.x;
    const dy = peer.y - observer.y;
    const trueRange = Math.hypot(dx, dy);
    if (trueRange > maxRangeM) continue;
    const trueBearing = Math.atan2(dy, dx) - observer.theta;
    let range_m = trueRange + rng.gauss(0, rangeSigma);
    if (rng.next() < nlosProb) range_m += nlosBias;
    const bearing_rad = trueBearing + rng.gauss(0, bearingSigma);
    out.push({ subject_id: peer.id, range_m, bearing_rad, t });
  }
  return out;
}
