/**
 * runCooperativeSlamDemo (L10/L11/L12 substrate) — shape + correctness gates.
 * Mirrors Python's bidirectional trust test in spirit: pose lie distorts the
 * naive joint map; the closed loop recovers; A0's reputation declines over
 * cycles in the robust scenario.
 */

import { describe, expect, it } from "vitest";
import {
  cooperativeSlamTruth,
  runCooperativeSlamDemo,
  type CooperativeScenario,
} from "../src/index";

// Pre-roll frames (graph construction) have partial agent sets and zero-cost
// when only some factors are in place. Tests that reason about converged
// behavior should skip past pre-roll by selecting the first frame in which
// all 4 agents AND all 4 landmarks are populated — the "fully constructed,
// pre-optimize" anchor.
function postPreroll(scenario: CooperativeScenario) {
  const snaps = runCooperativeSlamDemo(scenario);
  const firstFull = snaps.findIndex((s) => s.agents.length === 4 && s.landmarks.size === 4);
  expect(firstFull).toBeGreaterThanOrEqual(0);
  return snaps.slice(firstFull);
}

describe("runCooperativeSlamDemo", () => {
  it("honest scenario emits per-LM-iteration snapshots ending at converged low cost", () => {
    const snaps = postPreroll("honest");
    expect(snaps.length).toBeGreaterThanOrEqual(2);
    // Per-iteration playback: cost must end below pre-optimize.
    expect(snaps.at(-1)!.cost).toBeLessThan(snaps[0]!.cost);
  });

  it("pose_lie_naive drags landmark estimates away from truth", () => {
    const naive = runCooperativeSlamDemo("pose_lie_naive");
    const truth = new Map(cooperativeSlamTruth().landmarks);
    const final = naive[naive.length - 1]!;
    let maxErr = 0;
    for (const [lid, [lx, ly]] of final.landmarks) {
      const t = truth.get(lid);
      if (!t) continue;
      maxErr = Math.max(maxErr, Math.hypot(lx - t[0], ly - t[1]));
    }
    // Naive solution should be visibly off truth (≥ 0.1 m).
    expect(maxErr).toBeGreaterThan(0.1);
  });

  it("pose_lie_robust collapses A0's reputation while honest peers rebound", () => {
    const robust = postPreroll("pose_lie_robust");
    // Per-iteration playback emits many snapshots; require at least one per cycle anchor.
    expect(robust.length).toBeGreaterThanOrEqual(5);
    const final = robust.at(-1)!;
    const a0RepEnd = final.agents.find((a) => a.id === "A0")!.reputation;
    expect(a0RepEnd).toBeLessThan(0.1);  // collapsed to near-floor
    for (const id of ["A1", "A2", "A3"]) {
      const r = final.agents.find((a) => a.id === id)!.reputation;
      expect(r).toBeGreaterThan(0.5);
    }
    const minHonest = Math.min(
      ...["A1", "A2", "A3"].map(
        (id) => final.agents.find((a) => a.id === id)!.reputation,
      ),
    );
    expect(a0RepEnd).toBeLessThan(minHonest);
  });

  it("inter-robot edges are emitted on every post-pre-roll snapshot", () => {
    const snaps = postPreroll("honest");
    for (const s of snaps) {
      expect(s.interRobotEdges.length).toBeGreaterThan(0);
    }
  });

  it("setReputationSource lets evidence flow into the closed loop", () => {
    // With per-iteration playback, A0's reputation is read at each LM step
    // and may dip slightly between evidence cycles (live-source coupling), so
    // we only require start > end rather than strict monotonicity.
    const robust = postPreroll("pose_lie_robust");
    const trace = robust.map(
      (s) => s.agents.find((a) => a.id === "A0")!.reputation,
    );
    expect(trace.at(-1)!).toBeLessThan(trace[0]! - 0.1);
  });
});
