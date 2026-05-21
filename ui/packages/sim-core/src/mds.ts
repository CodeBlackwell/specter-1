import { eigSymmetric, zeros, type Matrix } from "./linalg";

function symmetrize(D: Matrix): Matrix {
  const n = D.length;
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) {
    const rowI = D[i]!;
    const rowOut = out[i]!;
    for (let j = 0; j < n; j++) {
      rowOut[j] = (rowI[j]! + D[j]![i]!) / 2;
    }
  }
  return out;
}

function doubleCenter(D: Matrix): Matrix {
  const n = D.length;
  const Dsym = symmetrize(D);
  const D2 = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = Dsym[i]![j]!;
      D2[i]![j] = v * v;
    }
  }
  const rowMean = new Array<number>(n).fill(0);
  const colMean = new Array<number>(n).fill(0);
  let totalMean = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = D2[i]![j]!;
      rowMean[i]! += v;
      colMean[j]! += v;
      totalMean += v;
    }
  }
  for (let i = 0; i < n; i++) {
    rowMean[i]! /= n;
    colMean[i]! /= n;
  }
  totalMean /= n * n;
  const B = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      B[i]![j] = -0.5 * (D2[i]![j]! - rowMean[i]! - colMean[j]! + totalMean);
    }
  }
  return B;
}

export function embeddabilityScore(D: Matrix): number {
  if (D.length < 3) return 0.0;
  const B = doubleCenter(D);
  const { values } = eigSymmetric(B);
  const sorted = values.slice().sort((a, b) => Math.abs(b) - Math.abs(a));
  const topTwo = Math.abs(sorted[0]!) + Math.abs(sorted[1]!) + 1e-12;
  let non2d = 0;
  for (let k = 2; k < sorted.length; k++) non2d += Math.abs(sorted[k]!);
  return non2d / topTwo;
}

export function perPointResiduals(D: Matrix): number[] {
  const n = D.length;
  if (n < 3) return new Array<number>(n).fill(0);
  const B = doubleCenter(D);
  const { values, vectors } = eigSymmetric(B);
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const residuals = new Array<number>(n).fill(0);
  for (let rank = 2; rank < n; rank++) {
    const idx = order[rank]!.i;
    const lambda = Math.abs(order[rank]!.v);
    for (let i = 0; i < n; i++) {
      const comp = vectors[i]![idx]!;
      residuals[i]! += comp * comp * lambda;
    }
  }
  return residuals;
}

export function embed2D(D: Matrix): {
  points: Array<[number, number]>;
  eigenvalues: [number, number];
  embeddability: number;
} {
  const n = D.length;
  if (n < 2) return { points: [], eigenvalues: [0, 0], embeddability: 0 };
  const B = doubleCenter(D);
  const { values, vectors } = eigSymmetric(B);
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const top1 = order[0]!;
  const top2 = order[1] ?? top1;
  const lambda1 = Math.max(0, top1.v);
  const lambda2 = Math.max(0, top2.v);
  const s1 = Math.sqrt(lambda1);
  const s2 = Math.sqrt(lambda2);
  const points: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    points.push([vectors[i]![top1.i]! * s1, vectors[i]![top2.i]! * s2]);
  }
  const sortedAbs = order.map((o) => Math.abs(o.v));
  const topTwoSum = sortedAbs[0]! + (sortedAbs[1] ?? 0) + 1e-12;
  let nonPlanar = 0;
  for (let k = 2; k < sortedAbs.length; k++) nonPlanar += sortedAbs[k]!;
  const embeddability = nonPlanar / topTwoSum;
  return { points, eigenvalues: [lambda1, lambda2], embeddability };
}

export function lyingEdgeResiduals(D: Matrix): Matrix {
  const n = D.length;
  if (n < 3) return zeros(n, n);
  const Dsym = symmetrize(D);
  const residuals = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      let acc = 0;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const excess = Dsym[i]![j]! - Dsym[i]![k]! - Dsym[j]![k]!;
        if (excess > 0) acc += excess;
      }
      residuals[i]![j] = acc;
    }
  }
  return residuals;
}
