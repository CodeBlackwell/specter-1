import { describe, it, expect } from "vitest";
import {
  between,
  choleskySolve,
  LM_MAX_ITERATIONS,
  landmarkInformation,
  odometryInformation,
  PoseGraphTS,
  type LandmarkFactor,
  type OdometryFactor,
  type Pose2,
} from "../src/poseGraph";

const close = (a: number, b: number, tol = 1.0e-6) => Math.abs(a - b) <= tol;

describe("Wave 1.3 — dense Cholesky solve", () => {
  it("solves A x = b on a known SPD matrix", () => {
    const a = [
      [4, 1, 0],
      [1, 5, 2],
      [0, 2, 6],
    ];
    const b = [7, 13, 14];
    const x = choleskySolve(a, b)!;
    expect(x).not.toBeNull();
    // Verify A x = b.
    for (let i = 0; i < 3; i++) {
      let s = 0;
      for (let j = 0; j < 3; j++) s += a[i]![j]! * x[j]!;
      expect(close(s, b[i]!, 1.0e-10)).toBe(true);
    }
  });

  it("returns null on non-positive-definite matrix", () => {
    const indefinite = [
      [1, 0],
      [0, -1],
    ];
    expect(choleskySolve(indefinite, [1, 1])).toBeNull();
  });
});

describe("Wave 1.3 — Levenberg-Marquardt", () => {
  it("converges at truth (zero residual) in 1 iteration", () => {
    const pg = new PoseGraphTS();
    const truth: Pose2[] = [
      { x: 0, y: 0, theta: 0 },
      { x: 1, y: 0, theta: 0 },
      { x: 2, y: 0, theta: 0 },
    ];
    truth.forEach((t, i) => pg.addPose(`p${i}`, t));
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
    expect(pg.finalCost).toBeLessThan(1.0e-12);
  });

  it("corrects pose drift from consistent odometry", () => {
    const pg = new PoseGraphTS();
    const truth: Pose2[] = [
      { x: 0, y: 0, theta: 0 },
      { x: 1, y: 0, theta: 0 },
      { x: 2, y: 0, theta: 0 },
    ];
    pg.addPose("p0", truth[0]!);
    pg.addPose("p1", { x: 1.1, y: 0.05, theta: 0.02 });
    pg.addPose("p2", { x: 2.15, y: 0.1, theta: 0.04 });
    const info = odometryInformation(0.5);
    for (let i = 0; i < truth.length - 1; i++) {
      pg.addOdometryFactor({
        kind: "odometry",
        fromId: `p${i}`,
        toId: `p${i + 1}`,
        measurement: between(truth[i]!, truth[i + 1]!),
        info,
        sourceId: "alpha",
      });
    }
    const preCost = pg.totalCost();
    pg.optimize();
    expect(pg.finalCost).toBeLessThan(preCost / 100);
    const traj = new Map(pg.trajectory());
    for (let i = 1; i < truth.length; i++) {
      const r = traj.get(`p${i}`)!;
      expect(close(r.x, truth[i]!.x, 1.0e-3)).toBe(true);
      expect(close(r.y, truth[i]!.y, 1.0e-3)).toBe(true);
      expect(close(r.theta, truth[i]!.theta, 1.0e-3)).toBe(true);
    }
  });

  it("localizes a landmark from two pose observations", () => {
    const pg = new PoseGraphTS();
    const p0: Pose2 = { x: 0, y: 0, theta: 0 };
    const p1: Pose2 = { x: 2, y: 0, theta: 0 };
    const lmTruth: [number, number] = [1, 1];
    pg.addPose("p0", p0);
    pg.addPose("p1", p1);
    pg.addLandmark("lm0", [0, 0]);
    for (const [pid, t] of [["p0", p0], ["p1", p1]] as Array<[string, Pose2]>) {
      const dx = lmTruth[0] - t.x;
      const dy = lmTruth[1] - t.y;
      const r = Math.hypot(dx, dy);
      const b = Math.atan2(dy, dx) - t.theta;
      const f: LandmarkFactor = {
        kind: "landmark",
        poseId: pid,
        landmarkId: "lm0",
        rangeM: r,
        bearingRad: b,
        info: landmarkInformation(r),
        sourceId: "alpha",
        nlos: false,
      };
      pg.addLandmarkFactor(f);
    }
    pg.optimize();
    const lm = pg.landmarkPositions().get("lm0")!;
    expect(close(lm[0], lmTruth[0], 5.0e-3)).toBe(true);
    expect(close(lm[1], lmTruth[1], 5.0e-3)).toBe(true);
  });

  it("iteration count never exceeds LM_MAX_ITERATIONS", () => {
    const pg = new PoseGraphTS();
    pg.addPose("p0", { x: 0, y: 0, theta: 0 });
    pg.addPose("p1", { x: 0.5, y: 0, theta: 0 });
    pg.addOdometryFactor({
      kind: "odometry",
      fromId: "p0",
      toId: "p1",
      measurement: { x: 1, y: 0, theta: 0 },
      info: odometryInformation(0.5),
      sourceId: "alpha",
    });
    pg.optimize();
    expect(pg.iterationsLastRun).toBeLessThanOrEqual(LM_MAX_ITERATIONS);
  });

  it("first pose is gauge-anchored — does not move during optimize", () => {
    const pg = new PoseGraphTS();
    pg.addPose("p0", { x: 0, y: 0, theta: 0 });
    pg.addPose("p1", { x: 5, y: 0, theta: 0 });
    pg.addOdometryFactor({
      kind: "odometry",
      fromId: "p0",
      toId: "p1",
      measurement: { x: 1, y: 0, theta: 0 },
      info: odometryInformation(0.5),
      sourceId: "alpha",
    });
    pg.optimize();
    const traj = new Map(pg.trajectory());
    const p0 = traj.get("p0")!;
    expect(p0.x).toBe(0);
    expect(p0.y).toBe(0);
    expect(p0.theta).toBe(0);
    const p1 = traj.get("p1")!;
    expect(close(p1.x, 1.0, 1.0e-3)).toBe(true);
  });
});
