/**
 * Polish C — end-to-end L09 SLAM scenario test. Validates that the pre-canned
 * single-agent loop-closure demo produces a meaningful snapshot sequence the
 * Workshop Console can drive (drift → loop closure detection → optimization snap).
 *
 * Full React canvas integration is the remaining follow-on; this test
 * proves the sim-core surface delivers what the canvas needs.
 */

import { describe, it, expect } from "vitest";
import {
  detectLoopClosures,
  landmarkInformation,
  runSingleAgentLoopClosureDemo,
  umeyamaSim2,
  type LandmarkFactor,
} from "../src/poseGraph";

describe("Polish C — Umeyama Sim(2) TS port matches Python algebra", () => {
  it("identity from identical points", () => {
    const pts: Array<[number, number]> = [[0, 0], [1, 0], [0, 1]];
    const s = umeyamaSim2(pts, pts)!;
    expect(s).not.toBeNull();
    expect(Math.abs(s.x)).toBeLessThan(1.0e-12);
    expect(Math.abs(s.y)).toBeLessThan(1.0e-12);
    expect(Math.abs(s.theta)).toBeLessThan(1.0e-12);
    expect(Math.abs(s.scale - 1)).toBeLessThan(1.0e-12);
  });

  it("pure translation (3, 5)", () => {
    const src: Array<[number, number]> = [[0, 0], [1, 0], [0, 1]];
    const dst: Array<[number, number]> = [[3, 5], [4, 5], [3, 6]];
    const s = umeyamaSim2(src, dst)!;
    expect(Math.abs(s.x - 3)).toBeLessThan(1.0e-10);
    expect(Math.abs(s.y - 5)).toBeLessThan(1.0e-10);
    expect(Math.abs(s.scale - 1)).toBeLessThan(1.0e-10);
  });

  it("pure rotation 90° CCW", () => {
    const src: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0]];
    const dst: Array<[number, number]> = [[0, 1], [-1, 0], [0, -1]];
    const s = umeyamaSim2(src, dst)!;
    expect(Math.abs(s.theta - Math.PI / 2)).toBeLessThan(1.0e-10);
    expect(Math.abs(s.scale - 1)).toBeLessThan(1.0e-10);
  });

  it("pure scale 2×", () => {
    const src: Array<[number, number]> = [[1, 0], [0, 1], [-1, 0]];
    const dst: Array<[number, number]> = [[2, 0], [0, 2], [-2, 0]];
    const s = umeyamaSim2(src, dst)!;
    expect(Math.abs(s.scale - 2)).toBeLessThan(1.0e-10);
    expect(Math.abs(s.theta)).toBeLessThan(1.0e-10);
  });

  it("returns null on coincident source", () => {
    expect(umeyamaSim2([[1, 1], [1, 1]], [[0, 0], [2, 2]])).toBeNull();
  });
});

describe("Polish C — loop closure detection", () => {
  function obs(poseId: string, lmId: string, bx: number, by: number): LandmarkFactor {
    const r = Math.hypot(bx, by);
    return {
      kind: "landmark",
      poseId,
      landmarkId: lmId,
      rangeM: r,
      bearingRad: Math.atan2(by, bx),
      info: landmarkInformation(r),
      sourceId: "alpha",
      nlos: false,
    };
  }

  it("detects closure between p0 and p10 sharing 2 landmarks", () => {
    const poseIds = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const factors: LandmarkFactor[] = [
      obs("p0", "lm_a", 1, 0.5),
      obs("p0", "lm_b", 1, -0.5),
      obs("p10", "lm_a", 1, 0.5),
      obs("p10", "lm_b", 1, -0.5),
    ];
    const closures = detectLoopClosures(poseIds, factors);
    expect(closures.length).toBeGreaterThanOrEqual(1);
    expect(closures[0]!.fromId).toBe("p0");
    expect(closures[0]!.toId).toBe("p10");
  });

  it("no closure within MIN_KEYFRAME_GAP", () => {
    const poseIds = ["p0", "p1"];
    const factors = [obs("p0", "lm_a", 1, 0), obs("p1", "lm_a", 1, 0)];
    expect(detectLoopClosures(poseIds, factors)).toHaveLength(0);
  });

  it("no closure with < MIN_SHARED_LANDMARKS", () => {
    const poseIds = Array.from({ length: 12 }, (_, i) => `p${i}`);
    const factors = [obs("p0", "lm_a", 1, 0), obs("p11", "lm_a", 1, 0)];
    expect(detectLoopClosures(poseIds, factors)).toHaveLength(0);
  });
});

describe("Polish C — L09 end-to-end SLAM scenario", () => {
  it("emits per-LM-iteration snapshots with anchored pre-optimize + post-closure stages", () => {
    const snaps = runSingleAgentLoopClosureDemo();
    // ≥ 3 anchored stages plus at least one per-iteration step each LM phase.
    expect(snaps.length).toBeGreaterThanOrEqual(3);
    // Ticks are 0..N-1 and monotonic.
    snaps.forEach((s, i) => expect(s.tick).toBe(i));
    // First snapshot is the pre-optimize anchor — no closure edges yet, zero iterations.
    expect(snaps[0]!.closureEdges.length).toBe(0);
    expect(snaps[0]!.iterations).toBe(0);
  });

  it("cost decreases over the LM trajectory (start > end)", () => {
    const snaps = runSingleAgentLoopClosureDemo();
    expect(snaps.at(-1)!.cost).toBeLessThan(snaps[0]!.cost);
  });

  it("detects at least one loop closure in the final snapshot", () => {
    const snaps = runSingleAgentLoopClosureDemo();
    expect(snaps.at(-1)!.closureEdges.length).toBeGreaterThan(0);
  });

  it("trajectory has 12 poses + landmark estimates populated", () => {
    const snaps = runSingleAgentLoopClosureDemo();
    const final = snaps.at(-1)!;
    expect(final.trajectory.length).toBe(12);
    expect(final.landmarks.size).toBe(4);
  });
});
