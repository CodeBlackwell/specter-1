import { cscCholeskySolve, denseToCsc } from "./sparseLinalg";

/**
 * Pose-graph SLAM per ADR 0016. SE(2) primitives land in Wave 1.1; factors,
 * LM, GNC, and sparse Cholesky follow in Waves 1.2 → 1.5.
 *
 * SE(2) conventions (locked by ADR 0016 §6):
 * - Pose `T ∈ SE(2)` is the tuple `(x, y, θ)`; θ in radians; no auto-wrap.
 * - Group operation `T1 ⊕ T2`: 2D rigid-body composition.
 * - Right perturbation: update step `T ← T ⊕ exp(δ̂)`; δ is the body-frame
 *   tangent increment.
 * - exp / log / right-Jacobian: Barfoot §7.3 + Solà arXiv:1812.01537 §4.
 *
 * Determinism contract (ADR 0016 §12): pure functional, no globals.
 *
 * Parity contract (ADR 0016 §14): every primitive here matches the Python
 * counterpart in `src/specter/slam/pose_graph.py` to 10 decimals on the
 * parity fixture. SE(2) is the foundation — if it diverges, every
 * downstream piece (factors, optimizer, sparse solver) diverges.
 */

export type Pose2 = {
  x: number;
  y: number;
  theta: number;
};

export const POSE2_IDENTITY: Pose2 = { x: 0, y: 0, theta: 0 };

/** Below this |θ|, use Taylor expansions of V(θ) and V⁻¹(θ) to avoid div-by-zero. */
export const SE2_SMALL_ANGLE_TAU = 1.0e-5;

/**
 * Wrap θ to (-π, π]. Used by log() so the returned tangent vector is canonical.
 * Snaps anything within 1e-12 of -π up to +π so the canonical (-π, π]
 * convention holds across floating-point roundoff (atan2 can return values
 * marginally below -π for inputs like -3π).
 */
export function wrapAngle(theta: number): number {
  const wrapped = Math.atan2(Math.sin(theta), Math.cos(theta));
  return wrapped <= -Math.PI + 1.0e-12 ? Math.PI : wrapped;
}

/** T_a ⊕ T_b: place T_b's body frame in T_a's world frame. */
export function compose(a: Pose2, b: Pose2): Pose2 {
  const cosA = Math.cos(a.theta);
  const sinA = Math.sin(a.theta);
  return {
    x: a.x + cosA * b.x - sinA * b.y,
    y: a.y + sinA * b.x + cosA * b.y,
    theta: a.theta + b.theta,
  };
}

/** T⁻¹: (R, t)⁻¹ = (Rᵀ, -Rᵀ t). */
export function inverse(a: Pose2): Pose2 {
  const cosA = Math.cos(a.theta);
  const sinA = Math.sin(a.theta);
  return {
    x: -cosA * a.x - sinA * a.y,
    y: sinA * a.x - cosA * a.y,
    theta: -a.theta,
  };
}

/** Relative pose of b in a's frame: T_ab = T_a⁻¹ ⊕ T_b. */
export function between(a: Pose2, b: Pose2): Pose2 {
  return compose(inverse(a), b);
}

/**
 * Exponential map se(2) → SE(2). ξ = (ρ_x, ρ_y, θ).
 *
 * For θ ≠ 0: exp(ξ) = (V(θ) ρ, θ) where
 *   V(θ) = (1/θ) [[sin θ, -(1 - cos θ)], [1 - cos θ, sin θ]]
 * For |θ| < SE2_SMALL_ANGLE_TAU: V ≈ I + (θ/2) skew(1).
 */
export function expSE2(xi: readonly [number, number, number]): Pose2 {
  const [rhoX, rhoY, theta] = xi;
  if (Math.abs(theta) < SE2_SMALL_ANGLE_TAU) {
    const halfTheta = 0.5 * theta;
    return {
      x: rhoX - halfTheta * rhoY,
      y: halfTheta * rhoX + rhoY,
      theta,
    };
  }
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const a = sinT / theta;
  const b = (1.0 - cosT) / theta;
  return {
    x: a * rhoX - b * rhoY,
    y: b * rhoX + a * rhoY,
    theta,
  };
}

/**
 * Logarithm map SE(2) → se(2). Returns ξ = (ρ_x, ρ_y, θ) such that
 * `expSE2(logSE2(T))` reconstructs T to machine precision (within wrap on θ).
 *
 * For θ ≠ 0: ρ = V⁻¹(θ) · t where
 *   V⁻¹(θ) = [[(θ/2) cot(θ/2), θ/2], [-θ/2, (θ/2) cot(θ/2)]]
 * For |θ| < SE2_SMALL_ANGLE_TAU: V⁻¹ ≈ I - (θ/2) skew(1).
 */
export function logSE2(t: Pose2): [number, number, number] {
  const theta = wrapAngle(t.theta);
  if (Math.abs(theta) < SE2_SMALL_ANGLE_TAU) {
    const halfTheta = 0.5 * theta;
    return [t.x + halfTheta * t.y, -halfTheta * t.x + t.y, theta];
  }
  const halfTheta = 0.5 * theta;
  const halfCot = halfTheta / Math.tan(halfTheta);
  return [halfCot * t.x + halfTheta * t.y, -halfTheta * t.x + halfCot * t.y, theta];
}

/**
 * Right Jacobian J_r(ξ) of the SE(2) exponential map per Solà arXiv:1812.01537
 * §6. Validated against numeric central-difference of log(exp(ξ) ⊕ exp(δ))
 * (see tests/poseGraph.parity.test.ts).
 *
 * Closed form:
 *   J_r(ξ) = [[V(-θ),  R(-θ) · (dV(θ)/dθ) · ρ],
 *              [0_{1×2}, 1                       ]]
 * with V(-θ) = (1/θ) [[sin θ, 1-cos θ], [-(1-cos θ), sin θ]] and the Q column
 * capturing translation-rotation coupling. Bottom row is (0, 0, 1) because
 * SO(2) is 1-D and its right Jacobian on θ is identically 1.
 */
export function rightJacobianSE2(
  xi: readonly [number, number, number],
): [[number, number, number], [number, number, number], [number, number, number]] {
  const [rhoX, rhoY, theta] = xi;
  if (Math.abs(theta) < SE2_SMALL_ANGLE_TAU) {
    // Small-angle limit (Taylor): q_x → -ρ_y/2, q_y → ρ_x/2.
    return [
      [1.0, 0.5 * theta, -0.5 * rhoY],
      [-0.5 * theta, 1.0, 0.5 * rhoX],
      [0.0, 0.0, 1.0],
    ];
  }
  const sinT = Math.sin(theta);
  const cosT = Math.cos(theta);
  const vNeg00 = sinT / theta;
  const vNeg01 = (1.0 - cosT) / theta;
  const vNeg10 = -vNeg01;
  const vNeg11 = vNeg00;
  const invThetaSq = 1.0 / (theta * theta);
  // dV/dθ · ρ
  const dvrX =
    invThetaSq *
    ((theta * cosT - sinT) * rhoX + -(theta * sinT - (1.0 - cosT)) * rhoY);
  const dvrY =
    invThetaSq *
    ((theta * sinT - (1.0 - cosT)) * rhoX + (theta * cosT - sinT) * rhoY);
  // Q = R(-θ) · (dV/dθ · ρ)
  const qX = cosT * dvrX + sinT * dvrY;
  const qY = -sinT * dvrX + cosT * dvrY;
  return [
    [vNeg00, vNeg01, qX],
    [vNeg10, vNeg11, qY],
    [0.0, 0.0, 1.0],
  ];
}

// ---------------------------------------------------------------------------
// Wave 1.2 — Factors + sensor noise → information matrix per ADR 0016 §5.
// ---------------------------------------------------------------------------

/** ADR 0005 / 0016 §5 sensor noise defaults. */
export const DEFAULT_BEACON_RANGE_SIGMA_M = 0.10;
export const DEFAULT_BEACON_RANGE_SCALE_M = 10.0;
export const DEFAULT_BEACON_BEARING_SIGMA_RAD = (5.0 * Math.PI) / 180.0;
export const NLOS_INFLATE = 3.0;
export const DEFAULT_IMU_ACCEL_BIAS_SIGMA = 0.005;
export const DEFAULT_IMU_GYRO_BIAS_SIGMA = 0.0005;

export type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];
export type Mat2 = [[number, number], [number, number]];

/**
 * Information matrix Ω = diag(1/σ_x², 1/σ_y², 1/σ_θ²) for an odometry factor
 * with **correct compounding laws** per ADR 0016 §5 + Forster 2015 §4:
 * σ_xy = σ_a · Δt^1.5 / √3 (double-integrated bias RW), σ_θ = σ_g · √Δt.
 */
export function odometryInformation(
  dtSeconds: number,
  sigmaABias: number = DEFAULT_IMU_ACCEL_BIAS_SIGMA,
  sigmaGBias: number = DEFAULT_IMU_GYRO_BIAS_SIGMA,
): Mat3 {
  if (dtSeconds <= 0) throw new Error(`dtSeconds must be positive, got ${dtSeconds}`);
  const sigmaXy = (sigmaABias * Math.pow(dtSeconds, 1.5)) / Math.sqrt(3.0);
  const sigmaTh = sigmaGBias * Math.sqrt(dtSeconds);
  const invVarXy = 1.0 / (sigmaXy * sigmaXy);
  const invVarTh = 1.0 / (sigmaTh * sigmaTh);
  return [
    [invVarXy, 0, 0],
    [0, invVarXy, 0],
    [0, 0, invVarTh],
  ];
}

/**
 * Information matrix Ω = diag(1/σ_r², 1/σ_b²) for a landmark factor;
 * σ_r is range-dependent per ADR 0005, inflated by NLOS_INFLATE if NLOS.
 */
export function landmarkInformation(
  rangeM: number,
  nlos: boolean = false,
  sigmaBeaconRange: number = DEFAULT_BEACON_RANGE_SIGMA_M,
  rangeScale: number = DEFAULT_BEACON_RANGE_SCALE_M,
  sigmaBearingRad: number = DEFAULT_BEACON_BEARING_SIGMA_RAD,
): Mat2 {
  let sigmaR = sigmaBeaconRange * (1.0 + rangeM / rangeScale);
  if (nlos) sigmaR *= NLOS_INFLATE;
  const invVarR = 1.0 / (sigmaR * sigmaR);
  const invVarB = 1.0 / (sigmaBearingRad * sigmaBearingRad);
  return [
    [invVarR, 0],
    [0, invVarB],
  ];
}

export type OdometryFactor = {
  kind: "odometry";
  fromId: string;
  toId: string;
  measurement: Pose2;
  info: Mat3;
  sourceId: string;
};

export type LandmarkFactor = {
  kind: "landmark";
  poseId: string;
  landmarkId: string;
  rangeM: number;
  bearingRad: number;
  info: Mat2;
  sourceId: string;
  nlos: boolean;
};

export type Factor = OdometryFactor | LandmarkFactor;

export function odometryResidual(
  factor: OdometryFactor,
  poses: Map<string, Pose2>,
): [number, number, number] {
  const tFrom = poses.get(factor.fromId);
  const tTo = poses.get(factor.toId);
  if (!tFrom || !tTo) throw new Error(`missing pose variable for factor ${factor.fromId}→${factor.toId}`);
  const predicted = between(tFrom, tTo);
  const delta = compose(inverse(factor.measurement), predicted);
  return logSE2(delta);
}

export function landmarkResidual(
  factor: LandmarkFactor,
  poses: Map<string, Pose2>,
  landmarks: Map<string, [number, number]>,
): [number, number] {
  const t = poses.get(factor.poseId);
  const l = landmarks.get(factor.landmarkId);
  if (!t || !l) throw new Error(`missing variable for factor ${factor.poseId}→${factor.landmarkId}`);
  const dx = l[0] - t.x;
  const dy = l[1] - t.y;
  const cosT = Math.cos(t.theta);
  const sinT = Math.sin(t.theta);
  const bodyX = cosT * dx + sinT * dy;
  const bodyY = -sinT * dx + cosT * dy;
  const predictedRange = Math.hypot(bodyX, bodyY);
  const predictedBearing = Math.atan2(bodyY, bodyX);
  return [factor.rangeM - predictedRange, wrapAngle(factor.bearingRad - predictedBearing)];
}

// ---------------------------------------------------------------------------
// Wave 1.3 — Levenberg-Marquardt with adaptive damping per ADR 0016 §7.
// Inner linear solve: hand-rolled dense Cholesky (sparse + AMD lands in
// Wave 1.5; the outer LM loop is identical). Numeric central-difference
// Jacobians at ε = 1e-6 per ADR 0016 §7 mirror the Python implementation.
// ---------------------------------------------------------------------------

export const JAC_EPS = 1.0e-6;
export const LM_INITIAL_LAMBDA_SCALE = 1.0e-4;
export const LM_MAX_ITERATIONS = 10;
export const LM_CONVERGE_DELTA = 1.0e-6;
export const LM_CONVERGE_COST_RATIO = 1.0e-4;
export const LM_LAMBDA_UP = 10.0;
export const LM_LAMBDA_DOWN = 10.0;
export const LM_LAMBDA_MAX = 1.0e8;

// Wave 4 — reputation prior floor (ADR 0018). Same value as Python.
export const REPUTATION_FLOOR = 0.01;

// ADR 0020 — chi-square thresholds for 2-DOF range/bearing residuals.
// F(1.386, 2) = 0.50; F(5.991, 2) = 0.95. Same values as Python.
export const SLAM_CHISQ_INLIER = 1.386;
export const SLAM_CHISQ_OUTLIER = 5.991;

// ADR 0022 — singleton-uniqueness penalty + stale-singleton fade. Same
// values as Python: 0.3× info on single-reporter landmarks; full cap until
// T_CORROBORATE=200 ticks past insertion; linear fade over T_FADE=200 to 0.
export const SINGLETON_INFO_SCALE = 0.3;
export const T_CORROBORATE = 200;
export const T_FADE = 200;

/** ADR 0022 §1 — per-factor insertion record. Stamped when add*Factor is
 * called with a tick. Inert when singleton mechanisms are disabled. */
export interface Provenance {
  reporterId: string;
  insertionTick: number;
  reputationAtInsertion: number;
}

// Wave 1.4 — GNC (Graduated Non-Convexity) Geman-McClure per Yang 2020 §IV.A.
export const GNC_C_BAR = 1.0;
export const GNC_MU_DECAY = 1.4;
export const GNC_MU_FLOOR = 1.0e-6;
export const GNC_MAX_OUTER_ITER = 32;
export const GNC_WEIGHT_CHANGE_TAU = 1.0e-4;

/** In-place dense Cholesky factorization: A → L (lower triangular) s.t. L Lᵀ = A.
 *  A is overwritten by L. Returns false if matrix is not positive-definite. */
function choleskyInPlace(a: number[][]): boolean {
  const n = a.length;
  for (let j = 0; j < n; j++) {
    let sum = a[j]![j]!;
    for (let k = 0; k < j; k++) sum -= a[j]![k]! * a[j]![k]!;
    if (sum <= 0) return false;
    a[j]![j] = Math.sqrt(sum);
    const ljj = a[j]![j]!;
    for (let i = j + 1; i < n; i++) {
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= a[i]![k]! * a[j]![k]!;
      a[i]![j] = s / ljj;
    }
    // Zero upper triangle for cleanliness.
    for (let i = 0; i < j; i++) a[i]![j] = 0;
  }
  return true;
}

/** Solve L y = b for y, given lower-triangular L. */
function forwardSolve(l: number[][], b: number[]): number[] {
  const n = l.length;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[i]![k]! * y[k]!;
    y[i] = s / l[i]![i]!;
  }
  return y;
}

/** Solve Lᵀ x = y for x, given lower-triangular L. */
function backwardSolve(l: number[][], y: number[]): number[] {
  const n = l.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k]![i]! * x[k]!;
    x[i] = s / l[i]![i]!;
  }
  return x;
}

/** Solve A x = b via dense Cholesky (A must be SPD). Returns null on failure. */
export function choleskySolve(a: number[][], b: number[]): number[] | null {
  const n = a.length;
  const aCopy: number[][] = a.map((row) => row.slice());
  if (!choleskyInPlace(aCopy)) return null;
  const y = forwardSolve(aCopy, b);
  return backwardSolve(aCopy, y);
}

type PoseJacobian = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
] | number[][];

function jacobianPose(
  residualFn: (t: Pose2) => readonly number[],
  t: Pose2,
  outDim: number,
  eps: number = JAC_EPS,
): PoseJacobian {
  const j: number[][] = [];
  for (let i = 0; i < outDim; i++) j.push([0, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const dp: [number, number, number] = [0, 0, 0];
    dp[k] = eps;
    const dm: [number, number, number] = [0, 0, 0];
    dm[k] = -eps;
    const rPlus = residualFn(compose(t, expSE2(dp)));
    const rMinus = residualFn(compose(t, expSE2(dm)));
    for (let i = 0; i < outDim; i++) {
      j[i]![k] = (rPlus[i]! - rMinus[i]!) / (2 * eps);
    }
  }
  return j;
}

// Analytic Jacobians per Solà arXiv:1812.01537 §10.1 (TS mirror of Python
// _analytic_jac_landmark / _analytic_jac_relative_pose). Validated against
// numeric central-difference; sign of adjoint φ-column verified.

function mat3Inverse(m: number[][]): number[][] {
  const a = m[0]!; const b = m[1]!; const c = m[2]!;
  const det =
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!)
    - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!)
    + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  const inv = 1.0 / det;
  return [
    [(b[1]! * c[2]! - b[2]! * c[1]!) * inv, (a[2]! * c[1]! - a[1]! * c[2]!) * inv, (a[1]! * b[2]! - a[2]! * b[1]!) * inv],
    [(b[2]! * c[0]! - b[0]! * c[2]!) * inv, (a[0]! * c[2]! - a[2]! * c[0]!) * inv, (a[2]! * b[0]! - a[0]! * b[2]!) * inv],
    [(b[0]! * c[1]! - b[1]! * c[0]!) * inv, (a[1]! * c[0]! - a[0]! * c[1]!) * inv, (a[0]! * b[1]! - a[1]! * b[0]!) * inv],
  ];
}

function adjointSE2(t: Pose2): number[][] {
  const c = Math.cos(t.theta);
  const s = Math.sin(t.theta);
  return [
    [c, -s, t.y],
    [s, c, -t.x],
    [0, 0, 1],
  ];
}

function jrInvSE2(xi: [number, number, number]): number[][] {
  const jr = rightJacobianSE2(xi);
  return mat3Inverse([
    [jr[0][0], jr[0][1], jr[0][2]],
    [jr[1][0], jr[1][1], jr[1][2]],
    [jr[2][0], jr[2][1], jr[2][2]],
  ]);
}

function matMul3(a: number[][], b: number[][]): number[][] {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i]![j] = a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
    }
  }
  return out;
}

function analyticJacRelativePose(
  tI: Pose2,
  tJ: Pose2,
  residual: readonly [number, number, number],
): { jI: number[][]; jJ: number[][] } {
  const e = between(tI, tJ);
  const eInv = inverse(e);
  const jrInv = jrInvSE2([residual[0], residual[1], residual[2]]);
  const adEInv = adjointSE2(eInv);
  const jJ = jrInv;
  const negJr: number[][] = jrInv.map((row) => row.map((v) => -v));
  const jI = matMul3(negJr, adEInv);
  return { jI, jJ };
}

function analyticJacLandmark(t: Pose2, lm: [number, number]): { jPose: number[][]; jLm: number[][] } {
  const dx = lm[0] - t.x;
  const dy = lm[1] - t.y;
  const cosTh = Math.cos(t.theta);
  const sinTh = Math.sin(t.theta);
  const bx = cosTh * dx + sinTh * dy;
  const by = -sinTh * dx + cosTh * dy;
  let r2 = bx * bx + by * by;
  if (r2 < 1.0e-12) r2 = 1.0e-12;
  const r = Math.sqrt(r2);
  const jPose: number[][] = [
    [bx / r, by / r, 0],
    [-by / r2, bx / r2, 1],
  ];
  const jLm: number[][] = [
    [-bx * cosTh / r + by * sinTh / r, -bx * sinTh / r - by * cosTh / r],
    [by * cosTh / r2 + bx * sinTh / r2, by * sinTh / r2 - bx * cosTh / r2],
  ];
  return { jPose, jLm };
}

function jacobianLandmark(
  residualFn: (lm: [number, number]) => readonly number[],
  lm: [number, number],
  outDim: number,
  eps: number = JAC_EPS,
): number[][] {
  const j: number[][] = [];
  for (let i = 0; i < outDim; i++) j.push([0, 0]);
  for (let k = 0; k < 2; k++) {
    const dp: [number, number] = [0, 0];
    dp[k] = eps;
    const dm: [number, number] = [0, 0];
    dm[k] = -eps;
    const rPlus = residualFn([lm[0] + dp[0], lm[1] + dp[1]]);
    const rMinus = residualFn([lm[0] + dm[0], lm[1] + dm[1]]);
    for (let i = 0; i < outDim; i++) {
      j[i]![k] = (rPlus[i]! - rMinus[i]!) / (2 * eps);
    }
  }
  return j;
}

/**
 * Pose-graph SLAM optimizer per ADR 0016. Single-agent, batch LM with
 * dense Cholesky inner solve (sparse + AMD in Wave 1.5). Pose-0 is gauge
 * anchored by direct elimination per §12. Determinism contract holds:
 * variable + factor ordering are insertion-order, no RNG.
 */
export class PoseGraphTS {
  private poseIds: string[] = [];
  private poseIdx = new Map<string, number>();
  private landmarkIds: string[] = [];
  private landmarkIdx = new Map<string, number>();
  private poses = new Map<string, Pose2>();
  private landmarks = new Map<string, [number, number]>();
  private odometryFactors: OdometryFactor[] = [];
  private landmarkFactors: LandmarkFactor[] = [];
  private anchorPoseId: string | null = null;
  private _iterationsLastRun = 0;
  private _finalCost = NaN;
  // Wave 1.4 GNC + reputation prior (Wave 4) per-factor weight on info matrix.
  private factorWeights = new Map<string, number>();
  // Frozen-at-insertion reputation per factor (ADR 0018 v1 fallback). The
  // live source path (below) takes precedence; this map is consulted only
  // for callers that explicitly opt out of the live source via
  // setReputationWeight. ADR 0020 §5 made the live path the production
  // default; ADR 0022 §4 then extended the SC switch prior γ to track
  // reputation through the same live source. Mirror of Python
  // `_reputation_weights`.
  private reputationWeights = new Map<string, number>();
  // Live reputation source per ADR 0020 (production default): callable
  // `sourceId → rep ∈ [0,1]`. Queried inside weightOf on every assembly so
  // changes between optimize() calls take effect on the next LM step.
  private reputationSource: ((sourceId: string) => number) | null = null;
  private _gncOuterItersLastRun = 0;
  // ADR 0022 — provenance + singleton machinery. All opt-in; defaults
  // preserve the existing TS sim-core parity contract.
  private provenance = new Map<string, Provenance>();
  private landmarkReporters = new Map<string, Set<string>>();
  private currentTick: number | null = null;
  private singletonCapEnabled = false;
  private singletonFadeEnabled = false;
  // Per-iteration playback hook — fires after each accepted LM step inside
  // optimize() / optimizeGNC(). Used by the SLAM demo runners to emit a
  // snapshot at every LM iteration so the workshop scrubber plays
  // continuously instead of snapping between converged stages.
  private iterationCallback: ((cost: number, iter: number, accepted: boolean) => void) | null = null;

  setIterationCallback(cb: ((cost: number, iter: number, accepted: boolean) => void) | null): void {
    this.iterationCallback = cb;
  }

  addPose(poseId: string, initial: Pose2): void {
    if (this.poseIdx.has(poseId)) throw new Error(`pose ${poseId} already added`);
    this.poseIdx.set(poseId, this.poseIds.length);
    this.poseIds.push(poseId);
    this.poses.set(poseId, { ...initial });
    if (this.anchorPoseId === null) this.anchorPoseId = poseId;
  }

  addLandmark(id: string, initial: [number, number]): void {
    if (this.landmarkIdx.has(id)) throw new Error(`landmark ${id} already added`);
    this.landmarkIdx.set(id, this.landmarkIds.length);
    this.landmarkIds.push(id);
    this.landmarks.set(id, [initial[0], initial[1]]);
  }

  addOdometryFactor(factor: OdometryFactor, opts: { tick?: number } = {}): void {
    this.odometryFactors.push(factor);
    if (opts.tick !== undefined) this.recordProvenance(factor, opts.tick);
  }

  addLandmarkFactor(factor: LandmarkFactor, opts: { tick?: number } = {}): void {
    this.landmarkFactors.push(factor);
    let reporters = this.landmarkReporters.get(factor.landmarkId);
    if (reporters === undefined) {
      reporters = new Set<string>();
      this.landmarkReporters.set(factor.landmarkId, reporters);
    }
    reporters.add(factor.sourceId);
    if (opts.tick !== undefined) this.recordProvenance(factor, opts.tick);
  }

  private freePoseIds(): string[] {
    return this.poseIds.filter((id) => id !== this.anchorPoseId);
  }

  private stateDim(): number {
    return 3 * this.freePoseIds().length + 2 * this.landmarkIds.length;
  }

  private poseSlot(poseId: string): number | null {
    if (poseId === this.anchorPoseId) return null;
    return 3 * this.freePoseIds().indexOf(poseId);
  }

  private landmarkSlot(id: string): number {
    return 3 * this.freePoseIds().length + 2 * this.landmarkIdx.get(id)!;
  }

  private factorKey(f: Factor): string {
    if (f.kind === "odometry") return `odom/${f.fromId}/${f.toId}/${f.sourceId}`;
    return `lm/${f.poseId}/${f.landmarkId}/${f.sourceId}`;
  }

  /** Public test accessor for the effective per-factor weight
   * (singleton × reputation × GNC). Mirrors Python's `_weight_of` — used
   * by ADR 0022 tests to verify the cap/fade composition without having
   * to round-trip through `optimize()`. */
  factorWeight(f: Factor): number {
    return this.weightOf(f);
  }

  private weightOf(f: Factor): number {
    const key = this.factorKey(f);
    const gnc = this.factorWeights.get(key) ?? 1.0;
    const sid = f.sourceId;
    let rep: number;
    if (this.reputationSource !== null && sid !== undefined) {
      rep = Math.max(REPUTATION_FLOOR, Math.min(1.0, this.reputationSource(sid)));
    } else {
      rep = this.reputationWeights.get(key) ?? 1.0;
    }
    return this.singletonScale(f) * rep * gnc;
  }

  /** ADR 0022 §1 — record per-factor insertion provenance. Reputation is
   * read from the same priority chain weightOf uses, so the snapshot
   * reflects what the optimizer saw at insertion. */
  private recordProvenance(f: Factor, tick: number): void {
    const key = this.factorKey(f);
    const sid = f.sourceId;
    let r0: number;
    if (this.reputationSource !== null && sid !== undefined) {
      r0 = Math.max(REPUTATION_FLOOR, Math.min(1.0, this.reputationSource(sid)));
    } else {
      r0 = this.reputationWeights.get(key) ?? 1.0;
    }
    this.provenance.set(key, {
      reporterId: sid ?? "",
      insertionTick: tick,
      reputationAtInsertion: r0,
    });
  }

  /** Return the Provenance record for `factor`. Undefined if no tick was
   * supplied on add — the substrate is opt-in by ADR 0022 §1. */
  factorProvenance(f: Factor): Provenance | undefined {
    return this.provenance.get(this.factorKey(f));
  }

  /** Set the tick the optimizer treats as "now" for the stale-singleton
   * fade (ADR 0022 §3). Deterministic — no wall-clock dependence. */
  setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  /** Enable the singleton confidence cap (ADR 0022 §2). Off by default
   * to preserve the byte-exact parity contract. */
  enableSingletonCap(enable: boolean = true): void {
    this.singletonCapEnabled = enable;
  }

  /** Enable the stale-singleton fade (ADR 0022 §3). Requires
   * setCurrentTick + per-factor provenance to do anything. */
  enableSingletonFade(enable: boolean = true): void {
    this.singletonFadeEnabled = enable;
  }

  private singletonScale(f: Factor): number {
    if (!this.singletonCapEnabled) return 1.0;
    if (f.kind !== "landmark") return 1.0;
    const reporters = this.landmarkReporters.get(f.landmarkId);
    if (reporters === undefined || reporters.size !== 1) return 1.0;
    let scale = SINGLETON_INFO_SCALE;
    if (this.singletonFadeEnabled && this.currentTick !== null) {
      const prov = this.provenance.get(this.factorKey(f));
      if (prov !== undefined) {
        const delta = this.currentTick - prov.insertionTick;
        if (delta > T_CORROBORATE) {
          const fade = Math.max(0.0, 1.0 - (delta - T_CORROBORATE) / T_FADE);
          scale *= fade;
        }
      }
    }
    return scale;
  }

  /** Set the frozen-at-insertion reputation for a single factor (ADR 0018
   * v1 fallback). The live source set via setReputationSource takes
   * precedence; this is only consulted when no live source is installed. */
  setReputationWeight(f: Factor, reputation: number): void {
    const r = Math.max(REPUTATION_FLOOR, Math.min(1.0, reputation));
    this.reputationWeights.set(this.factorKey(f), r);
  }

  /** Install a live reputation source (ADR 0020 §5; production default).
   * Pass `null` to revert to the v1 frozen-at-insertion fallback. */
  setReputationSource(source: ((sourceId: string) => number) | null): void {
    this.reputationSource = source;
  }

  /** ADR 0020 — per-source trust evidence from converged SLAM residuals.
   * Returns `{ sourceId: { alpha, beta } }` for direct consumption by
   * BetaTrustEvaluator.observe. Mirror of Python `slam_residual_evidence`.
   *
   * Per landmark factor at the current solution:
   *  - χ² = rᵀΩr using the RAW info matrix (no weights)
   *  - χ² ≤ SLAM_CHISQ_INLIER → +alpha 1.0 (corroborates honesty)
   *  - χ² ≥ SLAM_CHISQ_OUTLIER → +beta 1.0 (geometric outlier)
   *  - else → no evidence (borderline; keep evaluator quiet on noise)
   *
   * Skipped: source_id === "loop_closure" (not a peer), source_id === selfId.
   * Odometry factors are skipped entirely (self-source). */
  slamResidualEvidence(selfId?: string): Map<string, { alpha: number; beta: number }> {
    const out = new Map<string, { alpha: number; beta: number }>();
    for (const f of this.landmarkFactors) {
      const sid = f.sourceId;
      if (sid === "loop_closure" || sid === selfId) continue;
      const r = landmarkResidual(f, this.poses, this.landmarks);
      const om = f.info;
      // χ² = rᵀ Ω r for a 2-vector residual + 2×2 info.
      const chi2 =
        r[0] * (om[0][0] * r[0] + om[0][1] * r[1]) +
        r[1] * (om[1][0] * r[0] + om[1][1] * r[1]);
      let bucket = out.get(sid);
      if (!bucket) {
        bucket = { alpha: 0, beta: 0 };
        out.set(sid, bucket);
      }
      if (chi2 <= SLAM_CHISQ_INLIER) bucket.alpha += 1.0;
      else if (chi2 >= SLAM_CHISQ_OUTLIER) bucket.beta += 1.0;
    }
    return out;
  }

  totalCost(): number {
    let cost = 0;
    for (const f of this.odometryFactors) {
      const r = odometryResidual(f, this.poses);
      const w = this.weightOf(f);
      const om = f.info;
      cost +=
        w *
        (r[0] * (om[0][0] * r[0] + om[0][1] * r[1] + om[0][2] * r[2]) +
          r[1] * (om[1][0] * r[0] + om[1][1] * r[1] + om[1][2] * r[2]) +
          r[2] * (om[2][0] * r[0] + om[2][1] * r[1] + om[2][2] * r[2]));
    }
    for (const f of this.landmarkFactors) {
      const r = landmarkResidual(f, this.poses, this.landmarks);
      const w = this.weightOf(f);
      const om = f.info;
      cost +=
        w *
        (r[0] * (om[0][0] * r[0] + om[0][1] * r[1]) +
          r[1] * (om[1][0] * r[0] + om[1][1] * r[1]));
    }
    return cost;
  }

  private factorChiSq(f: Factor): number {
    // Mahalanobis χ² at base Ω (no GNC weight). Used by GNC outer loop.
    if (f.kind === "odometry") {
      const r = odometryResidual(f, this.poses);
      const om = f.info;
      return (
        r[0] * (om[0][0] * r[0] + om[0][1] * r[1] + om[0][2] * r[2]) +
        r[1] * (om[1][0] * r[0] + om[1][1] * r[1] + om[1][2] * r[2]) +
        r[2] * (om[2][0] * r[0] + om[2][1] * r[1] + om[2][2] * r[2])
      );
    }
    const r = landmarkResidual(f, this.poses, this.landmarks);
    const om = f.info;
    return (
      r[0] * (om[0][0] * r[0] + om[0][1] * r[1]) +
      r[1] * (om[1][0] * r[0] + om[1][1] * r[1])
    );
  }

  private allFactors(): Factor[] {
    return [...this.odometryFactors, ...this.landmarkFactors];
  }

  /** Run Geman-McClure GNC outer loop wrapping the inner LM. */
  optimizeGNC(): void {
    const factors = this.allFactors();
    if (factors.length === 0) {
      this.optimize();
      this._gncOuterItersLastRun = 0;
      return;
    }
    // μ₀ = 2 · max(χ²) / c̄² per Yang 2020 §IV.A; floored at 1.0 so all factors
    // start as effective inliers.
    let maxChiSq = 0;
    for (const f of factors) {
      const c = this.factorChiSq(f);
      if (c > maxChiSq) maxChiSq = c;
    }
    let mu = Math.max((2 * maxChiSq) / (GNC_C_BAR * GNC_C_BAR), 1.0);
    this.updateGncWeights(mu);
    let prevWeights = new Map(this.factorWeights);

    for (let outer = 0; outer < GNC_MAX_OUTER_ITER; outer++) {
      this.optimize();
      mu = mu / GNC_MU_DECAY;
      if (mu < GNC_MU_FLOOR) {
        this._gncOuterItersLastRun = outer + 1;
        return;
      }
      this.updateGncWeights(mu);
      let maxChange = 0;
      for (const [k, v] of this.factorWeights) {
        const c = Math.abs(v - (prevWeights.get(k) ?? 1.0));
        if (c > maxChange) maxChange = c;
      }
      if (maxChange < GNC_WEIGHT_CHANGE_TAU) {
        this.optimize();
        this._gncOuterItersLastRun = outer + 1;
        return;
      }
      prevWeights = new Map(this.factorWeights);
    }
    this._gncOuterItersLastRun = GNC_MAX_OUTER_ITER;
  }

  private updateGncWeights(mu: number): void {
    for (const f of this.allFactors()) {
      const chiSq = this.factorChiSq(f);
      const denom = mu + chiSq;
      const w = denom > 0 ? (mu / denom) ** 2 : 0;
      this.factorWeights.set(this.factorKey(f), w);
    }
  }

  gncWeights(): Map<string, number> {
    return new Map(this.factorWeights);
  }

  get gncOuterItersLastRun(): number {
    return this._gncOuterItersLastRun;
  }

  private assembleNormalEquations(): { h: number[][]; g: number[] } {
    const n = this.stateDim();
    const h: number[][] = [];
    for (let i = 0; i < n; i++) h.push(new Array<number>(n).fill(0));
    const g = new Array<number>(n).fill(0);

    for (const f of this.odometryFactors) {
      const tI = this.poses.get(f.fromId)!;
      const tJ = this.poses.get(f.toId)!;
      const w = this.weightOf(f);
      const om: number[][] = f.info.map((row) => [row[0] * w, row[1] * w, row[2] * w]);
      const r = odometryResidual(f, this.poses);
      const slotI = this.poseSlot(f.fromId);
      const slotJ = this.poseSlot(f.toId);
      const { jI: jIFull, jJ: jJFull } = analyticJacRelativePose(tI, tJ, r);
      const jI = slotI !== null ? jIFull : null;
      const jJ = slotJ !== null ? jJFull : null;
      accumulate(h, g, om, r, [
        [jI, slotI, 3],
        [jJ, slotJ, 3],
      ]);
    }

    for (const f of this.landmarkFactors) {
      const t = this.poses.get(f.poseId)!;
      const lm = this.landmarks.get(f.landmarkId)!;
      const wL = this.weightOf(f);
      const om2: number[][] = f.info.map((row) => [row[0] * wL, row[1] * wL]);
      const r = landmarkResidual(f, this.poses, this.landmarks);
      const slotP = this.poseSlot(f.poseId);
      const slotL = this.landmarkSlot(f.landmarkId);
      const { jPose: jPFull, jLm: jL } = analyticJacLandmark(t, lm);
      const jP = slotP !== null ? jPFull : null;
      accumulate(h, g, om2, r, [
        [jP, slotP, 3],
        [jL, slotL, 2],
      ]);
    }
    return { h, g };
  }

  private applyStep(delta: number[]): void {
    for (const pid of this.freePoseIds()) {
      const slot = this.poseSlot(pid)!;
      const dxi: [number, number, number] = [delta[slot]!, delta[slot + 1]!, delta[slot + 2]!];
      this.poses.set(pid, compose(this.poses.get(pid)!, expSE2(dxi)));
    }
    for (const lid of this.landmarkIds) {
      const slot = this.landmarkSlot(lid);
      const lm = this.landmarks.get(lid)!;
      this.landmarks.set(lid, [lm[0] + delta[slot]!, lm[1] + delta[slot + 1]!]);
    }
  }

  optimize(): void {
    if (this.stateDim() === 0) {
      this._iterationsLastRun = 0;
      this._finalCost = this.totalCost();
      return;
    }
    let prevCost = this.totalCost();
    const { h: h0 } = this.assembleNormalEquations();
    let maxDiag = 0;
    for (let i = 0; i < h0.length; i++) if (h0[i]![i]! > maxDiag) maxDiag = h0[i]![i]!;
    let lam = LM_INITIAL_LAMBDA_SCALE * (maxDiag > 0 ? maxDiag : 1.0);
    let lastAccepted = false;

    for (let it = 0; it < LM_MAX_ITERATIONS; it++) {
      const { h, g } = this.assembleNormalEquations();
      const n = h.length;
      const damped: number[][] = h.map((row, i) =>
        row.map((v, j) => (i === j ? v + lam : v)),
      );
      const negG = g.map((v) => -v);
      // Sparse Cholesky route per ADR 0016 §11. At MVP scale (~150 vars) the
      // cscCholesky uses a dense workspace internally — identical arithmetic
      // to choleskySolve, but exercises the sparse path through the parity
      // gate. True sparse arithmetic + AMD reordering per Davis 2006 Ch. 7
      // remain deferred until fill-in becomes measurable.
      const delta = cscCholeskySolve(denseToCsc(damped), negG);
      if (delta === null) {
        lam = Math.min(lam * LM_LAMBDA_UP, LM_LAMBDA_MAX);
        continue;
      }
      this.applyStep(delta);
      const newCost = this.totalCost();
      if (newCost < prevCost) {
        lastAccepted = true;
        let dInf = 0;
        for (const d of delta) {
          const a = Math.abs(d);
          if (a > dInf) dInf = a;
        }
        const costRatio = (prevCost - newCost) / Math.max(prevCost, 1.0e-30);
        lam = Math.max(lam / LM_LAMBDA_DOWN, 1.0e-12);
        prevCost = newCost;
        this.iterationCallback?.(newCost, it + 1, true);
        if (dInf < LM_CONVERGE_DELTA && costRatio < LM_CONVERGE_COST_RATIO && lastAccepted) {
          this._iterationsLastRun = it + 1;
          this._finalCost = newCost;
          return;
        }
        void n;
      } else {
        this.applyStep(delta.map((d) => -d));
        lastAccepted = false;
        lam = Math.min(lam * LM_LAMBDA_UP, LM_LAMBDA_MAX);
        this.iterationCallback?.(prevCost, it + 1, false);
      }
    }
    this._iterationsLastRun = LM_MAX_ITERATIONS;
    this._finalCost = prevCost;
  }

  trajectory(): Array<[string, Pose2]> {
    return this.poseIds.map((id) => [id, this.poses.get(id)!] as [string, Pose2]);
  }

  landmarkPositions(): Map<string, [number, number]> {
    return new Map(this.landmarks);
  }

  get iterationsLastRun(): number {
    return this._iterationsLastRun;
  }

  get finalCost(): number {
    return this._finalCost;
  }
}

// ---------------------------------------------------------------------------
// Polish C — Loop closure detection (mirrors Python `detect_loop_closures`)
// + SLAM scenario runner stubs. Full UI canvas integration (React layer) is
// documented as the remaining follow-on; this section ships the sim-core
// surface the canvas would consume.
// ---------------------------------------------------------------------------

export const LOOP_MIN_KEYFRAME_GAP = 10;
export const LOOP_MIN_SHARED_LANDMARKS = 2;
export const LOOP_RESIDUAL_TAU_M = 0.5;

export type LoopClosureFactor = {
  kind: "loop_closure";
  fromId: string;
  toId: string;
  measurement: Pose2;
  info: Mat3;
  sourceId: string;
};

/** Sim(2) element: SE(2) + uniform scale, per Umeyama 1991 [R7] Wave 3. */
export type Sim2 = { x: number; y: number; theta: number; scale: number };

/**
 * Umeyama Sim(2) alignment: closed-form (R, t, s) minimizing Σ ‖s R p_src + t − p_dst‖².
 * Returns null for <2 correspondences or coincident source.
 */
export function umeyamaSim2(
  src: ReadonlyArray<readonly [number, number]>,
  dst: ReadonlyArray<readonly [number, number]>,
): Sim2 | null {
  const n = src.length;
  if (n !== dst.length || n < 2) return null;
  let cxS = 0, cyS = 0, cxD = 0, cyD = 0;
  for (let k = 0; k < n; k++) {
    cxS += src[k]![0];
    cyS += src[k]![1];
    cxD += dst[k]![0];
    cyD += dst[k]![1];
  }
  cxS /= n; cyS /= n; cxD /= n; cyD /= n;
  let varS = 0;
  for (let k = 0; k < n; k++) {
    const dx = src[k]![0] - cxS;
    const dy = src[k]![1] - cyS;
    varS += dx * dx + dy * dy;
  }
  varS /= n;
  if (varS === 0) return null;
  let sxx = 0, syy = 0, sxy = 0, syx = 0;
  for (let k = 0; k < n; k++) {
    const sxk = src[k]![0] - cxS;
    const syk = src[k]![1] - cyS;
    const dxk = dst[k]![0] - cxD;
    const dyk = dst[k]![1] - cyD;
    sxx += sxk * dxk;
    syy += syk * dyk;
    sxy += sxk * dyk;
    syx += syk * dxk;
  }
  const theta = Math.atan2(sxy - syx, sxx + syy);
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const scale = ((sxx + syy) * cosT + (sxy - syx) * sinT) / (n * varS);
  if (scale <= 0) return null;
  const tx = cxD - scale * (cosT * cxS - sinT * cyS);
  const ty = cyD - scale * (sinT * cxS + cosT * cyS);
  return { x: tx, y: ty, theta, scale };
}

/**
 * Loop closure detection via landmark co-visibility per ADR 0017. Returns
 * candidate closures with closed-form SE(2) relative pose recovered from
 * shared landmarks; the caller decides whether to ingest them.
 */
export function detectLoopClosures(
  poseIds: ReadonlyArray<string>,
  landmarkFactors: ReadonlyArray<LandmarkFactor>,
  options?: {
    minKeyframeGap?: number;
    minSharedLandmarks?: number;
    residualTauM?: number;
  },
): LoopClosureFactor[] {
  const gap = options?.minKeyframeGap ?? LOOP_MIN_KEYFRAME_GAP;
  const minShared = options?.minSharedLandmarks ?? LOOP_MIN_SHARED_LANDMARKS;
  const tau = options?.residualTauM ?? LOOP_RESIDUAL_TAU_M;
  const perPose = new Map<string, Map<string, [number, number]>>();
  for (const f of landmarkFactors) {
    const bx = f.rangeM * Math.cos(f.bearingRad);
    const by = f.rangeM * Math.sin(f.bearingRad);
    if (!perPose.has(f.poseId)) perPose.set(f.poseId, new Map());
    perPose.get(f.poseId)!.set(f.landmarkId, [bx, by]);
  }
  const closures: LoopClosureFactor[] = [];
  for (let i = 0; i < poseIds.length; i++) {
    for (let j = i + gap; j < poseIds.length; j++) {
      const obsI = perPose.get(poseIds[i]!);
      const obsJ = perPose.get(poseIds[j]!);
      if (!obsI || !obsJ) continue;
      const shared: string[] = [];
      for (const k of obsI.keys()) if (obsJ.has(k)) shared.push(k);
      shared.sort();
      if (shared.length < minShared) continue;
      const bodyI = shared.map((k) => obsI.get(k)!);
      const bodyJ = shared.map((k) => obsJ.get(k)!);
      // Sim(2) with scale ≈ 1 for honest peers; treat as SE(2) by zeroing scale.
      const sim = umeyamaSim2(bodyJ, bodyI);
      if (sim === null) continue;
      // Residual check.
      const cosT = Math.cos(sim.theta);
      const sinT = Math.sin(sim.theta);
      let maxErr = 0;
      for (let k = 0; k < bodyI.length; k++) {
        const px = cosT * bodyJ[k]![0] - sinT * bodyJ[k]![1] + sim.x;
        const py = sinT * bodyJ[k]![0] + cosT * bodyJ[k]![1] + sim.y;
        const err = Math.hypot(bodyI[k]![0] - px, bodyI[k]![1] - py);
        if (err > maxErr) maxErr = err;
      }
      if (maxErr > tau) continue;
      closures.push({
        kind: "loop_closure",
        fromId: poseIds[i]!,
        toId: poseIds[j]!,
        measurement: { x: sim.x, y: sim.y, theta: sim.theta },
        info: odometryInformation(1.0),
        sourceId: "loop_closure",
      });
    }
  }
  return closures;
}

/**
 * Pre-canned L09 SLAM scenario: single agent traverses a 12-pose rectangular
 * loop with 4 landmarks, returns near the start, loop closure snaps drift.
 * Returns a sequence of optimizer states the UI canvas would step through.
 */
export type SlamSnapshot = {
  tick: number;
  trajectory: Array<[string, Pose2]>;
  landmarks: Map<string, [number, number]>;
  closureEdges: ReadonlyArray<LoopClosureFactor>;
  cost: number;
  iterations: number;
};

export function runSingleAgentLoopClosureDemo(): SlamSnapshot[] {
  // 12-pose rectangular loop that returns near start so closure can fire.
  // Path: (0,0) → (4,0) along bottom, (4,2) up right side, (0,2) along top, (0,1) down left.
  const truthCoords: Array<[number, number]> = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
    [4, 1], [4, 2],
    [3, 2], [2, 2], [1, 2], [0, 2],
    [0, 1],
  ];
  const truth: Pose2[] = truthCoords.map(([x, y]) => ({ x, y, theta: 0 }));
  const landmarks: Array<{ id: string; pos: [number, number] }> = [
    // Landmarks visible from start (p0) and return (p11).
    { id: "lm-00", pos: [-1, 0.5] },
    { id: "lm-01", pos: [-1, -0.5] },
    // Landmarks along the loop.
    { id: "lm-02", pos: [5, 0.5] },
    { id: "lm-03", pos: [5, 1.5] },
  ];
  const pg = new PoseGraphTS();
  const info = odometryInformation(0.5);
  const collectedLm: LandmarkFactor[] = [];
  const addedLandmarks = new Set<string>();

  const snapshots: SlamSnapshot[] = [];
  let tick = 0;
  const pushSnapshot = (iterations: number, cost: number, closureEdges: ReadonlyArray<LoopClosureFactor>): void => {
    snapshots.push({
      tick: tick++,
      trajectory: pg.trajectory(),
      landmarks: pg.landmarkPositions(),
      closureEdges,
      cost,
      iterations,
    });
  };

  // Pre-roll phase: walk the agent along the drifted initial trajectory,
  // adding one pose at a time + its odometry edge + any visible landmarks
  // and observations. Each pose is a snapshot, mirroring the per-tick agent
  // motion the swarm scenarios show.
  for (let i = 0; i < truth.length; i++) {
    pg.addPose(`p${i}`, { x: truth[i]!.x + 0.05 * i, y: truth[i]!.y + 0.02 * i, theta: 0 });
    if (i > 0) {
      pg.addOdometryFactor({
        kind: "odometry",
        fromId: `p${i - 1}`,
        toId: `p${i}`,
        measurement: between(truth[i - 1]!, truth[i]!),
        info,
        sourceId: "alpha",
      });
    }
    for (const lm of landmarks) {
      const dx = lm.pos[0] - truth[i]!.x;
      const dy = lm.pos[1] - truth[i]!.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 3.0) continue;
      if (!addedLandmarks.has(lm.id)) {
        pg.addLandmark(lm.id, [lm.pos[0] + 0.3, lm.pos[1] + 0.3]);
        addedLandmarks.add(lm.id);
      }
      const f: LandmarkFactor = {
        kind: "landmark",
        poseId: `p${i}`,
        landmarkId: lm.id,
        rangeM: dist,
        bearingRad: Math.atan2(dy, dx) - truth[i]!.theta,
        info: landmarkInformation(dist),
        sourceId: "alpha",
        nlos: false,
      };
      pg.addLandmarkFactor(f);
      collectedLm.push(f);
    }
    pushSnapshot(0, pg.totalCost(), []);
  }
  // Phase 1: LM optimize landmarks-only — one snapshot per accepted LM step.
  pg.setIterationCallback((cost, iter) => pushSnapshot(iter, cost, []));
  pg.optimize();
  pg.setIterationCallback(null);
  // Phase 2: detect + add loop closures, re-optimize — closure edges appear
  // immediately and the LM step animates the snap.
  const poseIds = truth.map((_, i) => `p${i}`);
  const closures = detectLoopClosures(poseIds, collectedLm);
  for (const c of closures) {
    pg.addOdometryFactor({
      kind: "odometry",
      fromId: c.fromId,
      toId: c.toId,
      measurement: c.measurement,
      info: c.info,
      sourceId: c.sourceId,
    });
  }
  // Closure-inserted, pre-snap snapshot — shows the new blue edges before
  // they get pulled taut.
  pushSnapshot(pg.iterationsLastRun, pg.totalCost(), closures);
  pg.setIterationCallback((cost, iter) => pushSnapshot(iter, cost, closures));
  pg.optimize();
  pg.setIterationCallback(null);
  // Sentinel kept so consumers that match on the closure-snap stage keep
  // working — re-pushes the converged state with explicit closure edges.
  snapshots.push({
    tick: tick++,
    trajectory: pg.trajectory(),
    landmarks: pg.landmarkPositions(),
    closureEdges: closures,
    cost: pg.finalCost,
    iterations: pg.iterationsLastRun,
  });
  return snapshots;
}

/**
 * Ground truth for the L09 demo — paired with `runSingleAgentLoopClosureDemo`
 * so the canvas overlay can render truth vs estimate.
 */
export function singleAgentLoopClosureTruth(): {
  trajectory: Array<[string, Pose2]>;
  landmarks: Array<[string, [number, number]]>;
} {
  const truthCoords: Array<[number, number]> = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
    [4, 1], [4, 2],
    [3, 2], [2, 2], [1, 2], [0, 2],
    [0, 1],
  ];
  return {
    trajectory: truthCoords.map(([x, y], i) => [`p${i}`, { x, y, theta: 0 }]),
    landmarks: [
      ["lm-00", [-1, 0.5]],
      ["lm-01", [-1, -0.5]],
      ["lm-02", [5, 0.5]],
      ["lm-03", [5, 1.5]],
    ],
  };
}

// ---------------------------------------------------------------------------
// Cooperative SLAM demos for L10 / L11 / L12 (ADRs 0016 / 0018 / 0020).
//
// 4 agents in a square formation share 4 central landmarks. Each agent
// observes all landmarks (range + bearing in body frame) and the other 3
// agents (inter-robot factors, modeled as virtual landmarks).
//
// Three scenarios share setup; differ in how A0 reports its landmark
// observations and how the graph is weighted:
//   "honest"           — all reports honest → cooperative gain visible
//   "pose_lie_naive"   — A0's reports shifted by POSE_LIE_OFFSET → joint
//                        solution dragged off truth
//   "pose_lie_robust"  — same as naive, but multi-cycle with bidirectional
//                        trust↔SLAM coupling (ADR 0020) → recovers
// ---------------------------------------------------------------------------

const COOP_AGENT_TRUTH: Array<[string, [number, number]]> = [
  ["A0", [0, 0]],
  ["A1", [4, 0]],
  ["A2", [4, 4]],
  ["A3", [0, 4]],
];

const COOP_LANDMARK_TRUTH: Array<[string, [number, number]]> = [
  ["lm-c0", [2, 1]],
  ["lm-c1", [3, 2]],
  ["lm-c2", [2, 3]],
  ["lm-c3", [1, 2]],
];

// A0 reports its landmark observations as if its own pose were shifted by
// this offset. The magnitude is chosen so the naive joint map shows clear
// distortion (~0.5–1 m off truth) without driving the optimizer outside its
// quadratic basin.
const COOP_POSE_LIE_OFFSET: [number, number] = [1.0, 1.0];

const COOP_INIT_DRIFT = 0.2;

// ADR 0022 L14 — singleton landmark only A0 observes. Truth at (8, 2), well
// outside the shared landmark cluster (which sits in the [1..3] × [1..3] box)
// so the lie's location is visually distinct in the canvas. A0 reports the
// singleton at its truth-pose-shifted-by-LIE-offset location, identical
// pose-lie offset as for the shared landmarks — the same lie that lets us
// reuse the rep-collapse closed loop.
const COOP_SINGLETON_LANDMARK: [string, [number, number]] = ["lm-singleton", [8, 2]];

export type CooperativeScenario =
  | "honest"
  | "pose_lie_naive"
  | "pose_lie_robust"
  | "singleton_lie";

export type CooperativeSlamSnapshot = {
  scenario: CooperativeScenario;
  cycle: number;
  /** Per-agent rendering data. Trajectory is the agent's pose chain (just one
   * pose per agent in this static-formation demo); reputation is the live
   * evaluator's view in robust mode, 1.0 elsewhere. */
  agents: Array<{ id: string; pose: Pose2; reputation: number }>;
  landmarks: Map<string, [number, number]>;
  /** Inter-robot factor edges (visualization hint). `weight` is the DCS prior
   * (source's reputation) the optimizer applied; 1.0 in naive mode. */
  interRobotEdges: Array<{ fromId: string; toId: string; weight: number }>;
  cost: number;
  iterations: number;
};

export function cooperativeSlamTruth(): {
  agents: Array<[string, [number, number]]>;
  landmarks: Array<[string, [number, number]]>;
} {
  return { agents: COOP_AGENT_TRUTH, landmarks: COOP_LANDMARK_TRUTH };
}

function makeCooperativeGraph(
  scenario: CooperativeScenario,
  onStep?: (pg: PoseGraphTS) => void,
): {
  pg: PoseGraphTS;
  agentIds: string[];
  interRobotEdges: Array<{ fromId: string; toId: string }>;
} {
  const pg = new PoseGraphTS();
  // L14 — enable ADR 0022 singleton cap + fade for the singleton_lie scenario.
  // Cap fires on the 5th landmark (only A0 observes it). Fade is off by
  // default (no tick clock yet); enabled by `runCooperativeSlamDemo` after
  // the closed-loop cycles run.
  if (scenario === "singleton_lie") {
    pg.enableSingletonCap(true);
  }
  // A1 (a honest agent) is the gauge anchor — anchoring A0 would let the
  // optimizer absorb A0's pose lie by shifting the whole frame, making the
  // lie invisible at convergence. With A1 truth-anchored + the odometry
  // ring below, all agents are tied to A1's gauge, so A0's lying landmark
  // measurements create real residuals.
  const orderedAgents: Array<[string, [number, number]]> = [
    COOP_AGENT_TRUTH[1]!, // A1 first → anchor
    COOP_AGENT_TRUTH[0]!, // A0
    COOP_AGENT_TRUTH[2]!,
    COOP_AGENT_TRUTH[3]!,
  ];
  for (const [id, [x, y]] of orderedAgents) {
    pg.addPose(id, {
      x: x + (id === "A1" ? 0 : COOP_INIT_DRIFT),
      y: y + (id === "A1" ? 0 : COOP_INIT_DRIFT),
      theta: 0,
    });
    onStep?.(pg);
  }
  const agentIds = COOP_AGENT_TRUTH.map(([id]) => id);
  // Odometry ring tying all agents to A1's gauge: A1↔A2↔A3↔A0↔A1. Each
  // measurement is the true relative pose between consecutive agents; high
  // information weight (short dt) makes these effectively rigid constraints
  // on the formation shape. Without this, the lie can be absorbed by
  // collective frame shift.
  const ringOrder = ["A1", "A2", "A3", "A0", "A1"];
  const truthByAgent = new Map(COOP_AGENT_TRUTH);
  const odoInfo = odometryInformation(0.1); // short dt → high info
  for (let i = 0; i < ringOrder.length - 1; i++) {
    const from = ringOrder[i]!;
    const to = ringOrder[i + 1]!;
    const [fx, fy] = truthByAgent.get(from)!;
    const [tx, ty] = truthByAgent.get(to)!;
    pg.addOdometryFactor({
      kind: "odometry",
      fromId: from,
      toId: to,
      measurement: { x: tx - fx, y: ty - fy, theta: 0 },
      info: odoInfo,
      sourceId: from,
    });
    onStep?.(pg);
  }
  // Landmark observations: every agent observes every landmark. Each
  // landmark is initialized when the first observation hits it.
  for (const [lid, [lx, ly]] of COOP_LANDMARK_TRUTH) {
    pg.addLandmark(lid, [lx + COOP_INIT_DRIFT, ly + COOP_INIT_DRIFT]);
    for (const [aid, [ax, ay]] of COOP_AGENT_TRUTH) {
      let ox = ax;
      let oy = ay;
      if (aid === "A0" && scenario !== "honest") {
        // Pose-lie: A0 reports as if it were at (ax+offset_x, ay+offset_y).
        ox = ax + COOP_POSE_LIE_OFFSET[0];
        oy = ay + COOP_POSE_LIE_OFFSET[1];
      }
      const dx = lx - ox;
      const dy = ly - oy;
      const r = Math.hypot(dx, dy);
      pg.addLandmarkFactor({
        kind: "landmark",
        poseId: aid,
        landmarkId: lid,
        rangeM: r,
        bearingRad: Math.atan2(dy, dx),
        info: landmarkInformation(r),
        sourceId: aid,
        nlos: false,
      }, { tick: 0 });
    }
    onStep?.(pg);
  }
  // L14 — A0-only singleton landmark. Initialized at the lying position
  // (where A0 will place it) so the canvas shows the displacement
  // immediately rather than relying on the optimizer to pull it from a
  // neutral seed. ADR 0022's defense lives in the *information weight*,
  // not the geometry — the optimizer happily places a singleton wherever
  // its lone reporter says, regardless of the cap.
  if (scenario === "singleton_lie") {
    const [sid, [slx, sly]] = COOP_SINGLETON_LANDMARK;
    // A0's true pose, used to compute the optimized landmark seed
    // (so a single LM step lands at zero residual against A0's report).
    const [trueA0x, trueA0y] = COOP_AGENT_TRUTH[0]![1];
    // A0's lying pose offset, used to compute the reported range/bearing.
    const ox = trueA0x + COOP_POSE_LIE_OFFSET[0];
    const oy = trueA0y + COOP_POSE_LIE_OFFSET[1];
    const dx = slx - ox;
    const dy = sly - oy;
    const r = Math.hypot(dx, dy);
    pg.addLandmark(sid, [trueA0x + dx, trueA0y + dy]);
    pg.addLandmarkFactor({
      kind: "landmark",
      poseId: "A0",
      landmarkId: sid,
      rangeM: r,
      bearingRad: Math.atan2(dy, dx),
      info: landmarkInformation(r),
      sourceId: "A0",
      nlos: false,
    }, { tick: 0 });
    onStep?.(pg);
  }
  // Inter-robot edges (visualization only; real factors omitted per above).
  const interRobotEdges: Array<{ fromId: string; toId: string }> = [];
  for (let i = 0; i < agentIds.length; i++) {
    interRobotEdges.push({
      fromId: agentIds[i]!,
      toId: agentIds[(i + 1) % agentIds.length]!,
    });
  }
  return { pg, agentIds, interRobotEdges };
}

function snapshotFromGraph(
  pg: PoseGraphTS,
  scenario: CooperativeScenario,
  cycle: number,
  agentIds: string[],
  interRobotEdges: Array<{ fromId: string; toId: string }>,
  reputations: Map<string, number>,
): CooperativeSlamSnapshot {
  const traj = new Map(pg.trajectory());
  const weightedEdges = interRobotEdges.map((e) => ({
    fromId: e.fromId,
    toId: e.toId,
    weight: reputations.get(e.fromId) ?? 1.0,
  }));
  return {
    scenario,
    cycle,
    agents: agentIds.map((id) => ({
      id,
      pose: traj.get(id)!,
      reputation: reputations.get(id) ?? 1.0,
    })),
    landmarks: pg.landmarkPositions(),
    interRobotEdges: weightedEdges,
    cost: pg.totalCost(),
    iterations: pg.iterationsLastRun,
  };
}

/** Run a cooperative SLAM demo for the L10–L12 lessons.
 *
 * Returns a sequence of snapshots the canvas steps through:
 *  - "honest" / "pose_lie_naive": 2 snapshots — pre-optimize, post-optimize
 *  - "pose_lie_robust": 5 snapshots — cycle 0..4. Each cycle: optimize →
 *    emit SLAM residuals → evaluator.observe → next cycle uses live rep.
 *    Reputation trace shows A0's rep declining over cycles. */
export function runCooperativeSlamDemo(
  scenario: CooperativeScenario,
): CooperativeSlamSnapshot[] {
  // Pre-roll: emit a snapshot after each construction step (4 agents + 4 ring
  // edges + 4 landmarks-with-observations = 12 frames). Each frame shows the
  // graph as it stands at that moment, mirroring how swarm scenarios show
  // agents progressively gathering data tick-by-tick.
  const preroll: CooperativeSlamSnapshot[] = [];
  let prerollIndex = 0;
  const allAgentIds = COOP_AGENT_TRUTH.map(([id]) => id);
  const fullRing: Array<{ fromId: string; toId: string }> = [];
  for (let i = 0; i < allAgentIds.length; i++) {
    fullRing.push({
      fromId: allAgentIds[i]!,
      toId: allAgentIds[(i + 1) % allAgentIds.length]!,
    });
  }
  const { pg, agentIds, interRobotEdges } = makeCooperativeGraph(scenario, (pgIn) => {
    // Read only agents currently in the graph so partial frames don't fault
    // on missing poses. Edges are filtered to those whose endpoints exist.
    const presentSet = new Set(pgIn.trajectory().map(([id]) => id));
    const presentIds = allAgentIds.filter((id) => presentSet.has(id));
    const edges = fullRing.filter((e) => presentSet.has(e.fromId) && presentSet.has(e.toId));
    const reps = new Map(presentIds.map((id) => [id, 1.0] as [string, number]));
    preroll.push(
      snapshotFromGraph(pgIn, scenario, prerollIndex++, presentIds, edges, reps),
    );
  });

  if (scenario !== "pose_lie_robust" && scenario !== "singleton_lie") {
    const initialReps = new Map(agentIds.map((id) => [id, 1.0] as [string, number]));
    const snapshots: CooperativeSlamSnapshot[] = [...preroll];
    let cycle = preroll.length;
    snapshots.push(
      snapshotFromGraph(pg, scenario, cycle++, agentIds, interRobotEdges, initialReps),
    );
    pg.setIterationCallback(() => {
      snapshots.push(
        snapshotFromGraph(pg, scenario, cycle++, agentIds, interRobotEdges, initialReps),
      );
    });
    pg.optimize();
    pg.setIterationCallback(null);
    return snapshots;
  }

  // Robust: closed loop. Simple per-source Beta(α, β) state — we don't pull
  // in BetaTrustEvaluator here (which is range-only voting machinery); the
  // ADR 0020 evidence channel feeds α/β directly.
  const alpha = new Map(agentIds.map((id) => [id, 1.0] as [string, number]));
  const beta = new Map(agentIds.map((id) => [id, 1.0] as [string, number]));
  const repOf = (sid: string): number => {
    const a = alpha.get(sid) ?? 1.0;
    const b = beta.get(sid) ?? 1.0;
    return a / (a + b);
  };
  pg.setReputationSource(repOf);

  const snapshots: CooperativeSlamSnapshot[] = [...preroll];
  let frameIndex = preroll.length;
  // Cycle 0 anchor: initial drift, no closed loop yet (every rep = prior 0.5).
  const cycle0Reps = new Map(
    agentIds.map((id) => [id, repOf(id)] as [string, number]),
  );
  snapshots.push(
    snapshotFromGraph(pg, scenario, frameIndex++, agentIds, interRobotEdges, cycle0Reps),
  );
  // Cycles 1..4: each runs optimizeGNC, emitting one snapshot per accepted
  // LM step (with current rep map) so the workshop scrubber plays the
  // bidirectional dynamic continuously rather than snapping between 5 stages.
  for (let cycle = 1; cycle < 5; cycle++) {
    pg.setIterationCallback(() => {
      const reps = new Map(agentIds.map((id) => [id, repOf(id)] as [string, number]));
      snapshots.push(
        snapshotFromGraph(pg, scenario, frameIndex++, agentIds, interRobotEdges, reps),
      );
    });
    pg.optimizeGNC();
    pg.setIterationCallback(null);
    const evidence = pg.slamResidualEvidence();
    for (const [sid, ev] of evidence) {
      alpha.set(sid, (alpha.get(sid) ?? 1.0) + ev.alpha);
      beta.set(sid, (beta.get(sid) ?? 1.0) + ev.beta);
    }
    // End-of-cycle anchor with refreshed rep map (post-evidence).
    const reps = new Map(agentIds.map((id) => [id, repOf(id)] as [string, number]));
    snapshots.push(
      snapshotFromGraph(pg, scenario, frameIndex++, agentIds, interRobotEdges, reps),
    );
  }
  return snapshots;
}

function accumulate(
  h: number[][],
  g: number[],
  om: number[][],
  r: readonly number[],
  blocks: Array<[number[][] | null, number | null, number]>,
): void {
  for (const [jA, slotA, dimA] of blocks) {
    if (jA === null || slotA === null) continue;
    for (let row = 0; row < dimA; row++) {
      let gv = 0;
      for (let i = 0; i < r.length; i++) {
        let omR = 0;
        for (let k = 0; k < r.length; k++) omR += om[i]![k]! * r[k]!;
        gv += jA[i]![row]! * omR;
      }
      g[slotA + row] = g[slotA + row]! + gv;
    }
    for (const [jB, slotB, dimB] of blocks) {
      if (jB === null || slotB === null) continue;
      for (let row = 0; row < dimA; row++) {
        for (let col = 0; col < dimB; col++) {
          let v = 0;
          for (let i = 0; i < r.length; i++) {
            let omJ = 0;
            for (let k = 0; k < r.length; k++) omJ += om[i]![k]! * jB[k]![col]!;
            v += jA[i]![row]! * omJ;
          }
          h[slotA + row]![slotB + col] = h[slotA + row]![slotB + col]! + v;
        }
      }
    }
  }
}
