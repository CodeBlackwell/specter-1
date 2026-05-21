import type { Agent } from "./agent";
import type { Attacker, EnvelopeAttack, PoseAttacker } from "./attacks";
import { applyAttacks, applyPoseAttacks, REPLAY_REPETITIONS } from "./attacks";
import {
  buildCop,
  COP_TRUST_THRESHOLD,
  emitContactReportsThisTick,
  type CopEntry,
  type MapAttack,
  type PeerLocation,
} from "./contacts";
import { type BetaTrustEvaluator, type CohortEvent } from "./evaluator";
import { BetaTrustEvaluator as Evaluator } from "./evaluator";
import { DEFAULT_COP_SENSOR_RADIUS_M, type Item } from "./items";
import type { ContactReport, Observation, PoseReport } from "./messages";
import { KIND_CONTACT_REPORT, KIND_OBSERVATION, KIND_POSE } from "./messages";
import {
  SecureBus,
  decodeContactReport,
  decodeObservation,
  decodePoseReport,
  encodeContactReport,
  encodeObservation,
  encodePoseReport,
  envelopeToWire,
  envelopeFromWire,
  seal,
  tryOpen,
  type Envelope,
} from "./secureBus";
import type { CooperativeScenario, LoopClosureFactor, Pose2 } from "./poseGraph";
import { Swarm, type SwarmOptions, type VelocityCommand } from "./swarm";

export type LinkPredicate = (observerId: string, receiverId: string) => boolean;

/** Per-tick SLAM view attached to TickSnapshot when the timeline drives a
 * pose-graph lesson (L09–L12). Absent for swarm scenarios. Each tick is one
 * optimizer stage, not a continuous step — `cycle` is the stage index,
 * `stageLabel` is the human-readable name shown on the canvas. */
export type SlamView = {
  kind: "single" | "cooperative";
  cycle: number;
  totalStages: number;
  stageLabel: string;
  cost: number;
  iterations: number;
  /** Estimated landmark positions at this stage. */
  landmarks: ReadonlyArray<[string, [number, number]]>;
  /** L09 only: estimated trajectory. */
  trajectory?: ReadonlyArray<[string, Pose2]>;
  /** L09 only: loop-closure edges added at this stage (empty until post-closure). */
  closureEdges?: ReadonlyArray<LoopClosureFactor>;
  /** L10/L11/L12: scenario discriminator. */
  scenario?: CooperativeScenario;
  /** L10/L11/L12: per-agent SLAM state. */
  slamAgents?: ReadonlyArray<{ id: string; pose: Pose2; reputation: number }>;
  /** L10/L11/L12: inter-robot factor edges. `weight` is the DCS prior
   * (source's reputation × GNC) the optimizer used; 1.0 when DCS is off. */
  interRobotEdges?: ReadonlyArray<{ fromId: string; toId: string; weight: number }>;
};

export type PlannerContext = { tick: number; t: number; dt: number; requestHalt: () => void };
export type Planner = (
  agents: ReadonlyArray<Agent>,
  ctx: PlannerContext,
) => Record<string, VelocityCommand> | undefined;

export type ScenarioSpec = {
  agents: Agent[];
  ticks: number;
  attackers?: ReadonlyArray<Attacker>;
  poseAttackers?: ReadonlyArray<PoseAttacker>;
  /** First tick (1-indexed) on which attackers fire. */
  attackStartTick?: number;
  /** First tick (1-indexed) on which attackers stop firing — supports the heal pattern. */
  attackEndTick?: number;
  /** Emit a synthetic PoseReport for every honest agent each tick, so V3 presence and
   * the per-agent evaluator see steady pose evidence even when the swarm tick alone
   * does not synthesize them. Pose attackers compose over this stream. */
  emitTruthPoses?: boolean;
  gossipRoundEvery?: number;
  linkPredicate?: LinkPredicate;
  injectedObservations?: (tickIndex: number, ts: bigint) => ReadonlyArray<Observation>;
  injectedPoseReports?: (tickIndex: number, ts: bigint) => ReadonlyArray<PoseReport>;
  planner?: Planner;
  swarmOpts?: SwarmOptions;
  /** Optional UI hint: the peer whose reputation the lesson is teaching about
   * (e.g. the liar). Surfaces in `ScenarioResult.rumorSubject` and lets the
   * canvas filter gossip overlays to that subject. No effect on math. */
  rumorSubject?: string;
  /** Optional UI hint: cliques defined by `linkPredicate`. Each inner array is
   * a list of agent ids that can deliver observations to each other directly.
   * Cross-clique pairs are "boundary edges" — the canvas highlights them
   * during gossip rounds. No effect on math; runScenario does not consult
   * this field. */
  cliques?: ReadonlyArray<ReadonlyArray<string>>;
};

export type BetaPair = [alpha: number, beta: number];

/** Presentation-only record of a single gossip ingest event: gossiper G
 * broadcast its snapshot, receiver R ingested it with weight
 * `firstHandScore(G) × gossipDiscount`. `views` is exactly what G sealed
 * into this round's payload — the UI derives per-subject contribution as
 * `weight × (view.α − 1.0)` (same formula `reputation()` uses internally).
 * Populated only on gossip-round ticks. No math impact. */
export type GossipIngest = {
  gossiperId: string;
  receiverId: string;
  weight: number;
  views: Record<string, BetaPair>;
};

export type TickSnapshot = {
  tick: number;
  t: number;
  agents: ReadonlyArray<Agent>;
  observations: ReadonlyArray<Observation>;
  reputations: Record<string, number>;
  perAgentReputations: Record<string, Record<string, number>>;
  perAgentBeta: Record<string, Record<string, BetaPair>>;
  consensusReputations: Record<string, number>;
  newCohortEvents: ReadonlyArray<CohortEvent>;
  gossipRound: boolean;
  /** True iff `attackStartTick <= tick < attackEndTick` — the attack window
   * is open this tick. Lets the UI fire a one-shot "ignition" pulse on the
   * false→true transition without keeping its own state machine. */
  attackArmed: boolean;
  /** Per-edge ingest records for this tick's gossip round. Empty when
   * `gossipRound` is false. */
  gossipIngested: ReadonlyArray<GossipIngest>;
  /** V3 presence: subjectId → observerId → most-recent beacon timestamp.
   * The canvas renders this as a directed "seen-by" graph; subjects with
   * no real-agent inbound edges are visibly stranded. */
  presenceGraph: Record<string, Record<string, bigint>>;
  /** SLAM lessons (L09–L12) attach pose-graph stage data here. */
  slam?: SlamView;
};

export type ScenarioResult = {
  evaluator: BetaTrustEvaluator;
  agentEvaluators: ReadonlyMap<string, BetaTrustEvaluator>;
  snapshots: TickSnapshot[];
  rumorSubject?: string;
  cliques?: ReadonlyArray<ReadonlyArray<string>>;
};

const TICK_NS_PER_SECOND = 1_000_000_000n;
const ALWAYS_DELIVER: LinkPredicate = () => true;

export type RunOptions = {
  chunkSize?: number;
  onChunk?: (chunk: TickSnapshot[], soFar: number, total: number) => void;
};

export function runScenario(spec: ScenarioSpec, opts?: RunOptions): ScenarioResult {
  const swarm = new Swarm(spec.agents, spec.swarmOpts);
  const evaluator = new Evaluator();
  const agentEvaluators = new Map<string, BetaTrustEvaluator>();
  for (const a of spec.agents) {
    if (a.phantom) continue;
    agentEvaluators.set(a.id, new Evaluator({ selfId: a.id }));
  }
  const attackStartTick = spec.attackStartTick ?? 0;
  const attackEndTick = spec.attackEndTick ?? Number.POSITIVE_INFINITY;
  const attackers: ReadonlyArray<Attacker> = (spec.attackers ?? []).map((a) => ({
    ...a,
    startTick: a.startTick ?? attackStartTick,
    endTick: a.endTick ?? attackEndTick,
  }));
  const poseAttackers: ReadonlyArray<PoseAttacker> = (spec.poseAttackers ?? []).map((a) => ({
    ...a,
    startTick: a.startTick ?? attackStartTick,
    endTick: a.endTick ?? attackEndTick,
  }));
  const isAttackerActive = (a: { startTick?: number; endTick?: number }, t1: number): boolean =>
    (a.startTick == null || t1 >= a.startTick) && (a.endTick == null || t1 < a.endTick);
  const deliver = spec.linkPredicate ?? ALWAYS_DELIVER;
  const snapshots: TickSnapshot[] = [];
  let prevCohortCount = 0;
  let lastChunkSent = 0;
  let haltRequested = false;
  const requestHalt = () => {
    haltRequested = true;
  };

  const deliverObservation = (obs: Observation): void => {
    evaluator.recordObservation(
      obs.observer_id,
      obs.subject_id,
      obs.range_m,
      obs.timestamp_ns,
    );
    for (const [receiverId, ev] of agentEvaluators) {
      if (!deliver(obs.observer_id, receiverId)) continue;
      ev.recordObservation(obs.observer_id, obs.subject_id, obs.range_m, obs.timestamp_ns);
    }
  };

  const deliverPoseReport = (pose: PoseReport): void => {
    evaluator.recordPoseReport(pose.agent_id, pose.timestamp_ns);
    for (const [receiverId, ev] of agentEvaluators) {
      if (!deliver(pose.agent_id, receiverId)) continue;
      ev.recordPoseReport(pose.agent_id, pose.timestamp_ns);
    }
  };

  for (let i = 0; i < spec.ticks; i++) {
    if (spec.planner) {
      const cmds = spec.planner(swarm.agents, { tick: i, t: swarm.t, dt: swarm.dt, requestHalt });
      if (cmds) swarm.commandVelocities(cmds);
    }
    const tick = swarm.tick();
    const tickNs = BigInt(Math.round(tick.t * Number(TICK_NS_PER_SECOND)));
    const tickIndex1 = i + 1;
    const attackArmed = tickIndex1 >= attackStartTick && tickIndex1 < attackEndTick;
    const anyPoseAttackerActive = poseAttackers.some((a) => isAttackerActive(a, tickIndex1));
    const observations: Observation[] = [];
    for (const observerId of Object.keys(tick.beacons)) {
      for (const beacon of tick.beacons[observerId]!) {
        const raw: Observation = {
          observer_id: observerId,
          subject_id: beacon.subject_id,
          range_m: beacon.range_m,
          bearing_rad: beacon.bearing_rad,
          timestamp_ns: tickNs,
        };
        const attacked = applyAttacks(raw, attackers, tickIndex1);
        observations.push(attacked);
        deliverObservation(attacked);
      }
    }
    if (attackArmed && spec.injectedObservations) {
      for (const obs of spec.injectedObservations(i, tickNs)) {
        observations.push(obs);
        deliverObservation(obs);
      }
    }
    if (spec.emitTruthPoses) {
      const truthPoses: PoseReport[] = [];
      for (const a of tick.agents) {
        if (a.phantom) continue;
        truthPoses.push({
          agent_id: a.id,
          x: a.x,
          y: a.y,
          theta: a.theta,
          timestamp_ns: tickNs,
        });
      }
      const finalPoses = applyPoseAttacks(i, tickNs, truthPoses, poseAttackers, tickIndex1);
      for (const pose of finalPoses) deliverPoseReport(pose);
    } else if (anyPoseAttackerActive) {
      // Pose attackers fire even without a truth stream; truth defaults to current agent state.
      const truthPoses: PoseReport[] = [];
      for (const a of tick.agents) {
        if (a.phantom) continue;
        truthPoses.push({
          agent_id: a.id,
          x: a.x,
          y: a.y,
          theta: a.theta,
          timestamp_ns: tickNs,
        });
      }
      for (const pose of applyPoseAttacks(i, tickNs, truthPoses, poseAttackers, tickIndex1)) {
        // Only deliver lying ones from attackers active this tick.
        if (
          poseAttackers.some((a) => a.agentId === pose.agent_id && isAttackerActive(a, tickIndex1))
        ) {
          deliverPoseReport(pose);
        }
      }
    }
    if (attackArmed && spec.injectedPoseReports) {
      for (const pose of spec.injectedPoseReports(i, tickNs)) {
        deliverPoseReport(pose);
      }
    }
    const gossipEvery = spec.gossipRoundEvery ?? 0;
    const gossipRound = gossipEvery > 0 && (i + 1) % gossipEvery === 0;
    const gossipIngested: GossipIngest[] = [];
    if (gossipRound) {
      const gossips: Map<string, Record<string, [number, number]>> = new Map();
      for (const [id, ev] of agentEvaluators) gossips.set(id, ev.gossipSnapshot());
      for (const [gossiperId, views] of gossips) {
        for (const [receiverId, ev] of agentEvaluators) {
          if (receiverId === gossiperId) continue;
          const weight = ev.firstHandScore(gossiperId) * ev.gossipDiscount();
          ev.recordGossip(gossiperId, views, tickNs);
          gossipIngested.push({ gossiperId, receiverId, weight, views });
        }
      }
    }
    const reputations: Record<string, number> = {};
    for (const a of tick.agents) reputations[a.id] = evaluator.reputation(a.id);
    const perAgentReputations: Record<string, Record<string, number>> = {};
    const perAgentBeta: Record<string, Record<string, BetaPair>> = {};
    for (const [observerId, ev] of agentEvaluators) {
      const row: Record<string, number> = {};
      for (const a of tick.agents) row[a.id] = ev.reputation(a.id);
      perAgentReputations[observerId] = row;
      perAgentBeta[observerId] = ev.gossipSnapshot();
    }
    const consensusReputations: Record<string, number> = {};
    const observerIds = [...agentEvaluators.keys()];
    if (observerIds.length > 0) {
      for (const a of tick.agents) {
        const samples: number[] = [];
        for (const observerId of observerIds) {
          if (observerId === a.id) continue;
          const r = perAgentReputations[observerId]?.[a.id];
          if (r !== undefined) samples.push(r);
        }
        if (samples.length === 0) {
          consensusReputations[a.id] = reputations[a.id] ?? 0.5;
        } else {
          samples.sort((x, y) => x - y);
          consensusReputations[a.id] = samples[Math.floor(samples.length / 2)]!;
        }
      }
    }
    const cohortLog = evaluator.cohortEvents();
    const newCohortEvents = cohortLog.slice(prevCohortCount);
    prevCohortCount = cohortLog.length;
    const presenceGraph: Record<string, Record<string, bigint>> = {};
    for (const [subjectId, granters] of evaluator.seenByGraph()) {
      const inner: Record<string, bigint> = {};
      for (const [observerId, ts] of granters) inner[observerId] = ts;
      presenceGraph[subjectId] = inner;
    }
    snapshots.push({
      tick: i + 1,
      t: tick.t,
      agents: tick.agents,
      observations,
      reputations,
      perAgentReputations,
      consensusReputations,
      perAgentBeta,
      newCohortEvents,
      gossipRound,
      attackArmed,
      gossipIngested,
      presenceGraph,
    });
    if (opts?.onChunk && opts.chunkSize && opts.chunkSize > 0) {
      const sinceLast = snapshots.length - lastChunkSent;
      const isFinalTick = i === spec.ticks - 1 || haltRequested;
      if (sinceLast >= opts.chunkSize || isFinalTick) {
        opts.onChunk(snapshots.slice(lastChunkSent), snapshots.length, spec.ticks);
        lastChunkSent = snapshots.length;
      }
    }
    if (haltRequested) break;
  }
  evaluator.flush();
  for (const ev of agentEvaluators.values()) ev.flush();
  return {
    evaluator,
    agentEvaluators,
    snapshots,
    rumorSubject: spec.rumorSubject,
    cliques: spec.cliques,
  };
}

export function finalReputations(result: ScenarioResult): Record<string, number> {
  const last = result.snapshots[result.snapshots.length - 1];
  if (!last) return {};
  const out: Record<string, number> = {};
  for (const a of last.agents) out[a.id] = result.evaluator.reputation(a.id);
  return out;
}

/** Spec for the envelope-round-trip scenario runner. Differs from
 * `ScenarioSpec` in adding envelope-level fields: foreign emitters,
 * envelope-attack schedule, and an opt-in capture of the first sealed
 * envelope per agent for replay-storm attacks. */
export type SecureScenarioSpec = ScenarioSpec & {
  foreignEmitters?: ReadonlyArray<string>;
  /** Tick → list of envelope attacks to apply at the start of that tick. */
  envelopeAttacks?: ReadonlyMap<number, ReadonlyArray<EnvelopeAttack>>;
  /** Each foreign emitter emits this fake observation every tick once armed.
   * Signed with a valid (off-roster) key — openEnvelope rejects with
   * "unknown sender". */
  foreignObservation?: (
    emitterId: string,
    tickIndex: number,
    ts: bigint,
  ) => Observation | null;
  /** Map-layer config (ADR 0019). When `items` is non-empty, every honest
   * peer within `copSensorRadiusM` emits a `ContactReport` envelope each
   * tick. `mapAttacks` schedule per-reporter phantom-injection and
   * suppression attacks. */
  items?: ReadonlyArray<Item>;
  mapAttacks?: ReadonlyArray<MapAttack>;
  copSensorRadiusM?: number;
  copThreshold?: number;
};

export type SecureTickSnapshot = TickSnapshot & {
  accepts: number;
  rejects: number;
  rejectsByCategory: Record<string, number>;
  contactReports: ReadonlyArray<ContactReport>;
};

export type SecureScenarioResult = {
  evaluator: BetaTrustEvaluator;
  agentEvaluators: ReadonlyMap<string, BetaTrustEvaluator>;
  snapshots: SecureTickSnapshot[];
  bus: SecureBus;
  /** Final COP at end of run (uses the global evaluator's reputations). */
  cop: ReadonlyMap<string, CopEntry>;
  contactLog: ReadonlyArray<ContactReport>;
  rumorSubject?: string;
  cliques?: ReadonlyArray<ReadonlyArray<string>>;
};

/** Envelope-round-trip scenario runner. Mirrors the Python eval harness:
 *   seal(Observation/PoseReport) → wire → openEnvelope → evaluator.recordAccept
 *   or → evaluator.recordReject on VerificationError.
 *
 * Envelope-level attacks (swap_key, replay_storm) and forged emitters
 * exercise the verify path; observation- and pose-level attacks compose with
 * envelope verification (a successfully-verified lying observation still
 * reaches the evaluator and gets caught by Tier 1/Tier 2).
 */
export function runSecureScenario(
  spec: SecureScenarioSpec,
  opts?: RunOptions,
): SecureScenarioResult {
  const swarm = new Swarm(spec.agents, spec.swarmOpts);
  const bus = new SecureBus();
  for (const a of spec.agents) {
    if (a.phantom) continue;
    bus.registerAgent(a.id);
  }
  for (const fid of spec.foreignEmitters ?? []) {
    bus.registerForeignEmitter(fid);
  }
  const evaluator = new Evaluator();
  const agentEvaluators = new Map<string, BetaTrustEvaluator>();
  for (const a of spec.agents) {
    if (a.phantom) continue;
    agentEvaluators.set(a.id, new Evaluator({ selfId: a.id }));
  }
  const attackStartTick = spec.attackStartTick ?? 0;
  const attackEndTick = spec.attackEndTick ?? Number.POSITIVE_INFINITY;
  const attackers: ReadonlyArray<Attacker> = (spec.attackers ?? []).map((a) => ({
    ...a,
    startTick: a.startTick ?? attackStartTick,
    endTick: a.endTick ?? attackEndTick,
  }));
  const poseAttackers: ReadonlyArray<PoseAttacker> = (spec.poseAttackers ?? []).map((a) => ({
    ...a,
    startTick: a.startTick ?? attackStartTick,
    endTick: a.endTick ?? attackEndTick,
  }));
  const isAttackerActive = (a: { startTick?: number; endTick?: number }, t1: number): boolean =>
    (a.startTick == null || t1 >= a.startTick) && (a.endTick == null || t1 < a.endTick);
  const deliver = spec.linkPredicate ?? ALWAYS_DELIVER;
  const envelopeAttacks = spec.envelopeAttacks ?? new Map();

  const snapshots: SecureTickSnapshot[] = [];
  let prevCohortCount = 0;
  let lastChunkSent = 0;
  let haltRequested = false;
  const requestHalt = () => {
    haltRequested = true;
  };

  const replayers = new Set<string>();
  const capturedWire = new Map<string, Uint8Array>();
  const contactLog: ContactReport[] = [];
  const items = spec.items ?? [];
  const mapAttacks = spec.mapAttacks ?? [];
  const copSensorRadiusM = spec.copSensorRadiusM ?? DEFAULT_COP_SENSOR_RADIUS_M;
  const copThreshold = spec.copThreshold ?? COP_TRUST_THRESHOLD;

  const recordAcceptAll = (env: Envelope): void => {
    evaluator.recordAccept(env.senderId, env.timestampNs);
    for (const [, ev] of agentEvaluators) {
      ev.recordAccept(env.senderId, env.timestampNs);
    }
  };

  const recordRejectAll = (
    env: Envelope,
    category: "bad_signature" | "replay" | "unknown_sender" | "version_mismatch" | "unknown",
    message: string,
  ): void => {
    evaluator.recordReject(env.senderId, env.timestampNs, env.nonce, category, message);
    for (const [, ev] of agentEvaluators) {
      ev.recordReject(env.senderId, env.timestampNs, env.nonce, category, message);
    }
  };

  const dispatchObservation = (obs: Observation): void => {
    evaluator.recordObservation(obs.observer_id, obs.subject_id, obs.range_m, obs.timestamp_ns);
    for (const [receiverId, ev] of agentEvaluators) {
      if (!deliver(obs.observer_id, receiverId)) continue;
      ev.recordObservation(obs.observer_id, obs.subject_id, obs.range_m, obs.timestamp_ns);
    }
  };

  const dispatchPose = (p: PoseReport): void => {
    evaluator.recordPoseReport(p.agent_id, p.timestamp_ns);
    for (const [receiverId, ev] of agentEvaluators) {
      if (!deliver(p.agent_id, receiverId)) continue;
      ev.recordPoseReport(p.agent_id, p.timestamp_ns);
    }
  };

  for (let i = 0; i < spec.ticks; i++) {
    const tickIndex1 = i + 1;
    // Apply envelope attacks scheduled for this tick (before any sealing).
    for (const ev of envelopeAttacks.get(tickIndex1) ?? []) {
      if (ev.kind === "swap_key") bus.rotateKeypairSecretly(ev.agentId);
      else if (ev.kind === "replay_storm") replayers.add(ev.agentId);
    }

    if (spec.planner) {
      const cmds = spec.planner(swarm.agents, { tick: i, t: swarm.t, dt: swarm.dt, requestHalt });
      if (cmds) swarm.commandVelocities(cmds);
    }
    const tick = swarm.tick();
    const tickNs = BigInt(Math.round(tick.t * Number(TICK_NS_PER_SECOND)));
    const attackArmed = tickIndex1 >= attackStartTick && tickIndex1 < attackEndTick;

    let accepts = 0;
    let rejects = 0;
    const rejectsByCategory: Record<string, number> = {};
    const observations: Observation[] = [];

    const tryOpenAndAccount = (env: Envelope): Uint8Array | null => {
      const result = tryOpen(env, bus.roster, bus.replay);
      if (result.ok) {
        accepts++;
        recordAcceptAll(env);
        return result.payload;
      }
      rejects++;
      rejectsByCategory[result.category] = (rejectsByCategory[result.category] ?? 0) + 1;
      recordRejectAll(env, result.category, result.message);
      return null;
    };

    // Pose-report path — emit honest+attacker poses for every real agent.
    const truthPoses: PoseReport[] = [];
    for (const a of tick.agents) {
      if (a.phantom) continue;
      truthPoses.push({
        agent_id: a.id,
        x: a.x,
        y: a.y,
        theta: a.theta,
        timestamp_ns: tickNs,
      });
    }
    const poses = applyPoseAttacks(i, tickNs, truthPoses, poseAttackers, tickIndex1);
    for (const p of poses) {
      const ident = bus.identities.get(p.agent_id);
      if (!ident) continue;
      const env = seal(ident, KIND_POSE, encodePoseReport(p), tickNs);
      capturedWire.set(p.agent_id, envelopeToWire(env));
      const payload = tryOpenAndAccount(env);
      if (payload) dispatchPose(decodePoseReport(payload));
    }

    // Observation path — every beacon return is sealed by its observer.
    for (const observerId of Object.keys(tick.beacons)) {
      const ident = bus.identities.get(observerId);
      if (!ident) continue;
      for (const beacon of tick.beacons[observerId]!) {
        const raw: Observation = {
          observer_id: observerId,
          subject_id: beacon.subject_id,
          range_m: beacon.range_m,
          bearing_rad: beacon.bearing_rad,
          timestamp_ns: tickNs,
        };
        const attacked = applyAttacks(raw, attackers, tickIndex1);
        observations.push(attacked);
        const env = seal(ident, KIND_OBSERVATION, encodeObservation(attacked), tickNs);
        const payload = tryOpenAndAccount(env);
        if (payload) dispatchObservation(decodeObservation(payload));
      }
    }

    if (attackArmed && spec.injectedObservations) {
      for (const obs of spec.injectedObservations(i, tickNs)) {
        const ident = bus.identities.get(obs.observer_id);
        if (!ident) continue;
        observations.push(obs);
        const env = seal(ident, KIND_OBSERVATION, encodeObservation(obs), tickNs);
        const payload = tryOpenAndAccount(env);
        if (payload) dispatchObservation(decodeObservation(payload));
      }
    }
    if (attackArmed && spec.injectedPoseReports) {
      for (const p of spec.injectedPoseReports(i, tickNs)) {
        const ident = bus.identities.get(p.agent_id);
        if (!ident) continue;
        const env = seal(ident, KIND_POSE, encodePoseReport(p), tickNs);
        const payload = tryOpenAndAccount(env);
        if (payload) dispatchPose(decodePoseReport(payload));
      }
    }

    // Replay-storm: re-publish captured wire envelopes; each re-publish fails
    // the replay window on the receiver side.
    for (const attackerId of replayers) {
      const wire = capturedWire.get(attackerId);
      if (!wire) continue;
      for (let r = 0; r < REPLAY_REPETITIONS; r++) {
        const env = envelopeFromWire(wire);
        tryOpenAndAccount(env);
      }
    }

    // Forged-emitter path: off-roster identities seal valid-signature
    // envelopes that the receiver rejects with "unknown sender".
    if (attackArmed && spec.foreignObservation) {
      for (const fid of spec.foreignEmitters ?? []) {
        const fakeObs = spec.foreignObservation(fid, i, tickNs);
        if (!fakeObs) continue;
        const ident = bus.identities.get(fid);
        if (!ident) continue;
        const env = seal(ident, KIND_OBSERVATION, encodeObservation(fakeObs), tickNs);
        tryOpenAndAccount(env);
      }
    }

    // Map-layer ContactReport path (ADR 0019): honest peers within sensor
    // radius emit one ContactReport per visible Item; MapAttacks inject
    // phantoms and suppress real items per reporter. All reports are sealed,
    // verified (or not), and accumulated into the contact log for COP.
    const tickContactReports: ContactReport[] = [];
    if (items.length > 0 || mapAttacks.length > 0) {
      const peers: PeerLocation[] = [];
      for (const a of tick.agents) {
        if (a.phantom) continue;
        peers.push({ id: a.id, x: a.x, y: a.y });
      }
      const activeMapAttacks = attackArmed ? mapAttacks : [];
      const reports = emitContactReportsThisTick(
        peers,
        items,
        activeMapAttacks,
        copSensorRadiusM,
        tickNs,
      );
      for (const cr of reports) {
        const ident = bus.identities.get(cr.reporter_id);
        if (!ident) continue;
        const env = seal(ident, KIND_CONTACT_REPORT, encodeContactReport(cr), tickNs);
        const payload = tryOpenAndAccount(env);
        if (payload) {
          const decoded = decodeContactReport(payload);
          tickContactReports.push(decoded);
          contactLog.push(decoded);
        }
      }
    }

    const gossipEvery = spec.gossipRoundEvery ?? 0;
    const gossipRound = gossipEvery > 0 && (i + 1) % gossipEvery === 0;
    const gossipIngested: GossipIngest[] = [];
    if (gossipRound) {
      const gossips: Map<string, Record<string, [number, number]>> = new Map();
      for (const [id, ev] of agentEvaluators) gossips.set(id, ev.gossipSnapshot());
      for (const [gossiperId, views] of gossips) {
        for (const [receiverId, ev] of agentEvaluators) {
          if (receiverId === gossiperId) continue;
          const weight = ev.firstHandScore(gossiperId) * ev.gossipDiscount();
          ev.recordGossip(gossiperId, views, tickNs);
          gossipIngested.push({ gossiperId, receiverId, weight, views });
        }
      }
    }

    const reputations: Record<string, number> = {};
    for (const a of tick.agents) reputations[a.id] = evaluator.reputation(a.id);
    const perAgentReputations: Record<string, Record<string, number>> = {};
    const perAgentBeta: Record<string, Record<string, BetaPair>> = {};
    for (const [observerId, ev] of agentEvaluators) {
      const row: Record<string, number> = {};
      for (const a of tick.agents) row[a.id] = ev.reputation(a.id);
      perAgentReputations[observerId] = row;
      perAgentBeta[observerId] = ev.gossipSnapshot();
    }
    const consensusReputations: Record<string, number> = {};
    const observerIds = [...agentEvaluators.keys()];
    if (observerIds.length > 0) {
      for (const a of tick.agents) {
        const samples: number[] = [];
        for (const observerId of observerIds) {
          if (observerId === a.id) continue;
          const r = perAgentReputations[observerId]?.[a.id];
          if (r !== undefined) samples.push(r);
        }
        if (samples.length === 0) {
          consensusReputations[a.id] = reputations[a.id] ?? 0.5;
        } else {
          samples.sort((x, y) => x - y);
          consensusReputations[a.id] = samples[Math.floor(samples.length / 2)]!;
        }
      }
    }
    const cohortLog = evaluator.cohortEvents();
    const newCohortEvents = cohortLog.slice(prevCohortCount);
    prevCohortCount = cohortLog.length;
    const presenceGraph: Record<string, Record<string, bigint>> = {};
    for (const [subjectId, granters] of evaluator.seenByGraph()) {
      const inner: Record<string, bigint> = {};
      for (const [observerId, ts] of granters) inner[observerId] = ts;
      presenceGraph[subjectId] = inner;
    }
    snapshots.push({
      tick: tickIndex1,
      t: tick.t,
      agents: tick.agents,
      observations,
      reputations,
      perAgentReputations,
      consensusReputations,
      perAgentBeta,
      newCohortEvents,
      gossipRound,
      attackArmed,
      gossipIngested,
      presenceGraph,
      accepts,
      rejects,
      rejectsByCategory,
      contactReports: tickContactReports,
    });
    if (opts?.onChunk && opts.chunkSize && opts.chunkSize > 0) {
      const sinceLast = snapshots.length - lastChunkSent;
      const isFinalTick = i === spec.ticks - 1 || haltRequested;
      if (sinceLast >= opts.chunkSize || isFinalTick) {
        opts.onChunk(snapshots.slice(lastChunkSent), snapshots.length, spec.ticks);
        lastChunkSent = snapshots.length;
      }
    }
    if (haltRequested) break;
  }
  evaluator.flush();
  for (const ev of agentEvaluators.values()) ev.flush();
  const finalReps: Record<string, number> = {};
  for (const a of spec.agents) {
    if (a.phantom) continue;
    finalReps[a.id] = evaluator.reputation(a.id);
  }
  const cop = buildCop(contactLog, finalReps, copThreshold);
  return {
    evaluator,
    agentEvaluators,
    snapshots,
    bus,
    cop,
    contactLog,
    rumorSubject: spec.rumorSubject,
    cliques: spec.cliques,
  };
}

export function detectionTick(
  result: ScenarioResult,
  attackerId: string,
  threshold = 0.4,
): number | null {
  for (const snap of result.snapshots) {
    if ((snap.reputations[attackerId] ?? 1.0) < threshold) return snap.tick;
  }
  return null;
}
