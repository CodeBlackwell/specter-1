import type { Observation, PoseReport } from "./messages";
import type { Rng } from "./rng";

export const RANGE_LIE_BIAS_M = 3.0;
export const COLLUDER_PAIR_BIAS_M = 3.0;
export const FUZZ_RANGE_SIGMA = 5.0;
export const FUZZ_BEARING_SIGMA = 1.0;
export const SPOOF_OFFSET = 2.0;
export const POSE_LIE_OFFSET_M = 5.0;
export const DRIFT_POSE_PER_TICK_M = 0.05;
export const ODOMETRY_BIAS_RAD_PER_TICK = 0.05;

export type AttackFn = (obs: Observation) => Observation;

export type Attacker = {
  agentId: string;
  attackFn: AttackFn;
  /** 1-indexed tick at which this attacker first fires. Default: scenario-level
   * `spec.attackStartTick` (resolved by the runner). */
  startTick?: number;
  /** 1-indexed tick at which this attacker stops firing. Default: scenario-level
   * `spec.attackEndTick` (resolved by the runner). */
  endTick?: number;
};

export function rangeLie(attackerId: string, biasM: number = RANGE_LIE_BIAS_M): Attacker {
  return {
    agentId: attackerId,
    attackFn: (obs) =>
      obs.observer_id === attackerId ? { ...obs, range_m: obs.range_m + biasM } : obs,
  };
}

export function colluderPair(
  aId: string,
  bId: string,
  biasM: number = COLLUDER_PAIR_BIAS_M,
): [Attacker, Attacker] {
  const apply = (obs: Observation): Observation => {
    const matches =
      (obs.observer_id === aId && obs.subject_id === bId) ||
      (obs.observer_id === bId && obs.subject_id === aId);
    return matches ? { ...obs, range_m: obs.range_m + biasM } : obs;
  };
  return [
    { agentId: aId, attackFn: apply },
    { agentId: bId, attackFn: apply },
  ];
}

export function sensorFuzz(
  attackerId: string,
  rng: Rng,
  rangeSigma: number = FUZZ_RANGE_SIGMA,
  bearingSigma: number = FUZZ_BEARING_SIGMA,
): Attacker {
  return {
    agentId: attackerId,
    attackFn: (obs) =>
      obs.observer_id === attackerId
        ? {
            ...obs,
            range_m: obs.range_m + rng.gauss(0, rangeSigma),
            bearing_rad: obs.bearing_rad + rng.gauss(0, bearingSigma),
          }
        : obs,
  };
}

export function beaconSpoof(attackerId: string, offsetM: number = SPOOF_OFFSET): Attacker {
  return {
    agentId: attackerId,
    attackFn: (obs) =>
      obs.observer_id === attackerId ? { ...obs, range_m: obs.range_m + offsetM } : obs,
  };
}

export function applyAttacks(
  obs: Observation,
  attackers: ReadonlyArray<Attacker>,
  tickIndex1?: number,
): Observation {
  let out = obs;
  for (const a of attackers) {
    if (tickIndex1 != null) {
      if (a.startTick != null && tickIndex1 < a.startTick) continue;
      if (a.endTick != null && tickIndex1 >= a.endTick) continue;
    }
    out = a.attackFn(out);
  }
  return out;
}

// Pose-report attacks. Unlike Observation attacks (which mutate per-beacon
// outputs of the honest agent), these synthesize lying PoseReports for the
// scenario runner to inject via the existing `injectedPoseReports` hook.
// The shape mirrors `tests/eval/runner.py` Python attack semantics so the
// Python and TS battery converge on the same wire-level evidence stream.

export type PoseAttacker = {
  agentId: string;
  /** Generate a lying PoseReport for this tick, or null to emit nothing. */
  generate: (tick: number, ts: bigint, truth: PoseReport | undefined) => PoseReport | null;
  /** 1-indexed tick at which this attacker first fires. Default: scenario-level
   * `spec.attackStartTick` (resolved by the runner). */
  startTick?: number;
  /** 1-indexed tick at which this attacker stops firing. Default: scenario-level
   * `spec.attackEndTick` (resolved by the runner). */
  endTick?: number;
};

/** Constant pose-lie: attacker always reports the same offset from truth. */
export function poseLie(
  attackerId: string,
  offsetM: number = POSE_LIE_OFFSET_M,
): PoseAttacker {
  return {
    agentId: attackerId,
    generate: (_tick, ts, truth) => {
      if (!truth || truth.agent_id !== attackerId) return null;
      return { ...truth, x: truth.x + offsetM, y: truth.y + offsetM, timestamp_ns: ts };
    },
  };
}

/** Gradient drift: attacker's reported position drifts each tick. */
export function driftPose(
  attackerId: string,
  perTickM: number = DRIFT_POSE_PER_TICK_M,
): PoseAttacker {
  let driftedM = 0;
  return {
    agentId: attackerId,
    generate: (_tick, ts, truth) => {
      if (!truth || truth.agent_id !== attackerId) return null;
      driftedM += perTickM;
      return { ...truth, x: truth.x + driftedM, y: truth.y + driftedM, timestamp_ns: ts };
    },
  };
}

/** Odometry corruption: attacker's theta rotates each tick (constant gyro bias). */
export function odometryCorrupt(
  attackerId: string,
  biasRadPerTick: number = ODOMETRY_BIAS_RAD_PER_TICK,
): PoseAttacker {
  let driftedRad = 0;
  return {
    agentId: attackerId,
    generate: (_tick, ts, truth) => {
      if (!truth || truth.agent_id !== attackerId) return null;
      driftedRad += biasRadPerTick;
      return { ...truth, theta: truth.theta + driftedRad, timestamp_ns: ts };
    },
  };
}

// Envelope-level attacks. These act on the SecureBus state (rotating keys,
// capturing+replaying envelopes, emitting from off-roster identities) rather
// than on observation/pose data. They are applied by `runSecureScenario` in
// scenario.ts when the secureBus mode is active.

export type EnvelopeAttackKind = "swap_key" | "replay_storm";
export const REPLAY_REPETITIONS = 10;

export type EnvelopeAttack = {
  agentId: string;
  kind: EnvelopeAttackKind;
};

/** Rotate the attacker's signing keypair without updating the roster.
 * All subsequent envelopes signed by this agent fail verification. */
export function swapKey(attackerId: string): EnvelopeAttack {
  return { agentId: attackerId, kind: "swap_key" };
}

/** Re-publish the first captured envelope every tick (REPLAY_REPETITIONS times).
 * Each re-publish fails the replay window check. */
export function replayStorm(attackerId: string): EnvelopeAttack {
  return { agentId: attackerId, kind: "replay_storm" };
}

export function applyPoseAttacks(
  tick: number,
  ts: bigint,
  truths: ReadonlyArray<PoseReport>,
  attackers: ReadonlyArray<PoseAttacker>,
  tickIndex1?: number,
): PoseReport[] {
  const byAgent = new Map<string, PoseReport>();
  for (const t of truths) byAgent.set(t.agent_id, t);
  const out: PoseReport[] = [];
  const overridden = new Set<string>();
  for (const a of attackers) {
    if (tickIndex1 != null) {
      if (a.startTick != null && tickIndex1 < a.startTick) continue;
      if (a.endTick != null && tickIndex1 >= a.endTick) continue;
    }
    const lying = a.generate(tick, ts, byAgent.get(a.agentId));
    if (lying) {
      out.push(lying);
      overridden.add(a.agentId);
    }
  }
  for (const t of truths) {
    if (!overridden.has(t.agent_id)) out.push(t);
  }
  return out;
}
