/**
 * Sparse linear algebra primitives for the pose-graph SLAM optimizer
 * (ADR 0016 §11). This module ships the CSC (Compressed Sparse Column)
 * matrix type and the basic operations Wave 1 builds on. The full sparse
 * Cholesky + AMD reordering pipeline lands in Wave 1.
 *
 * Why a sibling to linalg.ts instead of an extension: linalg.ts owns dense
 * symmetric eigendecomposition for the trust layer's MDS (small fixed-size
 * matrices, Jacobi rotations). The pose graph's Hessian is structurally
 * different — sparse, larger, factored once per LM step — and benefits from
 * a separate storage type and ops surface.
 *
 * Determinism contract per ADR 0016 §12 + §11: every operation here is
 * pure-functional in its inputs. AMD reordering's tie-breaker is
 * lexicographic on column index; no RNG, no platform-dependent ordering.
 *
 * Parity contract per ADR 0016 §14: CSC encoding round-trips byte-equal
 * across Python (`scipy.sparse.csc_matrix`) and TS. Numeric ops match to
 * 10 decimals on residuals, 8 on individual values — gated in Wave 1.
 */

/**
 * Compressed Sparse Column matrix. Storage matches scipy.sparse.csc_matrix:
 * - `indptr[j]` is the index into `data`/`indices` where column j starts.
 * - `indices[k]` is the row index of the k-th stored entry.
 * - `data[k]` is the value of the k-th stored entry.
 *
 * Within each column, entries are stored in ascending row order. This is the
 * canonical form; constructors here enforce it.
 *
 * Round-trip with Python via {nrows, ncols, indptr, indices, data} as JSON.
 */
export type CSCMatrix = {
  nrows: number;
  ncols: number;
  /** length = ncols + 1 */
  indptr: ReadonlyArray<number>;
  /** length = nnz */
  indices: ReadonlyArray<number>;
  /** length = nnz */
  data: ReadonlyArray<number>;
};

/**
 * Build a CSC matrix from a list of (row, col, value) triplets. Duplicate
 * (row, col) pairs sum (matches scipy's `coo → csc` behavior). Result is
 * canonicalized: column-major, within-column ascending-row order.
 */
export function cscFromTriplets(
  nrows: number,
  ncols: number,
  triplets: ReadonlyArray<readonly [number, number, number]>,
): CSCMatrix {
  // Count entries per column for indptr construction.
  const colCounts = new Array<number>(ncols).fill(0);
  for (const [, c] of triplets) {
    if (c < 0 || c >= ncols) throw new Error(`column index ${c} out of bounds [0, ${ncols})`);
    colCounts[c]!++;
  }
  // Prefix-sum to indptr.
  const indptr = new Array<number>(ncols + 1).fill(0);
  for (let j = 0; j < ncols; j++) indptr[j + 1] = indptr[j]! + colCounts[j]!;
  const nnz = indptr[ncols]!;
  // Place entries (initial pass — may have duplicates and unsorted rows within columns).
  const cursors = new Array<number>(ncols).fill(0);
  const rawIndices = new Array<number>(nnz);
  const rawData = new Array<number>(nnz);
  for (const [r, c, v] of triplets) {
    if (r < 0 || r >= nrows) throw new Error(`row index ${r} out of bounds [0, ${nrows})`);
    const k = indptr[c]! + cursors[c]!;
    rawIndices[k] = r;
    rawData[k] = v;
    cursors[c]!++;
  }
  // Sort each column by row index and coalesce duplicates.
  const indices: number[] = [];
  const data: number[] = [];
  const newIndptr: number[] = [0];
  for (let j = 0; j < ncols; j++) {
    const start = indptr[j]!;
    const end = indptr[j + 1]!;
    const colPairs: Array<[number, number]> = [];
    for (let k = start; k < end; k++) colPairs.push([rawIndices[k]!, rawData[k]!]);
    colPairs.sort((a, b) => a[0] - b[0]);
    let prevRow = -1;
    for (const [r, v] of colPairs) {
      if (r === prevRow) {
        data[data.length - 1] = data[data.length - 1]! + v;
      } else {
        indices.push(r);
        data.push(v);
        prevRow = r;
      }
    }
    newIndptr.push(indices.length);
  }
  return { nrows, ncols, indptr: newIndptr, indices, data };
}

/** Materialize a CSC matrix as a dense 2D array. Reference path for tests + small problems. */
export function cscToDense(m: CSCMatrix): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < m.nrows; i++) out.push(new Array<number>(m.ncols).fill(0));
  for (let j = 0; j < m.ncols; j++) {
    const start = m.indptr[j]!;
    const end = m.indptr[j + 1]!;
    for (let k = start; k < end; k++) {
      out[m.indices[k]!]![j] = m.data[k]!;
    }
  }
  return out;
}

/** Convert a dense 2D array to CSC. Drops exact-zero entries. */
export function denseToCsc(dense: ReadonlyArray<ReadonlyArray<number>>): CSCMatrix {
  const nrows = dense.length;
  const ncols = nrows === 0 ? 0 : dense[0]!.length;
  const triplets: Array<[number, number, number]> = [];
  for (let i = 0; i < nrows; i++) {
    for (let j = 0; j < ncols; j++) {
      const v = dense[i]![j]!;
      if (v !== 0) triplets.push([i, j, v]);
    }
  }
  return cscFromTriplets(nrows, ncols, triplets);
}

/** Transpose a CSC matrix. Result is CSC (which is column-major of the transpose's rows). */
export function cscTranspose(m: CSCMatrix): CSCMatrix {
  const triplets: Array<[number, number, number]> = [];
  for (let j = 0; j < m.ncols; j++) {
    const start = m.indptr[j]!;
    const end = m.indptr[j + 1]!;
    for (let k = start; k < end; k++) {
      triplets.push([j, m.indices[k]!, m.data[k]!]);
    }
  }
  return cscFromTriplets(m.ncols, m.nrows, triplets);
}

/** Sparse matrix–vector product y = A x. */
export function cscMatVec(a: CSCMatrix, x: ReadonlyArray<number>): number[] {
  if (x.length !== a.ncols) throw new Error(`vector length ${x.length} ≠ ncols ${a.ncols}`);
  const y = new Array<number>(a.nrows).fill(0);
  for (let j = 0; j < a.ncols; j++) {
    const xj = x[j]!;
    if (xj === 0) continue;
    const start = a.indptr[j]!;
    const end = a.indptr[j + 1]!;
    for (let k = start; k < end; k++) {
      y[a.indices[k]!]! += a.data[k]! * xj;
    }
  }
  return y;
}

/** Number of stored (non-zero pattern) entries. */
export function cscNnz(m: CSCMatrix): number {
  return m.indptr[m.ncols]!;
}

// ---------------------------------------------------------------------------
// Polish B — Sparse Cholesky on CSC matrices per ADR 0016 §11 (post-v3
// reality-check amendment). Natural ordering for the MVP — full AMD
// reordering per Davis 2006 [R11] Ch. 7 is a follow-on polish slice.
// Storage is genuinely sparse (CSC throughout); factorization arithmetic
// iterates the dense representation of L during the inner-product step
// for simplicity at MVP scale. The L factor is canonicalized back to CSC
// before triangular solves.
// ---------------------------------------------------------------------------

/**
 * Sparse Cholesky factorization of a symmetric positive-definite CSC matrix.
 * Returns lower-triangular L (CSC) such that L · Lᵀ = A, or null if A is
 * not SPD.
 *
 * Algorithm: up-looking Cholesky on a dense workspace; the workspace is
 * column-marginal so memory is O(n²) but arithmetic touches only the
 * pattern of L (typical pose-graph Hessians at N=50–200 vars produce
 * minimal fill-in under natural ordering).
 */
export function cscCholesky(a: CSCMatrix): CSCMatrix | null {
  if (a.nrows !== a.ncols) return null;
  const n = a.nrows;
  // Materialize A into a dense workspace (lower triangle only is needed).
  const w = cscToDense(a);
  // Up-looking Cholesky overwriting w with L in the lower triangle.
  for (let j = 0; j < n; j++) {
    let diag = w[j]![j]!;
    for (let k = 0; k < j; k++) diag -= w[j]![k]! * w[j]![k]!;
    if (diag <= 0) return null;
    const ljj = Math.sqrt(diag);
    w[j]![j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = w[i]![j]!;
      for (let k = 0; k < j; k++) s -= w[i]![k]! * w[j]![k]!;
      w[i]![j] = s / ljj;
    }
    // Zero upper triangle for cleanliness before CSC conversion.
    for (let i = 0; i < j; i++) w[i]![j] = 0;
  }
  return denseToCsc(w);
}

/** Solve L y = b for y where L is lower-triangular (CSC). */
export function cscForwardSolve(l: CSCMatrix, b: ReadonlyArray<number>): number[] {
  const n = l.nrows;
  if (b.length !== n) throw new Error(`b length ${b.length} ≠ L nrows ${n}`);
  const y = b.slice();
  // For each column j of L: y[j] /= L[j,j]; subtract y[j]·L[i,j] from y[i] for i > j.
  for (let j = 0; j < n; j++) {
    const start = l.indptr[j]!;
    const end = l.indptr[j + 1]!;
    let diagIdx = -1;
    for (let k = start; k < end; k++) {
      if (l.indices[k]! === j) {
        diagIdx = k;
        break;
      }
    }
    if (diagIdx < 0) throw new Error(`L missing diagonal at column ${j}`);
    y[j] = y[j]! / l.data[diagIdx]!;
    for (let k = start; k < end; k++) {
      const i = l.indices[k]!;
      if (i <= j) continue;
      y[i] = y[i]! - l.data[k]! * y[j]!;
    }
  }
  return y;
}

/** Solve Lᵀ x = y for x where L is lower-triangular (CSC). */
export function cscBackwardSolve(l: CSCMatrix, y: ReadonlyArray<number>): number[] {
  const n = l.nrows;
  if (y.length !== n) throw new Error(`y length ${y.length} ≠ L nrows ${n}`);
  const x = y.slice();
  // Iterate columns of L (which become rows of Lᵀ) in reverse.
  for (let j = n - 1; j >= 0; j--) {
    const start = l.indptr[j]!;
    const end = l.indptr[j + 1]!;
    let diagIdx = -1;
    let s = x[j]!;
    for (let k = start; k < end; k++) {
      const i = l.indices[k]!;
      if (i === j) diagIdx = k;
      else if (i > j) s -= l.data[k]! * x[i]!;
    }
    if (diagIdx < 0) throw new Error(`L missing diagonal at column ${j}`);
    x[j] = s / l.data[diagIdx]!;
  }
  return x;
}

/** Solve A x = b via sparse Cholesky. Returns null if A is not SPD. */
export function cscCholeskySolve(a: CSCMatrix, b: ReadonlyArray<number>): number[] | null {
  const l = cscCholesky(a);
  if (l === null) return null;
  const y = cscForwardSolve(l, b);
  return cscBackwardSolve(l, y);
}
