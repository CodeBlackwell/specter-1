import { ATTACK_CATALOG, composeBundles } from "../src/data/scenarios";

const composed = composeBundles([ATTACK_CATALOG.find((a) => a.id === "honest")!.build()]);
const { spec } = composed;

const { Swarm } = await import("../../sim-core/src/swarm");
const { BetaTrustEvaluator } = await import("../../sim-core/src/evaluator");
const { applyAttacks } = await import("../../sim-core/src/attacks");

const TICK_NS_PER_SECOND = 1_000_000_000n;
const swarm = new Swarm(spec.agents, spec.swarmOpts);
const evaluator = new BetaTrustEvaluator();
const agentEvaluators = new Map<string, BetaTrustEvaluator>();
for (const a of spec.agents) {
  if (a.phantom) continue;
  agentEvaluators.set(a.id, new BetaTrustEvaluator({ selfId: a.id }));
}

const attackers = spec.attackers ?? [];
const attackStartTick = spec.attackStartTick ?? 0;

let tPlanner = 0;
let tSwarm = 0;
let tDeliverObs = 0;
let tReputationRead = 0;
let tGossipSnap = 0;
let nObs = 0;

const T0 = performance.now();
for (let i = 0; i < spec.ticks; i++) {
  const t0 = performance.now();
  if (spec.planner) {
    const cmds = spec.planner(swarm.agents, { tick: i, t: swarm.t, dt: swarm.dt });
    if (cmds) swarm.commandVelocities(cmds);
  }
  const t1 = performance.now();
  const tick = swarm.tick();
  const tickNs = BigInt(Math.round(tick.t * Number(TICK_NS_PER_SECOND)));
  const t2 = performance.now();

  const attackArmed = i + 1 >= attackStartTick;
  const activeAttackers = attackArmed ? attackers : [];
  for (const observerId of Object.keys(tick.beacons)) {
    for (const beacon of tick.beacons[observerId]!) {
      const raw = {
        observer_id: observerId,
        subject_id: beacon.subject_id,
        range_m: beacon.range_m,
        bearing_rad: beacon.bearing_rad,
        timestamp_ns: tickNs,
      };
      const attacked = applyAttacks(raw, activeAttackers);
      nObs++;
      evaluator.recordObservation(attacked.observer_id, attacked.subject_id, attacked.range_m, attacked.timestamp_ns);
      for (const [, ev] of agentEvaluators) {
        ev.recordObservation(attacked.observer_id, attacked.subject_id, attacked.range_m, attacked.timestamp_ns);
      }
    }
  }
  const t3 = performance.now();

  for (const a of tick.agents) evaluator.reputation(a.id);
  for (const [, ev] of agentEvaluators) {
    for (const a of tick.agents) ev.reputation(a.id);
  }
  const t4 = performance.now();
  for (const [, ev] of agentEvaluators) ev.gossipSnapshot();
  const t5 = performance.now();

  tPlanner += t1 - t0;
  tSwarm += t2 - t1;
  tDeliverObs += t3 - t2;
  tReputationRead += t4 - t3;
  tGossipSnap += t5 - t4;
}
const total = performance.now() - T0;

console.log(`total: ${total.toFixed(0)}ms · ${nObs} obs across ${spec.ticks} ticks`);
console.log(`  planner            ${tPlanner.toFixed(0).padStart(6)}ms`);
console.log(`  swarm.tick         ${tSwarm.toFixed(0).padStart(6)}ms`);
console.log(`  recordObservation× ${tDeliverObs.toFixed(0).padStart(6)}ms`);
console.log(`  reputation reads   ${tReputationRead.toFixed(0).padStart(6)}ms`);
console.log(`  gossipSnapshot×    ${tGossipSnap.toFixed(0).padStart(6)}ms`);
