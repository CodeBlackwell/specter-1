/**
 * Polish B — sparse Cholesky on CSC matrices. Validates the factorization
 * matches the dense Cholesky reference (already shipped in poseGraph.ts)
 * on representative SPD pose-graph Hessians.
 */

import { describe, it, expect } from "vitest";
import {
  cscBackwardSolve,
  cscCholesky,
  cscCholeskySolve,
  cscForwardSolve,
  cscMatVec,
  cscToDense,
  cscTranspose,
  denseToCsc,
} from "../src/sparseLinalg";
import { choleskySolve } from "../src/poseGraph";

const close = (a: number, b: number, tol = 1.0e-10) => Math.abs(a - b) <= tol;

const SPD_3x3 = [
  [4, 1, 0],
  [1, 5, 2],
  [0, 2, 6],
];

const SPD_TRIDIAG_5x5 = [
  [4, -1, 0, 0, 0],
  [-1, 4, -1, 0, 0],
  [0, -1, 4, -1, 0],
  [0, 0, -1, 4, -1],
  [0, 0, 0, -1, 4],
];

// Representative of a 4-node pose chain (12-DOF Hessian with cross-block coupling).
function makeArrowSPD(n: number, off: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) m.push(new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) m[i]![i] = 5 + i * 0.5;
  for (let i = 0; i < n - 1; i++) {
    m[i]![i + 1] = off;
    m[i + 1]![i] = off;
  }
  return m;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const m = b[0]!.length;
  const k = b.length;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push(new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let kk = 0; kk < k; kk++) s += a[i]![kk]! * b[kk]![j]!;
      out[i]![j] = s;
    }
  }
  return out;
}

describe("Polish B — cscCholesky factorization", () => {
  it("L · Lᵀ recovers A for SPD 3×3", () => {
    const a = denseToCsc(SPD_3x3);
    const l = cscCholesky(a)!;
    expect(l).not.toBeNull();
    const lDense = cscToDense(l);
    const lT = cscToDense(cscTranspose(l));
    const reconstructed = matMul(lDense, lT);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(close(reconstructed[i]![j]!, SPD_3x3[i]![j]!, 1.0e-10)).toBe(true);
      }
    }
  });

  it("L is lower triangular (upper-tri entries are zero)", () => {
    const l = cscCholesky(denseToCsc(SPD_TRIDIAG_5x5))!;
    const dense = cscToDense(l);
    for (let i = 0; i < 5; i++) {
      for (let j = i + 1; j < 5; j++) {
        expect(dense[i]![j]!).toBe(0);
      }
    }
  });

  it("returns null on non-SPD input", () => {
    const indefinite = [
      [1, 0],
      [0, -1],
    ];
    expect(cscCholesky(denseToCsc(indefinite))).toBeNull();
  });
});

describe("Polish B — cscForwardSolve / cscBackwardSolve", () => {
  it("forward solve: L y = b → y satisfies the system", () => {
    const a = denseToCsc(SPD_3x3);
    const l = cscCholesky(a)!;
    const b = [7, 13, 14];
    const y = cscForwardSolve(l, b);
    // Verify: cscMatVec(L, y) == b.
    const reconstructed = cscMatVec(l, y);
    for (let i = 0; i < 3; i++) expect(close(reconstructed[i]!, b[i]!, 1.0e-10)).toBe(true);
  });

  it("backward solve: Lᵀ x = y → x satisfies the system", () => {
    const a = denseToCsc(SPD_3x3);
    const l = cscCholesky(a)!;
    const y = [2, 3, 4];
    const x = cscBackwardSolve(l, y);
    // Verify: Lᵀ x = cscMatVec(transpose(L), x) == y.
    const lt = cscTranspose(l);
    const reconstructed = cscMatVec(lt, x);
    for (let i = 0; i < 3; i++) expect(close(reconstructed[i]!, y[i]!, 1.0e-10)).toBe(true);
  });
});

describe("Polish B — cscCholeskySolve matches dense reference", () => {
  it.each([
    ["SPD_3x3", SPD_3x3, [7, 13, 14]],
    ["SPD_TRIDIAG_5x5", SPD_TRIDIAG_5x5, [1, 2, 3, 4, 5]],
    ["arrow_12x12", makeArrowSPD(12, -0.7), Array.from({ length: 12 }, (_, i) => i + 1.0)],
  ] as Array<[string, number[][], number[]]>)(
    "%s — sparse solve matches dense Cholesky solve to 10 decimals",
    (_label, dense, b) => {
      const a = denseToCsc(dense);
      const sparse = cscCholeskySolve(a, b);
      const denseRef = choleskySolve(dense, b);
      expect(sparse).not.toBeNull();
      expect(denseRef).not.toBeNull();
      for (let i = 0; i < b.length; i++) {
        expect(close(sparse![i]!, denseRef![i]!, 1.0e-10)).toBe(true);
      }
    },
  );

  it("returns null on non-SPD input", () => {
    expect(cscCholeskySolve(denseToCsc([[1, 0], [0, -1]]), [1, 1])).toBeNull();
  });
});
