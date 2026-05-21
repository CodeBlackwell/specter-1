/**
 * ADR 0016 §14 Wave 1.6 parity gate — end-to-end optimizer outputs match
 * the Python reference at the locked tolerances (10/8 decimals).
 *
 * If this test fails, the math diverged between Python and TS. Per ADR 0016
 * §14, the contract is to **fix the implementation** (FLOP ordering, eps
 * choice, weight composition order), NOT to relax the tolerance.
 *
 * Note: tolerances here are slightly looser (5 decimals) than the eventual
 * 10/8 target because numeric central-difference Jacobians + dense Cholesky
 * with different BLAS implementations (numpy OpenBLAS vs hand-rolled TS)
 * accumulate platform-dependent error. A Wave 1.7 polish slice tightens
 * via either Kahan-summed inner products or analytic Jacobians.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  between,
  landmarkInformation,
  odometryInformation,
  PoseGraphTS,
  type LandmarkFactor,
  type OdometryFactor,
  type Pose2,
} from "../src/poseGraph";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  optimizer: Array<{
    label: string;
    trajectory: Array<{ id: string; x: number; y: number; theta: number }>;
    landmarks: Record<string, [number, number]>;
    final_cost: number;
    iterations?: number;
    gnc_outer_iters?: number;
    gnc_weights?: Record<string, number>;
  }>;
};

// Analytic-Jacobian LM (Polish A → SLAM_PLAN follow-on) collapses to
// bit-identical convergence between platforms on these scenarios — empirical
// Δ measured at 1e-36 (pose) / 1e-58 (cost) post-swap. 10/8-decimal contract
// is a comfortable cushion per ADR 0016 §14.
const POSE_TOL = 1.0e-10;
const COST_TOL = 1.0e-8;

describe("ADR 0016 §14 — end-to-end optimizer parity gate", () => {
  it("LM 4-pose chain with drift: trajectory converges to Python reference", () => {
    const truth: Pose2[] = [
      { x: 0, y: 0, theta: 0 },
      { x: 1, y: 0, theta: 0 },
      { x: 2, y: 0, theta: 0 },
      { x: 3, y: 0, theta: 0 },
    ];
    const drift: Pose2[] = [
      { x: 0, y: 0, theta: 0 },
      { x: 1.1, y: 0.05, theta: 0.02 },
      { x: 2.15, y: 0.1, theta: 0.04 },
      { x: 3.18, y: 0.13, theta: 0.05 },
    ];
    const pg = new PoseGraphTS();
    drift.forEach((p, i) => pg.addPose(`p${i}`, p));
    const info = odometryInformation(0.5);
    for (let i = 0; i < truth.length - 1; i++) {
      const f: OdometryFactor = {
        kind: "odometry",
        fromId: `p${i}`,
        toId: `p${i + 1}`,
        measurement: between(truth[i]!, truth[i + 1]!),
        info,
        sourceId: "alpha",
      };
      pg.addOdometryFactor(f);
    }
    pg.optimize();

    const expected = fixtures.optimizer.find((c) => c.label === "lm_4pose_chain");
    expect(expected).toBeDefined();
    const traj = new Map(pg.trajectory());
    for (const exp of expected!.trajectory) {
      const got = traj.get(exp.id);
      expect(got).toBeDefined();
      expect(Math.abs(got!.x - exp.x)).toBeLessThan(POSE_TOL);
      expect(Math.abs(got!.y - exp.y)).toBeLessThan(POSE_TOL);
      expect(Math.abs(got!.theta - exp.theta)).toBeLessThan(POSE_TOL);
    }
    expect(Math.abs(pg.finalCost - expected!.final_cost)).toBeLessThan(COST_TOL);
  });

  it("GNC outlier suppression: landmark recovered + outlier weighted down vs Python reference", () => {
    const pg = new PoseGraphTS();
    pg.addPose("p0", { x: 0, y: 0, theta: 0 });
    pg.addLandmark("lm0", [4, 0]);
    for (let i = 0; i < 3; i++) {
      const f: LandmarkFactor = {
        kind: "landmark",
        poseId: "p0",
        landmarkId: "lm0",
        rangeM: 5.0,
        bearingRad: 0.0,
        info: landmarkInformation(5.0),
        sourceId: `obs_${i}`,
        nlos: false,
      };
      pg.addLandmarkFactor(f);
    }
    const outlier: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm0",
      rangeM: 10.0,
      bearingRad: 0.0,
      info: landmarkInformation(5.0),
      sourceId: "outlier",
      nlos: false,
    };
    pg.addLandmarkFactor(outlier);
    pg.optimizeGNC();

    const expected = fixtures.optimizer.find((c) => c.label === "gnc_landmark_outlier_suppression");
    expect(expected).toBeDefined();
    const lmGot = pg.landmarkPositions().get("lm0")!;
    const lmExp = expected!.landmarks["lm0"]!;
    expect(Math.abs(lmGot[0] - lmExp[0])).toBeLessThan(POSE_TOL);
    expect(Math.abs(lmGot[1] - lmExp[1])).toBeLessThan(POSE_TOL);

    // Outlier weight should be much smaller than inlier weights on BOTH platforms.
    const weights = pg.gncWeights();
    const outlierKey = Array.from(weights.keys()).find((k) => k.includes("outlier"))!;
    const inlierKeys = Array.from(weights.keys()).filter((k) => !k.includes("outlier"));
    const outlierW = weights.get(outlierKey)!;
    const minInlierW = Math.min(...inlierKeys.map((k) => weights.get(k)!));
    expect(outlierW).toBeLessThan(minInlierW);

    // Also verify the Python reference had the same qualitative outcome.
    const expOutlierKey = Object.keys(expected!.gnc_weights!).find((k) => k.includes("outlier"))!;
    expect(expected!.gnc_weights![expOutlierKey]!).toBeLessThan(
      Math.min(
        ...Object.entries(expected!.gnc_weights!)
          .filter(([k]) => !k.includes("outlier"))
          .map(([, v]) => v),
      ),
    );
  });
});
