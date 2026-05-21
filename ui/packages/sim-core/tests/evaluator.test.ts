import { describe, it, expect } from "vitest";
import { BetaTrustEvaluator } from "../src/evaluator";

function emitReciprocalPair(
  ev: BetaTrustEvaluator,
  a: string,
  b: string,
  rangeAB: number,
  rangeBA: number,
  ts: bigint,
): void {
  ev.recordObservation(a, b, rangeAB, ts);
  ev.recordObservation(b, a, rangeBA, ts);
}

function emitHonestSquare(ev: BetaTrustEvaluator, ts: bigint): void {
  const peers = ["a0", "a1", "a2", "a3"];
  const pos: Record<string, [number, number]> = {
    a0: [0, 0],
    a1: [1, 0],
    a2: [1, 1],
    a3: [0, 1],
  };
  for (let i = 0; i < peers.length; i++) {
    for (let j = i + 1; j < peers.length; j++) {
      const pi = pos[peers[i]!]!;
      const pj = pos[peers[j]!]!;
      const d = Math.hypot(pi[0] - pj[0], pi[1] - pj[1]);
      emitReciprocalPair(ev, peers[i]!, peers[j]!, d, d, ts);
    }
  }
}

const SECOND = 1_000_000_000n;

describe("BetaTrustEvaluator", () => {
  it("honest 4-peer cohort closes as Tier 1, no β charged", () => {
    const ev = new BetaTrustEvaluator();
    emitHonestSquare(ev, 100n);
    ev.recordObservation("zzz", "zzz", 0, 200n * SECOND);
    ev.flush();
    const cohorts = ev.cohortEvents().filter((c) => c.fired);
    expect(cohorts.length).toBeGreaterThan(0);
    for (const c of cohorts) {
      if (c.subject_id === "zzz") continue;
      expect(c.tier_used).toBe("t1");
      expect(c.embeddability_score === null || c.embeddability_score < 0.05).toBe(true);
    }
    for (const peer of ["a0", "a1", "a2", "a3"]) {
      expect(ev.reputation(peer)).toBeGreaterThan(0.5);
    }
  });

  it("colluder pair (mutual edge inflated) fires Tier 2 and blames both", () => {
    const ev = new BetaTrustEvaluator();
    const N = 8;
    const peers = Array.from({ length: N }, (_, i) => `a${i}`);
    const pos: Record<string, [number, number]> = {};
    for (let i = 0; i < N; i++) {
      pos[peers[i]!] = [Math.cos((2 * Math.PI * i) / N) * 2, Math.sin((2 * Math.PI * i) / N) * 2];
    }
    const LIE = 6.0;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const pi = pos[peers[i]!]!;
        const pj = pos[peers[j]!]!;
        let d = Math.hypot(pi[0] - pj[0], pi[1] - pj[1]);
        if ((peers[i] === "a0" && peers[j] === "a1")) d += LIE;
        emitReciprocalPair(ev, peers[i]!, peers[j]!, d, d, 100n);
      }
    }
    ev.recordObservation("zzz", "zzz", 0, 200n * SECOND);
    ev.flush();
    const tier2 = ev.cohortEvents().filter((c) => c.tier_used === "t2");
    expect(tier2.length).toBeGreaterThan(0);
    const repA0 = ev.reputation("a0");
    const repA1 = ev.reputation("a1");
    const repA2 = ev.reputation("a2");
    expect(repA0).toBeLessThan(repA2);
    expect(repA1).toBeLessThan(repA2);
  });

  it("k=2 reciprocal disagreement charges β symmetrically (Tier 1 fallback)", () => {
    const ev = new BetaTrustEvaluator();
    emitReciprocalPair(ev, "a0", "a1", 1.0, 5.0, 100n);
    ev.recordObservation("zzz", "zzz", 0, 200n * SECOND);
    ev.flush();
    expect(ev.reputation("a0")).toBeLessThan(0.5);
    expect(ev.reputation("a1")).toBeLessThan(0.5);
  });

  it("k=2 reciprocal agreement charges α symmetrically", () => {
    const ev = new BetaTrustEvaluator();
    emitReciprocalPair(ev, "a0", "a1", 1.0, 1.0, 100n);
    ev.recordObservation("zzz", "zzz", 0, 200n * SECOND);
    ev.flush();
    expect(ev.reputation("a0")).toBeGreaterThan(0.5);
    expect(ev.reputation("a1")).toBeGreaterThan(0.5);
  });

  it("reputation of self is hard-coded to 1.0", () => {
    const ev = new BetaTrustEvaluator({ selfId: "me" });
    expect(ev.reputation("me")).toBe(1.0);
  });

  it("CohortEvent carries per-observer claims and tier-1 outlier ids", () => {
    const ev = new BetaTrustEvaluator();
    // 3 honest observers + 1 liar reporting on subject "s". Honest say ~1.0;
    // liar says 5.0. With 4 claimants the cohort fires Tier-1 voting; the
    // liar's gap exceeds threshold so it lands in disagreements.
    ev.recordObservation("o0", "s", 1.0, 100n);
    ev.recordObservation("o1", "s", 1.0, 100n);
    ev.recordObservation("o2", "s", 1.0, 100n);
    ev.recordObservation("liar", "s", 5.0, 100n);
    // Reciprocals so cohort vote has something to compare against.
    ev.recordObservation("s", "o0", 1.0, 100n);
    ev.recordObservation("s", "o1", 1.0, 100n);
    ev.recordObservation("s", "o2", 1.0, 100n);
    ev.recordObservation("s", "liar", 1.0, 100n);
    ev.recordObservation("zzz", "zzz", 0, 200n * SECOND);
    ev.flush();
    const fired = ev.cohortEvents().filter((c) => c.fired && c.subject_id === "s");
    expect(fired.length).toBeGreaterThan(0);
    const cohort = fired[0]!;
    expect(cohort.claims.length).toBe(4);
    const observerIds = cohort.claims.map((c) => c.observer_id).sort();
    expect(observerIds).toEqual(["liar", "o0", "o1", "o2"]);
    expect(cohort.outlier_observer_ids).toContain("liar");
  });
});

describe("gossip integration", () => {
  it("gossip from a high-rep informant pulls a silent peer's view down", () => {
    const receiver = new BetaTrustEvaluator({ selfId: "receiver" });
    receiver.observe("informant", { alpha: 50.0 });
    const informant = new BetaTrustEvaluator({ selfId: "informant" });
    informant.observe("mallory", { beta: 20.0 });
    const snapshot = informant.gossipSnapshot();
    expect(snapshot.mallory).toBeDefined();
    receiver.recordGossip("informant", snapshot, 0n);
    expect(receiver.reputation("mallory")).toBeLessThan(0.45);
  });

  it("self-gossip is rejected", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordGossip("self", { peer: [99, 1] }, 0n);
    expect(ev.reputation("peer")).toBeCloseTo(0.5, 5);
  });

  it("foreign view of self is filtered out", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.observe("other", { alpha: 50.0 });
    ev.recordGossip("other", { self: [1, 99] }, 0n);
    expect(ev.reputation("self")).toBe(1.0);
  });

  it("gossip weight is discounted by gossiper score × GOSSIP_DISCOUNT", () => {
    const trusted = new BetaTrustEvaluator({ selfId: "self" });
    trusted.observe("g1", { alpha: 50.0 });
    trusted.recordGossip("g1", { target: [1, 9] }, 0n);
    const untrusted = new BetaTrustEvaluator({ selfId: "self" });
    untrusted.observe("g2", { beta: 50.0 });
    untrusted.recordGossip("g2", { target: [1, 9] }, 0n);
    expect(trusted.reputation("target")).toBeLessThan(untrusted.reputation("target"));
  });
});

describe("V3 presence", () => {
  it("self always has presence", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    expect(ev.hasPresence("self", 0n)).toBe(true);
  });

  it("self-anchored sticky existence — self beaconed peer at any time", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordObservation("self", "peer", 1.0, 0n);
    expect(ev.hasPresence("peer", 100n * SECOND)).toBe(true);
  });

  it("transitive presence — peer seen by self-vouched granter within window", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordObservation("self", "granter", 1.0, 0n);
    ev.recordObservation("granter", "peer", 1.0, 1_000_000_000n);
    expect(ev.hasPresence("peer", 2_500_000_000n)).toBe(true);
  });

  it("transitive presence expires outside PRESENCE_WINDOW_NS (2s)", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordObservation("self", "granter", 1.0, 0n);
    ev.recordObservation("granter", "peer", 1.0, 0n);
    expect(ev.hasPresence("peer", 3_000_000_000n)).toBe(false);
  });

  it("sybil cabal cannot manufacture presence by mutual vouching", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordObservation("self", "honest", 1.0, 0n);
    for (let t = 0n; t < 100n; t++) {
      const ts = t * 100_000_000n;
      ev.recordObservation("sybil_a", "sybil_b", 1.0, ts);
      ev.recordObservation("sybil_b", "sybil_c", 1.0, ts);
      ev.recordObservation("sybil_c", "sybil_a", 1.0, ts);
    }
    for (const s of ["sybil_a", "sybil_b", "sybil_c"]) {
      expect(ev.hasPresence(s, 11_000_000_000n)).toBe(false);
    }
  });

  it("observation of a no-presence subject charges observer β=0.2", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordObservation("self", "honest", 1.0, 0n);
    const before = ev.reputation("phantom_observer");
    ev.recordObservation("phantom_observer", "phantom_subject", 1.0, 0n);
    expect(ev.reputation("phantom_observer")).toBeLessThan(before);
  });

  it("pose report from no-presence agent charges PRESENCE_BETA once", () => {
    const ev = new BetaTrustEvaluator({ selfId: "self" });
    ev.recordObservation("self", "honest", 1.0, 0n);
    ev.recordPoseReport("ghost", 0n);
    const after1 = ev.reputation("ghost");
    ev.recordPoseReport("ghost", 100_000_000n);
    const after2 = ev.reputation("ghost");
    expect(after2).toBeCloseTo(after1, 2);
  });
});
