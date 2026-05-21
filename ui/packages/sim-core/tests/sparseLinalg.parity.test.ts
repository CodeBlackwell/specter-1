import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  cscFromTriplets,
  cscMatVec,
  cscToDense,
  cscTranspose,
  denseToCsc,
} from "../src/sparseLinalg";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  csc?: Array<{
    label: string;
    dense: number[][];
    csc: {
      nrows: number;
      ncols: number;
      indptr: number[];
      indices: number[];
      data: number[];
    };
    matvec: { x: number[]; y: number[] };
  }>;
};

describe("CSC sparse matrix parity vs Python (scipy.sparse)", () => {
  const cases = fixtures.csc ?? [];

  if (cases.length === 0) {
    it.skip("scipy missing in fixture generator — CSC cases skipped", () => {});
    return;
  }

  it.each(cases)("denseToCsc $label matches scipy CSC encoding", (vec) => {
    const ours = denseToCsc(vec.dense);
    expect(ours.nrows).toBe(vec.csc.nrows);
    expect(ours.ncols).toBe(vec.csc.ncols);
    expect([...ours.indptr]).toEqual(vec.csc.indptr);
    expect([...ours.indices]).toEqual(vec.csc.indices);
    expect(ours.data.length).toBe(vec.csc.data.length);
    for (let k = 0; k < ours.data.length; k++) {
      expect(ours.data[k]!).toBeCloseTo(vec.csc.data[k]!, 12);
    }
  });

  it.each(cases)("cscToDense $label round-trips byte-equal", (vec) => {
    const csc = denseToCsc(vec.dense);
    const dense = cscToDense(csc);
    expect(dense.length).toBe(vec.dense.length);
    for (let i = 0; i < dense.length; i++) {
      expect(dense[i]!.length).toBe(vec.dense[i]!.length);
      for (let j = 0; j < dense[i]!.length; j++) {
        expect(dense[i]![j]!).toBeCloseTo(vec.dense[i]![j]!, 12);
      }
    }
  });

  it.each(cases)("cscMatVec $label matches scipy y = A x", (vec) => {
    const csc = denseToCsc(vec.dense);
    const y = cscMatVec(csc, vec.matvec.x);
    expect(y.length).toBe(vec.matvec.y.length);
    for (let i = 0; i < y.length; i++) {
      expect(y[i]!).toBeCloseTo(vec.matvec.y[i]!, 10);
    }
  });

  it.each(cases)("cscTranspose $label is involutive", (vec) => {
    const csc = denseToCsc(vec.dense);
    const tt = cscTranspose(cscTranspose(csc));
    expect(tt.nrows).toBe(csc.nrows);
    expect(tt.ncols).toBe(csc.ncols);
    const dense = cscToDense(tt);
    for (let i = 0; i < dense.length; i++) {
      for (let j = 0; j < dense[i]!.length; j++) {
        expect(dense[i]![j]!).toBeCloseTo(vec.dense[i]![j]!, 12);
      }
    }
  });
});

describe("CSC sparse matrix triplet construction", () => {
  it("cscFromTriplets coalesces duplicate (row, col) entries by summing", () => {
    const csc = cscFromTriplets(2, 2, [
      [0, 0, 1.0],
      [0, 0, 2.0],
      [1, 1, 3.0],
    ]);
    const dense = cscToDense(csc);
    expect(dense[0]![0]!).toBe(3.0);
    expect(dense[1]![1]!).toBe(3.0);
    expect(dense[0]![1]!).toBe(0);
    expect(dense[1]![0]!).toBe(0);
  });

  it("cscFromTriplets canonicalizes within-column ascending row order", () => {
    const csc = cscFromTriplets(3, 1, [
      [2, 0, 30.0],
      [0, 0, 10.0],
      [1, 0, 20.0],
    ]);
    expect([...csc.indices]).toEqual([0, 1, 2]);
    expect([...csc.data]).toEqual([10.0, 20.0, 30.0]);
  });

  it("cscFromTriplets rejects out-of-bounds indices", () => {
    expect(() => cscFromTriplets(2, 2, [[3, 0, 1.0]])).toThrow();
    expect(() => cscFromTriplets(2, 2, [[0, 3, 1.0]])).toThrow();
  });
});
