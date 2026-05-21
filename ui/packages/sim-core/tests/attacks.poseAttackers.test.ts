import { describe, expect, test } from "vitest";

import {
  applyPoseAttacks,
  driftPose,
  odometryCorrupt,
  poseLie,
  POSE_LIE_OFFSET_M,
  DRIFT_POSE_PER_TICK_M,
  ODOMETRY_BIAS_RAD_PER_TICK,
  type PoseReport,
} from "../src";

const ts = (n: number) => BigInt(n);

const truth: PoseReport = {
  agent_id: "alpha",
  x: 1.0,
  y: 2.0,
  theta: 0.5,
  timestamp_ns: ts(0),
};

const honest: PoseReport = {
  agent_id: "bravo",
  x: 3.0,
  y: 4.0,
  theta: 0.0,
  timestamp_ns: ts(0),
};

describe("poseLie attacker", () => {
  test("offsets the attacker's reported xy by POSE_LIE_OFFSET_M and passes honest poses through", () => {
    const attacker = poseLie("alpha");
    const out = applyPoseAttacks(0, ts(100), [truth, honest], [attacker]);
    const lying = out.find((p) => p.agent_id === "alpha");
    const passthrough = out.find((p) => p.agent_id === "bravo");
    expect(lying).toBeDefined();
    expect(lying!.x).toBeCloseTo(truth.x + POSE_LIE_OFFSET_M, 12);
    expect(lying!.y).toBeCloseTo(truth.y + POSE_LIE_OFFSET_M, 12);
    expect(lying!.theta).toBeCloseTo(truth.theta, 12);
    expect(lying!.timestamp_ns).toBe(ts(100));
    expect(passthrough).toEqual(honest);
  });

  test("custom offset is honored", () => {
    const attacker = poseLie("alpha", 1.5);
    const [lying] = applyPoseAttacks(0, ts(0), [truth], [attacker]);
    expect(lying!.x).toBeCloseTo(truth.x + 1.5, 12);
  });

  test("when the attacker has no truth in the input, no pose is emitted", () => {
    const attacker = poseLie("ghost");
    const out = applyPoseAttacks(0, ts(0), [truth], [attacker]);
    expect(out).toEqual([truth]);
  });
});

describe("driftPose attacker", () => {
  test("accumulates DRIFT_POSE_PER_TICK_M each call", () => {
    const attacker = driftPose("alpha");
    const t0 = applyPoseAttacks(0, ts(0), [truth], [attacker])[0]!;
    const t1 = applyPoseAttacks(1, ts(10), [truth], [attacker])[0]!;
    const t2 = applyPoseAttacks(2, ts(20), [truth], [attacker])[0]!;
    expect(t0.x).toBeCloseTo(truth.x + 1 * DRIFT_POSE_PER_TICK_M, 12);
    expect(t1.x).toBeCloseTo(truth.x + 2 * DRIFT_POSE_PER_TICK_M, 12);
    expect(t2.x).toBeCloseTo(truth.x + 3 * DRIFT_POSE_PER_TICK_M, 12);
  });
});

describe("odometryCorrupt attacker", () => {
  test("accumulates ODOMETRY_BIAS_RAD_PER_TICK on theta and leaves xy untouched", () => {
    const attacker = odometryCorrupt("alpha");
    const t0 = applyPoseAttacks(0, ts(0), [truth], [attacker])[0]!;
    const t5 = (() => {
      let last = t0;
      for (let i = 1; i < 5; i++) {
        last = applyPoseAttacks(i, ts(BigInt(i) as unknown as number), [truth], [attacker])[0]!;
      }
      return last;
    })();
    expect(t0.theta).toBeCloseTo(truth.theta + ODOMETRY_BIAS_RAD_PER_TICK, 12);
    expect(t5.theta).toBeCloseTo(truth.theta + 5 * ODOMETRY_BIAS_RAD_PER_TICK, 12);
    expect(t5.x).toBeCloseTo(truth.x, 12);
    expect(t5.y).toBeCloseTo(truth.y, 12);
  });
});

describe("applyPoseAttacks output ordering", () => {
  test("attacker-emitted poses appear before pass-through poses (stable for deterministic delivery)", () => {
    const attacker = poseLie("alpha");
    const out = applyPoseAttacks(0, ts(0), [honest, truth], [attacker]);
    expect(out[0]!.agent_id).toBe("alpha");
    expect(out[1]!.agent_id).toBe("bravo");
  });
});
