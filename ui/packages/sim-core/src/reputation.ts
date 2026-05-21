export const PRIOR_ALPHA = 1.0;
export const PRIOR_BETA = 1.0;
export const DECAY_HALF_LIFE_NS = 10_000_000_000n;

export type PeerReputation = {
  alpha: number;
  beta: number;
  lastUpdateNs: bigint;
};

export function newReputation(): PeerReputation {
  return { alpha: PRIOR_ALPHA, beta: PRIOR_BETA, lastUpdateNs: 0n };
}

export function score(rep: PeerReputation): number {
  return rep.alpha / (rep.alpha + rep.beta);
}

export function decay(rep: PeerReputation, nowNs: bigint, halfLifeNs: bigint = DECAY_HALF_LIFE_NS): void {
  const dt = nowNs - rep.lastUpdateNs;
  if (dt <= 0n) return;
  const factor = Math.pow(0.5, Number(dt) / Number(halfLifeNs));
  rep.alpha = 1.0 + (rep.alpha - 1.0) * factor;
  rep.beta = 1.0 + (rep.beta - 1.0) * factor;
  rep.lastUpdateNs = nowNs;
}

export type Evidence = { alpha?: number; beta?: number };

export function observe(rep: PeerReputation, evidence: Evidence, nowNs: bigint, halfLifeNs?: bigint): void {
  decay(rep, nowNs, halfLifeNs);
  if (evidence.alpha) rep.alpha += evidence.alpha;
  if (evidence.beta) rep.beta += evidence.beta;
}
