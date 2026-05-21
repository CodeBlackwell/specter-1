export type Matrix = number[][];

export function zeros(n: number, m: number): Matrix {
  const out: Matrix = [];
  for (let i = 0; i < n; i++) out.push(new Array<number>(m).fill(0));
  return out;
}

export function identity(n: number): Matrix {
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) {
    const row = out[i]!;
    row[i] = 1;
  }
  return out;
}

export function cloneMatrix(m: Matrix): Matrix {
  return m.map((row) => row.slice());
}

export type EigenResult = {
  values: number[];
  vectors: Matrix;
};

export function eigSymmetric(input: Matrix, maxSweeps = 50, tol = 1e-12): EigenResult {
  const n = input.length;
  const A = cloneMatrix(input);
  const V = identity(n);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        off += A[i]![j]! * A[i]![j]!;
      }
    }
    if (off < tol) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-18) continue;
        const app = A[p]![p]!;
        const aqq = A[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        const t =
          theta >= 0
            ? 1 / (theta + Math.sqrt(1 + theta * theta))
            : 1 / (theta - Math.sqrt(1 + theta * theta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        A[p]![p] = app - t * apq;
        A[q]![q] = aqq + t * apq;
        A[p]![q] = 0;
        A[q]![p] = 0;
        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const aip = A[i]![p]!;
            const aiq = A[i]![q]!;
            A[i]![p] = c * aip - s * aiq;
            A[p]![i] = A[i]![p]!;
            A[i]![q] = s * aip + c * aiq;
            A[q]![i] = A[i]![q]!;
          }
          const vip = V[i]![p]!;
          const viq = V[i]![q]!;
          V[i]![p] = c * vip - s * viq;
          V[i]![q] = s * vip + c * viq;
        }
      }
    }
  }
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(A[i]![i]!);
  return { values, vectors: V };
}
