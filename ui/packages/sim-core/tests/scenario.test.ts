import { describe, it, expect } from "vitest";
import { createAgent } from "../src/agent";
import { colluderPair, rangeLie, sensorFuzz } from "../src/attacks";
import { detectionTick, finalReputations, runScenario } from "../src/scenario";
import { createRng } from "../src/rng";

function circle(n: number, radius: number): ReturnType<typeof createAgent>[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return createAgent({
      id: `a${i}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      theta: angle + Math.PI / 2,
    });
  });
}

describe("scenarios", () => {
  it("honest swarm of 6 retains reputation > 0.5 after 40 ticks", () => {
    const result = runScenario({ agents: circle(6, 2), ticks: 40, swarmOpts: { dt: 0.1 } });
    const finals = finalReputations(result);
    for (const id of Object.keys(finals)) {
      expect(finals[id]!).toBeGreaterThan(0.5);
    }
  });

  it("range_lie attacker drops below honest peers in <30 ticks (Tier 1 fallback)", () => {
    const result = runScenario({
      agents: circle(4, 2),
      ticks: 30,
      swarmOpts: { dt: 0.1 },
      attackers: [rangeLie("a0", 4.0)],
    });
    const finals = finalReputations(result);
    expect(finals["a0"]!).toBeLessThan(finals["a2"]!);
    expect(finals["a0"]!).toBeLessThan(finals["a3"]!);
  });

  it("colluder_pair at n=8 drops both colluders below honest peers", () => {
    const result = runScenario({
      agents: circle(8, 2),
      ticks: 25,
      swarmOpts: { dt: 0.1 },
      attackers: colluderPair("a0", "a1", 6.0),
    });
    const finals = finalReputations(result);
    const honest = ["a2", "a3", "a4", "a5", "a6", "a7"].map((id) => finals[id]!);
    const honestMin = Math.min(...honest);
    expect(finals["a0"]!).toBeLessThan(honestMin);
    expect(finals["a1"]!).toBeLessThan(honestMin);
  });

  it("sensor_fuzz attacker is detected (rep dips below 0.4)", () => {
    const result = runScenario({
      agents: circle(6, 2),
      ticks: 40,
      swarmOpts: { dt: 0.1 },
      attackers: [sensorFuzz("a0", createRng(13))],
    });
    const tick = detectionTick(result, "a0", 0.4);
    expect(tick).not.toBeNull();
    expect(tick!).toBeLessThanOrEqual(40);
  });

  it("snapshots include per-tick reputation series and new cohort events", () => {
    const result = runScenario({
      agents: circle(4, 2),
      ticks: 5,
      swarmOpts: { dt: 0.1 },
    });
    expect(result.snapshots.length).toBe(5);
    for (const s of result.snapshots) {
      expect(Object.keys(s.reputations).length).toBe(4);
      expect(s.observations.length).toBeGreaterThan(0);
    }
  });

  it("phantom Sybils collapse in per-agent views via V3 presence rule", () => {
    const real = circle(4, 2);
    const sybilA = createAgent({ id: "S0", x: 12, y: 0, phantom: true });
    const sybilB = createAgent({ id: "S1", x: -12, y: 0, phantom: true });
    const result = runScenario({
      agents: [...real, sybilA, sybilB],
      ticks: 50,
      swarmOpts: { dt: 0.1 },
      injectedObservations: (_t, ts) => [
        { observer_id: "S0", subject_id: "S1", range_m: 24, bearing_rad: Math.PI, timestamp_ns: ts },
        { observer_id: "S1", subject_id: "S0", range_m: 24, bearing_rad: 0, timestamp_ns: ts },
        { observer_id: "S0", subject_id: "a0", range_m: 12, bearing_rad: Math.PI, timestamp_ns: ts },
      ],
    });
    const last = result.snapshots[result.snapshots.length - 1]!;
    const consensusS0 = last.consensusReputations["S0"]!;
    const consensusS1 = last.consensusReputations["S1"]!;
    const consensusReal = last.consensusReputations["a1"]!;
    expect(consensusS0).toBeLessThan(consensusReal);
    expect(consensusS1).toBeLessThan(consensusReal);
    expect(consensusS0).toBeLessThan(0.4);
  });

  it("link partition: out-of-clique observers don't see attacker's bad observations directly", () => {
    const agents = circle(6, 2);
    const groupA = new Set(["a0", "a1", "a2"]);
    const result = runScenario({
      agents,
      ticks: 25,
      swarmOpts: { dt: 0.1 },
      attackers: [rangeLie("a0", 4.0)],
      linkPredicate: (observer, receiver) => groupA.has(observer) === groupA.has(receiver),
    });
    const last = result.snapshots[result.snapshots.length - 1]!;
    const insideClique = last.perAgentReputations["a1"]!["a0"]!;
    const outsideClique = last.perAgentReputations["a3"]!["a0"]!;
    expect(insideClique).toBeLessThan(outsideClique);
    expect(outsideClique).toBeGreaterThanOrEqual(0.4);
  });

  it("gossip propagates a liar's reputation across a partition over time", () => {
    const agents = circle(6, 2);
    const groupA = new Set(["a0", "a1", "a2"]);
    const result = runScenario({
      agents,
      ticks: 80,
      swarmOpts: { dt: 0.1 },
      attackers: [rangeLie("a0", 4.0)],
      gossipRoundEvery: 10,
      linkPredicate: (observer, receiver) => groupA.has(observer) === groupA.has(receiver),
    });
    const earlyOutside = result.snapshots[19]!.perAgentReputations["a3"]!["a0"]!;
    const lateOutside = result.snapshots[result.snapshots.length - 1]!.perAgentReputations["a3"]!["a0"]!;
    expect(lateOutside).toBeLessThan(earlyOutside);
  });
});
