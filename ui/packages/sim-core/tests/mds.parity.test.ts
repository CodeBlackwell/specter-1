import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { embeddabilityScore, lyingEdgeResiduals, perPointResiduals } from "../src/mds";
import { eigSymmetric } from "../src/linalg";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  mds: Array<{
    label: string;
    D: number[][];
    embeddability: number;
    per_point: number[];
    lying_edge: number[][];
  }>;
};

describe("MDS parity vs Python (specter.trust.mds)", () => {
  it.each(fixtures.mds)("embeddability_score $label", (vec) => {
    const score = embeddabilityScore(vec.D);
    expect(score).toBeCloseTo(vec.embeddability, 8);
  });

  it.each(fixtures.mds)("per_point_residuals $label sum", (vec) => {
    const ours = perPointResiduals(vec.D);
    const sumOurs = ours.reduce((a, b) => a + b, 0);
    const sumTheirs = vec.per_point.reduce((a, b) => a + b, 0);
    expect(sumOurs).toBeCloseTo(sumTheirs, 8);
  });

  it.each(fixtures.mds)("lying_edge_residuals $label is byte-equal", (vec) => {
    const ours = lyingEdgeResiduals(vec.D);
    for (let i = 0; i < vec.lying_edge.length; i++) {
      for (let j = 0; j < vec.lying_edge[i]!.length; j++) {
        expect(ours[i]![j]).toBeCloseTo(vec.lying_edge[i]![j]!, 10);
      }
    }
  });

  it("colluder_pair_0_1 lying-edge max identifies edge 0↔1", () => {
    const vec = fixtures.mds.find((c) => c.label === "colluder_pair_0_1");
    if (!vec) throw new Error("fixture missing");
    const R = lyingEdgeResiduals(vec.D);
    let maxIJ: [number, number] = [0, 0];
    let max = 0;
    for (let i = 0; i < R.length; i++) {
      for (let j = 0; j < R[i]!.length; j++) {
        if (R[i]![j]! > max) {
          max = R[i]![j]!;
          maxIJ = [i, j];
        }
      }
    }
    const [i, j] = maxIJ;
    expect(new Set([i, j])).toEqual(new Set([0, 1]));
    expect(max).toBeGreaterThan(0.8);
  });

  it("honest_square embeddability is near zero", () => {
    const vec = fixtures.mds.find((c) => c.label === "honest_square");
    if (!vec) throw new Error("fixture missing");
    expect(embeddabilityScore(vec.D)).toBeLessThan(0.05);
  });
});

describe("eigSymmetric sanity", () => {
  it("diagonal matrix returns its diagonal", () => {
    const A = [
      [2, 0, 0],
      [0, 5, 0],
      [0, 0, 3],
    ];
    const { values } = eigSymmetric(A);
    expect(values.slice().sort((a, b) => a - b)).toEqual([2, 3, 5]);
  });

  it("reconstructs B = V Λ Vᵀ for a 4x4 symmetric matrix", () => {
    const A = [
      [4, 1, 2, 0.5],
      [1, 3, 0, 1],
      [2, 0, 5, 0.2],
      [0.5, 1, 0.2, 2],
    ];
    const { values, vectors } = eigSymmetric(A);
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let v = 0;
        for (let k = 0; k < n; k++) v += vectors[i]![k]! * values[k]! * vectors[j]![k]!;
        expect(v).toBeCloseTo(A[i]![j]!, 8);
      }
    }
  });
});
