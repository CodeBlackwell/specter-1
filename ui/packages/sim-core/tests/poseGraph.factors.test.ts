import { describe, it, expect } from "vitest";
import {
  DEFAULT_IMU_ACCEL_BIAS_SIGMA,
  DEFAULT_IMU_GYRO_BIAS_SIGMA,
  landmarkInformation,
  landmarkResidual,
  NLOS_INFLATE,
  odometryInformation,
  odometryResidual,
  type LandmarkFactor,
  type OdometryFactor,
  type Pose2,
} from "../src/poseGraph";

const close = (a: number, b: number, tol = 1.0e-10) => Math.abs(a - b) <= tol;

describe("Wave 1.2 — odometry information matrix (correct compounding)", () => {
  it("uses σ_xy = σ_a · Δt^1.5 / √3 per ADR 0016 §5", () => {
    const dt = 0.5;
    const omega = odometryInformation(dt);
    const expectedSigmaXy = (DEFAULT_IMU_ACCEL_BIAS_SIGMA * Math.pow(dt, 1.5)) / Math.sqrt(3.0);
    const expectedInvVarXy = 1.0 / (expectedSigmaXy * expectedSigmaXy);
    expect(close(omega[0][0], expectedInvVarXy)).toBe(true);
    expect(close(omega[1][1], expectedInvVarXy)).toBe(true);
    expect(omega[0][1]).toBe(0);
    expect(omega[1][0]).toBe(0);
  });

  it("uses σ_θ = σ_g · √Δt per Forster 2015 §4", () => {
    const dt = 0.5;
    const omega = odometryInformation(dt);
    const expectedSigmaTh = DEFAULT_IMU_GYRO_BIAS_SIGMA * Math.sqrt(dt);
    expect(close(omega[2][2], 1.0 / (expectedSigmaTh * expectedSigmaTh))).toBe(true);
  });

  it("position uncertainty grows as t^1.5 (8× σ² at 2× Δt, not 4×)", () => {
    const o1 = odometryInformation(1.0);
    const o2 = odometryInformation(2.0);
    expect(close(o2[0][0] / o1[0][0], 1.0 / 8.0, 1.0e-12)).toBe(true);
  });

  it("throws on non-positive Δt", () => {
    expect(() => odometryInformation(0.0)).toThrow();
    expect(() => odometryInformation(-0.1)).toThrow();
  });
});

describe("Wave 1.2 — landmark information matrix", () => {
  it("σ_r is range-dependent per ADR 0005 (doubles at d=10m → inv_var quarters)", () => {
    const near = landmarkInformation(0.0);
    const far = landmarkInformation(10.0);
    expect(close(far[0][0] / near[0][0], 0.25)).toBe(true);
  });

  it("NLOS inflates σ_r by 3× (inv_var → 1/9th)", () => {
    const los = landmarkInformation(5.0, false);
    const nlos = landmarkInformation(5.0, true);
    expect(close(nlos[0][0] / los[0][0], 1.0 / 9.0)).toBe(true);
    expect(close(nlos[1][1], los[1][1])).toBe(true);
    void NLOS_INFLATE;
  });

  it("bearing σ is range-independent", () => {
    expect(close(landmarkInformation(1.0)[1][1], landmarkInformation(20.0)[1][1])).toBe(true);
  });
});

describe("Wave 1.2 — OdometryFactor residual", () => {
  it("zero residual at exact solution", () => {
    const tI: Pose2 = { x: 1, y: 2, theta: 0.5 };
    const delta: Pose2 = { x: 0.5, y: -0.2, theta: 0.3 };
    const tJ: Pose2 = {
      x: tI.x + Math.cos(tI.theta) * delta.x - Math.sin(tI.theta) * delta.y,
      y: tI.y + Math.sin(tI.theta) * delta.x + Math.cos(tI.theta) * delta.y,
      theta: tI.theta + delta.theta,
    };
    const f: OdometryFactor = {
      kind: "odometry",
      fromId: "p0",
      toId: "p1",
      measurement: delta,
      info: odometryInformation(0.5),
      sourceId: "alpha",
    };
    const r = odometryResidual(f, new Map([["p0", tI], ["p1", tJ]]));
    expect(r.every((x) => close(x, 0))).toBe(true);
  });

  it("residual reflects body-frame perturbation", () => {
    const tI: Pose2 = { x: 0, y: 0, theta: 0 };
    const tJ: Pose2 = { x: 1, y: 0, theta: 0 };
    const f: OdometryFactor = {
      kind: "odometry",
      fromId: "p0",
      toId: "p1",
      measurement: { x: 1, y: 0, theta: 0 },
      info: odometryInformation(0.5),
      sourceId: "alpha",
    };
    const r = odometryResidual(f, new Map([["p0", tI], ["p1", { ...tJ, x: 1.1 }]]));
    expect(close(r[0], 0.1)).toBe(true);
    expect(close(r[1], 0)).toBe(true);
    expect(close(r[2], 0)).toBe(true);
  });
});

describe("Wave 1.2 — LandmarkFactor residual", () => {
  it("zero residual at exact solution", () => {
    const t: Pose2 = { x: 0, y: 0, theta: 0 };
    const f: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm0",
      rangeM: 5.0,
      bearingRad: Math.atan2(4, 3),
      info: landmarkInformation(5.0),
      sourceId: "alpha",
      nlos: false,
    };
    const r = landmarkResidual(f, new Map([["p0", t]]), new Map([["lm0", [3, 4]]]));
    expect(close(r[0], 0, 1.0e-12)).toBe(true);
    expect(close(r[1], 0, 1.0e-12)).toBe(true);
  });

  it("bearing residual wraps canonically across ±π", () => {
    const t: Pose2 = { x: 0, y: 0, theta: 0 };
    const f: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm0",
      rangeM: 1.0,
      bearingRad: Math.PI,
      info: landmarkInformation(1.0),
      sourceId: "alpha",
      nlos: false,
    };
    const r = landmarkResidual(f, new Map([["p0", t]]), new Map([["lm0", [-1, 0]]]));
    expect(close(r[0], 0, 1.0e-12)).toBe(true);
    expect(Math.abs(r[1]) <= 1.0e-10).toBe(true);
  });

  it("rotated pose changes bearing accordingly", () => {
    const t: Pose2 = { x: 0, y: 0, theta: Math.PI / 2 };
    const f: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm0",
      rangeM: 1.0,
      bearingRad: -Math.PI / 2,
      info: landmarkInformation(1.0),
      sourceId: "alpha",
      nlos: false,
    };
    const r = landmarkResidual(f, new Map([["p0", t]]), new Map([["lm0", [1, 0]]]));
    expect(close(r[0], 0, 1.0e-12)).toBe(true);
    expect(close(r[1], 0, 1.0e-12)).toBe(true);
  });
});
