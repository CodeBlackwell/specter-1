import { describe, expect, test } from "vitest";

import { createAgent } from "../src/agent";
import { runSecureScenario, swapKey, replayStorm, REPLAY_REPETITIONS, type EnvelopeAttack } from "../src";

const fourPeers = () => [
  createAgent({ id: "alpha", x: 0, y: 0 }),
  createAgent({ id: "bravo", x: 1, y: 0 }),
  createAgent({ id: "charlie", x: 0, y: 1 }),
  createAgent({ id: "delta", x: 1, y: 1 }),
];

const armAt = (tick: number, attacks: ReadonlyArray<EnvelopeAttack>): ReadonlyMap<number, ReadonlyArray<EnvelopeAttack>> =>
  new Map([[tick, attacks]]);

describe("runSecureScenario — honest baseline", () => {
  test("a clean run produces accepts > 0 and no rejects", () => {
    const result = runSecureScenario({ agents: fourPeers(), ticks: 5 });
    const totalAccepts = result.snapshots.reduce((acc, s) => acc + s.accepts, 0);
    const totalRejects = result.snapshots.reduce((acc, s) => acc + s.rejects, 0);
    expect(totalAccepts).toBeGreaterThan(0);
    expect(totalRejects).toBe(0);
  });
});

describe("runSecureScenario — swapKey attack", () => {
  test("after key rotation, the attacker's envelopes are rejected with bad_signature", () => {
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 8,
      envelopeAttacks: armAt(3, [swapKey("alpha")]),
    });

    // Pre-rotation ticks should accept alpha's envelopes cleanly.
    const preTickRejects = result.snapshots.slice(0, 2).reduce((a, s) => a + s.rejects, 0);
    expect(preTickRejects).toBe(0);

    // Post-rotation ticks must accumulate bad_signature rejects.
    const postRejectsByCat: Record<string, number> = {};
    for (const s of result.snapshots.slice(3)) {
      for (const [cat, n] of Object.entries(s.rejectsByCategory)) {
        postRejectsByCat[cat] = (postRejectsByCat[cat] ?? 0) + n;
      }
    }
    expect(postRejectsByCat["bad_signature"] ?? 0).toBeGreaterThan(0);

    // Alpha's reputation must fall after the attack — many rejects each charge β.
    const finalRep = result.evaluator.reputation("alpha");
    expect(finalRep).toBeLessThan(0.5);
  });
});

describe("runSecureScenario — replayStorm attack", () => {
  test("re-publishing captured envelopes drives replay rejects per tick", () => {
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 6,
      envelopeAttacks: armAt(2, [replayStorm("alpha")]),
    });
    const replayRejects: number[] = [];
    for (const s of result.snapshots.slice(2)) {
      replayRejects.push(s.rejectsByCategory["replay"] ?? 0);
    }
    // From tick 2 onward we expect REPLAY_REPETITIONS replay rejects per tick.
    for (const n of replayRejects) {
      expect(n).toBeGreaterThanOrEqual(REPLAY_REPETITIONS);
    }
    // Alpha's reputation should crater — REPLAY_REPETITIONS β per tick.
    expect(result.evaluator.reputation("alpha")).toBeLessThan(0.2);
  });
});

describe("runSecureScenario — forged emitter", () => {
  test("off-roster emitter's observations all reject as unknown_sender", () => {
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 4,
      foreignEmitters: ["intruder-1"],
      attackStartTick: 1,
      foreignObservation: (emitterId, _tick, ts) => ({
        observer_id: emitterId,
        subject_id: "alpha",
        range_m: 5.0,
        bearing_rad: 0.0,
        timestamp_ns: ts,
      }),
    });
    const unknownRejects = result.snapshots.reduce(
      (a, s) => a + (s.rejectsByCategory["unknown_sender"] ?? 0),
      0,
    );
    expect(unknownRejects).toBeGreaterThanOrEqual(4); // 1 per tick × 4 ticks
  });
});
