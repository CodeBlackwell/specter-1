import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  between,
  compose,
  expSE2,
  inverse,
  logSE2,
  rightJacobianSE2,
  type Pose2,
} from "../src/poseGraph";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  se2: Array<{
    section: string;
    cases: Array<Record<string, unknown>>;
  }>;
};

type ExpCase = {
  label: string;
  xi: [number, number, number];
  exp: Pose2;
  log_round_trip: [number, number, number];
  right_jacobian: number[][];
};

type GroupCase = {
  label: string;
  a: Pose2;
  b: Pose2;
  compose: Pose2;
  inverse_a: Pose2;
  between_ab: Pose2;
};

const expCases = (fixtures.se2.find((s) => s.section === "exp_log_jacobian")?.cases ?? []) as ExpCase[];
const groupCases = (fixtures.se2.find((s) => s.section === "group_ops")?.cases ?? []) as GroupCase[];

describe("SE(2) parity vs Python (specter.slam.pose_graph)", () => {
  it.each(expCases)("expSE2 $label matches Python", (vec) => {
    const pose = expSE2(vec.xi);
    expect(pose.x).toBeCloseTo(vec.exp.x, 10);
    expect(pose.y).toBeCloseTo(vec.exp.y, 10);
    expect(pose.theta).toBeCloseTo(vec.exp.theta, 10);
  });

  it.each(expCases)("logSE2 $label round-trips Python's tangent", (vec) => {
    const pose = expSE2(vec.xi);
    const xiBack = logSE2(pose);
    expect(xiBack[0]).toBeCloseTo(vec.log_round_trip[0], 10);
    expect(xiBack[1]).toBeCloseTo(vec.log_round_trip[1], 10);
    expect(xiBack[2]).toBeCloseTo(vec.log_round_trip[2], 10);
  });

  it.each(expCases)("rightJacobianSE2 $label matches Python row-by-row", (vec) => {
    const jr = rightJacobianSE2(vec.xi);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(jr[i]![j]!).toBeCloseTo(vec.right_jacobian[i]![j]!, 10);
      }
    }
  });

  it.each(groupCases)("compose $label matches Python", (vec) => {
    const c = compose(vec.a, vec.b);
    expect(c.x).toBeCloseTo(vec.compose.x, 10);
    expect(c.y).toBeCloseTo(vec.compose.y, 10);
    expect(c.theta).toBeCloseTo(vec.compose.theta, 10);
  });

  it.each(groupCases)("inverse $label matches Python", (vec) => {
    const inv = inverse(vec.a);
    expect(inv.x).toBeCloseTo(vec.inverse_a.x, 10);
    expect(inv.y).toBeCloseTo(vec.inverse_a.y, 10);
    expect(inv.theta).toBeCloseTo(vec.inverse_a.theta, 10);
  });

  it.each(groupCases)("between $label matches Python", (vec) => {
    const bet = between(vec.a, vec.b);
    expect(bet.x).toBeCloseTo(vec.between_ab.x, 10);
    expect(bet.y).toBeCloseTo(vec.between_ab.y, 10);
    expect(bet.theta).toBeCloseTo(vec.between_ab.theta, 10);
  });
});

describe("SE(2) group axioms (independent of fixture)", () => {
  const ID: Pose2 = { x: 0, y: 0, theta: 0 };

  it("compose(a, identity) = a and compose(identity, a) = a", () => {
    const a: Pose2 = { x: 1.5, y: -0.7, theta: 0.4 };
    const right = compose(a, ID);
    const left = compose(ID, a);
    for (const [name, c] of [
      ["right", right],
      ["left", left],
    ] as const) {
      expect(c.x).toBeCloseTo(a.x, 12);
      expect(c.y).toBeCloseTo(a.y, 12);
      expect(c.theta).toBeCloseTo(a.theta, 12);
      void name;
    }
  });

  it("compose(a, inverse(a)) = identity (within machine precision)", () => {
    const a: Pose2 = { x: 1.5, y: -0.7, theta: 0.4 };
    const c = compose(a, inverse(a));
    expect(c.x).toBeCloseTo(0, 10);
    expect(c.y).toBeCloseTo(0, 10);
    expect(c.theta).toBeCloseTo(0, 10);
  });

  it("expSE2(logSE2(T)) = T (within wrap on θ)", () => {
    const tests: Pose2[] = [
      { x: 1.0, y: 2.0, theta: 0.5 },
      { x: -0.3, y: 0.7, theta: -1.2 },
      { x: 2.5, y: -1.1, theta: 0.01 },
      { x: 0.1, y: -0.2, theta: 1.0e-7 },
    ];
    for (const t of tests) {
      const back = expSE2(logSE2(t));
      expect(back.x).toBeCloseTo(t.x, 10);
      expect(back.y).toBeCloseTo(t.y, 10);
      expect(back.theta).toBeCloseTo(t.theta, 10);
    }
  });

  it("between(a, b) followed by compose(a, between) reconstructs b", () => {
    const a: Pose2 = { x: 1.0, y: 0.5, theta: 0.7 };
    const b: Pose2 = { x: 0.3, y: -0.2, theta: 0.1 };
    const rel = between(a, b);
    const reconstructed = compose(a, rel);
    expect(reconstructed.x).toBeCloseTo(b.x, 10);
    expect(reconstructed.y).toBeCloseTo(b.y, 10);
    expect(reconstructed.theta).toBeCloseTo(b.theta, 10);
  });
});
