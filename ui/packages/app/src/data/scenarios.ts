import {
  type Agent,
  type Attacker,
  type ScenarioSpec,
  beaconSpoof,
  colluderPair,
  createAgent,
  createRng,
  rangeLie,
  sensorFuzz,
} from "@specter/sim-core";
import { AO_WORLD } from "../sim/world";
import { droneSwarm, DRONE_SPEED_MS } from "../sim/droneSwarm";
import { type CoverageGrid, newCoverageGrid } from "../sim/coverage";
import { wheelPlanner } from "../sim/wheelPlanner";
import type { MapAttack } from "../sim/contacts";
import type { RejectionEvent } from "../sim/rejections";

export type AttackFamily =
  | "trust-noop"
  | "tier1"
  | "tier2"
  | "sensor"
  | "sybil"
  | "replay"
  | "gossip"
  | "cop"
  | "envelope"
  | "slam";

export type ScenarioBundle = {
  spec: ScenarioSpec;
  grid: CoverageGrid;
  mapAttack?: MapAttack;
  rejections?: ReadonlyArray<RejectionEvent>;
};

export type ComposedBundle = {
  spec: ScenarioSpec;
  grid: CoverageGrid;
  mapAttacks: ReadonlyArray<MapAttack>;
  rejections: ReadonlyArray<RejectionEvent>;
};

export type AttackEntry = {
  id: string;
  label: string;
  family: AttackFamily;
  description: string;
  build: () => ScenarioBundle;
  trustLayerNoop?: boolean;
};

const DEFAULT_TICKS = 900;
const DEFAULT_DT = 0.1;
export const DEFAULT_ATTACK_START_TICK = 30;
export const BEACON_RANGE_M = 60;
export const COVERAGE_CELL_M = 2.5;
export const WHEEL_REACH_TOL = 2.0;

function buildSwarm(): { agents: Agent[]; grid: CoverageGrid; spec: ScenarioSpec } {
  const { agents, launchTicks, homeSlots } = droneSwarm();
  const grid = newCoverageGrid(AO_WORLD.bounds, COVERAGE_CELL_M);
  const planner = wheelPlanner(grid, {
    bounds: AO_WORLD.bounds,
    sensorRadius: AO_WORLD.sensorRadiusM,
    speedMs: DRONE_SPEED_MS,
    reachTolerance: WHEEL_REACH_TOL,
    launchTicks,
    homeSlots,
  });
  const spec: ScenarioSpec = {
    agents,
    ticks: DEFAULT_TICKS,
    swarmOpts: { dt: DEFAULT_DT, beaconOpts: { maxRangeM: BEACON_RANGE_M } },
    planner,
  };
  return { agents, grid, spec };
}

function honest(): ScenarioBundle {
  const { grid, spec } = buildSwarm();
  return { spec, grid };
}

const HONEST_TARGETS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7"];

function forgedEnvelopeRejections(): RejectionEvent[] {
  const events: RejectionEvent[] = [];
  let step = 0;
  for (let tick = DEFAULT_ATTACK_START_TICK; tick <= 500; tick += 3) {
    const targetId = HONEST_TARGETS[step % HONEST_TARGETS.length]!;
    events.push({
      tick,
      reason: "signature",
      fromId: "X0",
      fromX: 105,
      fromY: 50,
      toId: targetId,
      detail: "SIG INVALID · X0 not in roster",
      causedByEvent: { kind: "forged_envelope", atTick: DEFAULT_ATTACK_START_TICK },
    });
    step++;
  }
  return events;
}

function badKeyRejections(): RejectionEvent[] {
  const events: RejectionEvent[] = [];
  let step = 0;
  for (let tick = DEFAULT_ATTACK_START_TICK; tick <= 500; tick += 2) {
    const targetId = HONEST_TARGETS[step % HONEST_TARGETS.length]!;
    events.push({
      tick,
      reason: "signature",
      fromId: "A0",
      fromX: null,
      fromY: null,
      toId: targetId,
      detail: "SIG INVALID · A0 key mismatch (mid-mission key change)",
      causedByEvent: { kind: "swap_key", atTick: DEFAULT_ATTACK_START_TICK },
    });
    step++;
  }
  return events;
}

function windowedAttacker(inner: Attacker, stopTick: number): Attacker {
  const stopNs = BigInt(Math.round(stopTick * DEFAULT_DT * 1_000_000_000));
  return {
    agentId: inner.agentId,
    attackFn: (obs) => (obs.timestamp_ns <= stopNs ? inner.attackFn(obs) : obs),
  };
}

export function composeBundles(bundles: ReadonlyArray<ScenarioBundle>): ComposedBundle {
  if (bundles.length === 0) throw new Error("composeBundles: need at least one bundle");
  const first = bundles[0]!;
  if (bundles.length === 1) {
    return {
      spec: first.spec,
      grid: first.grid,
      mapAttacks: first.mapAttack ? [first.mapAttack] : [],
      rejections: first.rejections ?? [],
    };
  }
  const agentById = new Map<string, Agent>();
  for (const b of bundles) for (const a of b.spec.agents) agentById.set(a.id, a);
  const agents = [...agentById.values()];
  const attackers = bundles.flatMap((b) => b.spec.attackers ?? []);
  const mapAttacks = bundles.flatMap((b) => (b.mapAttack ? [b.mapAttack] : []));
  const rejections = bundles.flatMap((b) => b.rejections ?? []);
  const linkPredicates = bundles
    .map((b) => b.spec.linkPredicate)
    .filter((p): p is NonNullable<typeof p> => Boolean(p));
  const injectedObservations = (tick: number, ts: bigint) =>
    bundles.flatMap((b) => b.spec.injectedObservations?.(tick, ts) ?? []);
  const injectedPoseReports = (tick: number, ts: bigint) =>
    bundles.flatMap((b) => b.spec.injectedPoseReports?.(tick, ts) ?? []);
  const spec: ScenarioSpec = {
    agents,
    ticks: first.spec.ticks,
    swarmOpts: first.spec.swarmOpts,
    planner: first.spec.planner,
    attackers,
    attackStartTick: first.spec.attackStartTick,
    gossipRoundEvery: bundles.reduce(
      (m, b) => Math.max(m, b.spec.gossipRoundEvery ?? 0),
      0,
    ) || undefined,
    linkPredicate:
      linkPredicates.length === 0
        ? undefined
        : (o, r) => linkPredicates.every((p) => p(o, r)),
    injectedObservations: bundles.some((b) => b.spec.injectedObservations)
      ? injectedObservations
      : undefined,
    injectedPoseReports: bundles.some((b) => b.spec.injectedPoseReports)
      ? injectedPoseReports
      : undefined,
    rumorSubject: bundles.find((b) => b.spec.rumorSubject)?.spec.rumorSubject,
    cliques: bundles.find((b) => b.spec.cliques)?.spec.cliques,
  };
  return { spec, grid: first.grid, mapAttacks, rejections };
}

function replayStormRejections(): RejectionEvent[] {
  const events: RejectionEvent[] = [];
  // The "captured" envelope was sealed at attack-start; every subsequent replay
  // points back to that tick so the UI can surface the temporal link.
  const originalTick = DEFAULT_ATTACK_START_TICK;
  for (let tick = DEFAULT_ATTACK_START_TICK; tick <= 500; tick += 2) {
    events.push({
      tick,
      reason: "replay",
      fromId: "A0",
      fromX: null,
      fromY: null,
      toId: "A2",
      detail: `replay of envelope from tick ${originalTick}`,
      originalSealTick: originalTick,
      causedByEvent: { kind: "replay_storm", atTick: originalTick },
    });
  }
  return events;
}

export const ATTACK_CATALOG: ReadonlyArray<AttackEntry> = [
  {
    id: "honest",
    label: "Honest",
    family: "trust-noop",
    description: "No attack. Baseline cooperative AO survey.",
    build: honest,
  },
  {
    id: "forged_envelope",
    label: "forged_envelope",
    family: "envelope",
    description: "External adversary X0 (not in the signed roster) attempts to inject observations into the swarm every few ticks. Every attempt fails signature verification at the envelope boundary — the trust evaluator and map merger never see them. Lesson 01 in motion.",
    build: () => {
      const { grid, spec } = buildSwarm();
      return { spec, grid, rejections: forgedEnvelopeRejections() };
    },
  },
  {
    id: "bad_key",
    label: "bad_key",
    family: "envelope",
    description: "Compromised drone A0's signing key changes mid-mission (forced rotation, key compromise + replacement, or unauthorized swap). A0 IS in the signed roster but the keypair it now signs with doesn't match the roster's public key. Every observation it broadcasts fails ECDSA signature verification at receivers — tagged ✗ SIG INVALID · A0 key mismatch. The trust evaluator and map merger never see the bad-keyed envelopes. Pairs with notebook 08's `single_bad_key` battery row — same defense (envelope sig + roster), two surfaces.",
    build: () => {
      const { grid, spec } = buildSwarm();
      return { spec, grid, rejections: badKeyRejections() };
    },
  },
  {
    id: "replay_storm",
    label: "replay_storm",
    family: "replay",
    description: "Adversary captures a real A0→A2 observation (nonce 5) and re-broadcasts it every other tick. A2's per-sender high-water-mark nonce has long since advanced past 5, so each replay drops silently below the window. Lesson 02 in motion — consensus untouched under flood.",
    build: () => {
      const { grid, spec } = buildSwarm();
      return { spec, grid, rejections: replayStormRejections() };
    },
  },
  {
    id: "range_lie",
    label: "range_lie",
    family: "tier1",
    description: "Compromised drone inflates outbound beacon ranges. Tier 1 reciprocal disagreement.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      return {
        grid,
        spec: {
          ...spec,
          attackers: [rangeLie(agents[0]!.id, 4.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "late_range_lie",
    label: "late_range_lie",
    family: "tier1",
    description: "Compromised drone goes byzantine mid-mission: A0 flies honestly until tick 120, then begins inflating ranges by 4m. Demonstrates that detection-time is measured from the *first* bad observation, not mission start — the swarm catches it just as fast even after a long honest stretch.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      return {
        grid,
        spec: {
          ...spec,
          attackers: [rangeLie(agents[0]!.id, 4.0)],
          attackStartTick: 120,
        },
      };
    },
  },
  {
    id: "recovery_after_lie",
    label: "recovery_after_lie",
    family: "tier1",
    description: "Compromised drone A0 lies for 200 ticks (30–230) then goes silent. A0's reputation collapses on the lie and holds at floor while the bad readings keep coming, then Beta(α,β) decay with a 10-second half-life gradually returns rep toward the prior as honest observations re-accumulate. Demonstrates that one bad reading isn't a permanent sentence — false-positive recovery is built into the math.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const inner = rangeLie(agents[0]!.id, 4.0);
      return {
        grid,
        spec: {
          ...spec,
          attackers: [windowedAttacker(inner, 230)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "colluder_pair",
    label: "colluder_pair",
    family: "tier2",
    description: "Two compromised drones symmetrically inflate their mutual range. Tier 1 evades; Tier 2 catches.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      return {
        grid,
        spec: {
          ...spec,
          // Tightened from the default 900 → 500 ticks. attackStartTick
          // 115 is the earliest empirically-reliable ignition: anything
          // before ~tick 115 fires while the wheel-planner formation is
          // still in motion, so MDS sees ambiguous geometry and Tier-2
          // never sticks. At 115 the colluders' reputations cross 0.5
          // by tick 200, below 0.3 by tick ~290, and settle below 0.15
          // by tick 400 — the collapse is clearly visible in the rep
          // strip from tick 200 onward and dramatic by tick 300.
          ticks: 500,
          attackers: colluderPair(agents[0]!.id, agents[1]!.id, 6.0),
          attackStartTick: 115,
        },
      };
    },
  },
  {
    id: "beacon_spoof",
    label: "beacon_spoof",
    family: "tier1",
    description: "Compromised drone A0 inflates outgoing beacon ranges by a milder 2m bias (vs range_lie's 4m). Same Tier 1 reciprocal-range detector, but the subtler signal means the reputation collapse takes a few more cohort closures to cross threshold. Pairs with notebook 08's `beacon_spoof` battery row — same defense, same eval bound, two surfaces.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      return {
        grid,
        spec: {
          ...spec,
          attackers: [beaconSpoof(agents[0]!.id, 2.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "sensor_fuzz",
    label: "sensor_fuzz",
    family: "sensor",
    description: "Compromised drone emits noisy beacons (σ=5m range). Tier 1 detects via reciprocal gap.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      return {
        grid,
        spec: {
          ...spec,
          attackers: [sensorFuzz(agents[0]!.id, createRng(13))],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "cop_phantom",
    label: "cop_phantom",
    family: "cop",
    description: "Compromised drone A0 reports a phantom UXO inside the AO while also lying on range (Tier 1). As A0's reputation collapses, the trust-weighted COP filter suppresses the phantom contact.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const reporterId = agents[0]!.id;
      const mapAttack: MapAttack = {
        reporterId,
        phantomContacts: [
          { id: "phantom-uxo-1", x: 75, y: 75, label: "ALLEGED UXO γ" },
        ],
        suppressedItemIds: [],
      };
      return {
        grid,
        mapAttack,
        spec: {
          ...spec,
          attackers: [rangeLie(reporterId, 4.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "cop_suppress",
    label: "cop_suppress",
    family: "cop",
    description: "Compromised drone A0 hides UXO-β (a real threat) from its contact reports while lying on range. Other drones overfly the same area honestly, so the COP still surfaces the UXO via redundancy — A0's blackout fails.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const reporterId = agents[0]!.id;
      const mapAttack: MapAttack = {
        reporterId,
        phantomContacts: [],
        suppressedItemIds: ["uxo-bravo"],
      };
      return {
        grid,
        mapAttack,
        spec: {
          ...spec,
          attackers: [rangeLie(reporterId, 4.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "cop_fob_corrupt",
    label: "cop_fob_corrupt",
    family: "cop",
    description: "Compromised drone A0 hides the friendly FOB and reports a phantom HOSTILE FOB on the opposite corner — attempting to corrupt the swarm's spatial anchor. Trust-weighted COP suppresses the phantom once A0's reputation collapses; the real FOB stays surfaced by honest reporters.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const reporterId = agents[0]!.id;
      const mapAttack: MapAttack = {
        reporterId,
        phantomContacts: [
          { id: "phantom-fob-1", x: 88, y: 88, label: "HOSTILE FOB CLAIM" },
        ],
        suppressedItemIds: ["fob-stalwart"],
      };
      return {
        grid,
        mapAttack,
        spec: {
          ...spec,
          attackers: [rangeLie(reporterId, 4.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "cop_corruption_full",
    label: "cop_corruption_full",
    family: "cop",
    description: "Compromised drone A0 corrupts the map maximally: plants a phantom UXO inside the AO, plants a HOSTILE FOB CLAIM in the opposite corner, hides the real UXO-β, and hides the friendly FOB STALWART — all while lying on inter-drone range. Trust-weighted COP filter suppresses both phantoms once A0's reputation collapses; the real contacts stay surfaced by honest reporters. Three flavors of map-layer attack defeated by one defense.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const reporterId = agents[0]!.id;
      const mapAttack: MapAttack = {
        reporterId,
        phantomContacts: [
          { id: "phantom-uxo-1", x: 75, y: 75, label: "ALLEGED UXO γ" },
          { id: "phantom-fob-1", x: 88, y: 88, label: "HOSTILE FOB CLAIM" },
        ],
        suppressedItemIds: ["uxo-bravo", "fob-stalwart"],
      };
      return {
        grid,
        mapAttack,
        spec: {
          ...spec,
          attackers: [rangeLie(reporterId, 4.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
        },
      };
    },
  },
  {
    id: "sybil_cabal",
    label: "sybil_cabal",
    family: "sybil",
    description: "Two phantom drones emit mutual observations + pose reports from outside the AO. V3 presence rejects them — no real drone ever beacons them.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const sybilA = createAgent({ id: "S0", x: 120, y: 50, phantom: true });
      const sybilB = createAgent({ id: "S1", x: -20, y: 50, phantom: true });
      const realId = agents[0]!.id;
      return {
        grid,
        spec: {
          ...spec,
          agents: [...agents, sybilA, sybilB],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
          injectedObservations: (_tick, ts) => [
            { observer_id: "S0", subject_id: "S1", range_m: 140, bearing_rad: Math.PI, timestamp_ns: ts },
            { observer_id: "S1", subject_id: "S0", range_m: 140, bearing_rad: 0, timestamp_ns: ts },
            { observer_id: "S0", subject_id: realId, range_m: 50, bearing_rad: Math.PI, timestamp_ns: ts },
            { observer_id: "S1", subject_id: realId, range_m: 50, bearing_rad: 0, timestamp_ns: ts },
          ],
          injectedPoseReports: (_tick, ts) => [
            { agent_id: "S0", x: 120, y: 50, theta: 0, timestamp_ns: ts },
            { agent_id: "S1", x: -20, y: 50, theta: 0, timestamp_ns: ts },
          ],
          gossipRoundEvery: 20,
          rumorSubject: "S0",
        },
      };
    },
  },
  {
    id: "partition_gossip",
    label: "partition_gossip",
    family: "gossip",
    description: "Swarm splits into two cliques. A0 lies — its clique catches it directly; the other clique only learns via gossip rounds.",
    build: () => {
      const { agents, grid, spec } = buildSwarm();
      const half = Math.ceil(agents.length / 2);
      const groupAIds = agents.slice(0, half).map((a) => a.id);
      const groupBIds = agents.slice(half).map((a) => a.id);
      const groupA = new Set(groupAIds);
      return {
        grid,
        spec: {
          ...spec,
          attackers: [rangeLie(agents[0]!.id, 4.0)],
          attackStartTick: DEFAULT_ATTACK_START_TICK,
          gossipRoundEvery: 20,
          linkPredicate: (observerId, receiverId) => groupA.has(observerId) === groupA.has(receiverId),
          rumorSubject: agents[0]!.id,
          cliques: [groupAIds, groupBIds],
        },
      };
    },
  },
  {
    id: "pose_lie",
    label: "pose_lie",
    family: "trust-noop",
    description: "Self-pose lie. Trust layer no-op (ADR 0015) — only the map merger sees it.",
    build: honest,
    trustLayerNoop: true,
  },
  {
    id: "drift_pose",
    label: "drift_pose",
    family: "trust-noop",
    description: "Self-pose drift over time. Trust layer no-op.",
    build: honest,
    trustLayerNoop: true,
  },
  // SLAM lesson catalog entries. These are AttackDock placeholders only —
  // the actual demo lives in the lesson's dedicated canvas (SlamCanvas,
  // CooperativeSlamCanvas, ClosedLoopSlamCanvas). The runScenario path is
  // not exercised for SLAM lessons; the canvas calls runSingleAgentLoopClosureDemo
  // or runCooperativeSlamDemo directly. `trustLayerNoop: true` keeps the
  // trust panels quiet since SLAM lessons don't drive range-only voting.
  {
    id: "slam_loop_closure",
    label: "slam_loop_closure",
    family: "slam",
    description: "L09 canvas — single agent walks a 12-pose rectangular loop with landmark co-visibility at start and return. Snapshots step pre-optimize → post-LM → post-closure; loop closure detection (ADR 0017) snaps the drift back onto truth. The L09 SlamCanvas owns the demo data path; the regular tick player is not used.",
    build: honest,
    trustLayerNoop: true,
  },
  {
    id: "slam_cooperative_honest",
    label: "slam_cooperative_honest",
    family: "slam",
    description: "L10 canvas — four agents survey shared landmarks; cooperative connectivity via shared landmark observations plus an odometry ring anchoring all agents to A1's gauge. Demonstrates the cooperative gain. The L10 CooperativeSlamCanvas (scenario=\"honest\") owns the demo data path.",
    build: honest,
    trustLayerNoop: true,
  },
  {
    id: "slam_pose_lie_naive",
    label: "slam_pose_lie_naive",
    family: "slam",
    description: "L11 canvas — A0 broadcasts landmark observations as if its self-pose were offset by (1m, 1m). Without reputation gating, the joint optimizer compromises between the lie and honest peers, leaving landmarks visibly off truth. The L11 CooperativeSlamCanvas (scenario=\"pose_lie_naive\") owns the demo data path.",
    build: honest,
    trustLayerNoop: true,
  },
  {
    id: "slam_pose_lie_robust",
    label: "slam_pose_lie_robust",
    family: "slam",
    description: "L12 canvas — same lying setup as slam_pose_lie_naive, plus the bidirectional closed loop (ADR 0020). Five cycles: each optimize emits SLAM residuals → updates A0's reputation → next cycle down-weights A0's factors. Canvas toggle compares bidirectional ON vs OFF side-by-side. The L12 ClosedLoopSlamCanvas owns the demo data path.",
    build: honest,
    trustLayerNoop: true,
  },
  {
    id: "slam_singleton_lie",
    label: "slam_singleton_lie",
    family: "slam",
    description: "L14 canvas — same four-agent closed loop as L12, but A0 *additionally* reports a 5th landmark (`lm-singleton`) that no other agent ever observes. Shared landmarks recover via the ADR 0020 bidirectional loop; the singleton is structurally invisible to residual disagreement (no consensus to disagree with) and is bounded instead by the ADR 0022 singleton confidence cap (`Ω_eff = 0.3 · r_now · Ω_base`). The L14 ClosedLoopSlamCanvas owns the demo data path; the singleton appears in the landmark set with no truth pairing because there is no shared truth for an uncorroborated landmark.",
    build: honest,
    trustLayerNoop: true,
  },
];

export const FAMILY_COLOR: Record<AttackFamily, string> = {
  "trust-noop": "var(--text-low)",
  tier1: "var(--status-flagged)",
  tier2: "var(--status-byzantine)",
  sensor: "var(--lesson-intuition)",
  sybil: "var(--accent-primary)",
  replay: "var(--status-nominal)",
  gossip: "var(--accent-primary)",
  cop: "var(--status-byzantine)",
  envelope: "var(--status-nominal)",
  slam: "var(--accent-primary)",
};
