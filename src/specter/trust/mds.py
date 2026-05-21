"""Eigenvalue-residual classical MDS for Tier 2 cohort consistency. ADR 0015.

For a cohort of `k ≥ 3` peers, build the symmetric pairwise distance matrix `D`
from reciprocal beacon ranges. Classical MDS (Torgerson) recovers a Euclidean
embedding; if the matrix is consistent with a 2D placement, only the top two
eigenvalues of the doubly-centered Gram matrix `B = -½·J·D²·J` are large and
the rest are near zero. Non-2D-embeddability — caused by colluder-pair range
lies that pass pairwise reciprocal Tier 1 but disagree with the multilateration
geometry — surfaces as significant non-2D eigenvalue contribution.

Empirically validated (pre-PRD):

- N ∈ {4, 8, 12, 16, 20} honest swarms: `embeddability_score < 0.05`.
- Colluder pair (Tier-1-evading symmetric range lie): 9/9 trials at N up to 20
  correctly identified both colluders in the top-2 residual ranking. Ratio
  attack/honest score 1.5–8.3× across N.
- Compute: <500 μs per cohort at N=20 (sub-millisecond at the demonstrator
  swarm scale).

Public API:
- `embeddability_score(D)` — non-2D contribution / 2D contribution; 0 = perfect.
- `per_point_residuals(D)` — each peer's contribution to non-2D eigenvectors.
  The peer with the maximum residual is the outlier (in colluder-pair attacks,
  both colluders carry large residuals).

Internals symmetrize `D` before centering (`(D + D.T) / 2`) so asymmetric
range matrices — which Tier 1 would have already flagged — produce stable
MDS output for Tier 2's residual ranking.
"""

from __future__ import annotations

import numpy as np


def _double_center(D: np.ndarray) -> np.ndarray:
    """Compute the Gram matrix `B = -½·J·D²·J` (Torgerson centering).

    `J = I - (1/n)·ones(n,n)` removes the mean from each row/column of `D²`.
    For a Euclidean distance matrix, `B` has rank ≤ n−1 with the top
    eigenvalues equal to the coordinate variances along principal axes.
    """
    n = D.shape[0]
    D_sym = (D + D.T) / 2.0
    D_sq = D_sym ** 2
    J = np.eye(n) - np.ones((n, n)) / n
    B: np.ndarray = -0.5 * (J @ D_sq @ J)
    return B


def embeddability_score(D: np.ndarray) -> float:
    """Non-2D-embeddability score for the distance matrix `D`.

    Returns `sum(|λ_k|) for k ≥ 2  /  sum(|λ_0|, |λ_1|)`. A perfectly
    2D-embeddable matrix has score → 0. Larger values indicate the joint
    geometry cannot be realized in 2D — the Tier-2 collusion signal.

    Empirically, honest swarms produce scores < 0.05; colluder-pair attacks
    elevate to 0.05–0.5 depending on N (see ADR 0015).
    """
    if D.shape[0] < 3:
        return 0.0  # k=2 is trivially embeddable; Tier 2 needs k≥3
    B = _double_center(D)
    eigvals = np.linalg.eigvalsh(B)
    # eigvalsh returns ascending; we want descending by magnitude.
    eigvals = eigvals[np.argsort(-np.abs(eigvals))]
    top_two = np.abs(eigvals[:2]).sum() + 1e-12
    non_2d = np.abs(eigvals[2:]).sum()
    return float(non_2d / top_two)


def per_point_residuals(D: np.ndarray) -> np.ndarray:
    """Per-peer contribution to the non-2D eigenvectors.

    For each peer `i`, residual = `sum over k≥2 of (eigenvec_k[i])² · |λ_k|`.
    Surfaces "how movable" each peer is in the non-2D subspace. For *single*
    range-lying peers this aligns with the guilty peer; for *colluder-pair*
    attacks the bad edge is the load-bearing signal — see
    `lying_edge_residuals` for edge-level attribution.
    """
    n = D.shape[0]
    if n < 3:
        return np.zeros(n)
    B = _double_center(D)
    eigvals, eigvecs = np.linalg.eigh(B)
    idx = np.argsort(-np.abs(eigvals))
    eigvals = eigvals[idx]
    eigvecs = eigvecs[:, idx]
    residuals = np.zeros(n)
    for k in range(2, n):
        residuals += (eigvecs[:, k] ** 2) * abs(eigvals[k])
    return residuals


def lying_edge_residuals(D: np.ndarray) -> np.ndarray:
    """Per-edge triangle-inequality violation. For each edge `(i, j)`, sum
    triangle violations across all third peers `k`:

      `max(0, D[i,j] − D[i,k] − D[j,k])`

    A symmetric lie inflating `D[i,j]` by `bias` violates the triangle
    inequality against every `k` (because honest geometry has `D[i,j] ≤
    D[i,k] + D[j,k]`). Honest edges paired with a colluder show no violation
    on themselves — only the lying edge accumulates triangle violations.

    Empirically this localizes blame to the actual lying edge for
    Tier-1-evading symmetric colluder-pair attacks, where MDS-reconstruction
    residual disperses across edges.
    """
    n = D.shape[0]
    if n < 3:
        return np.zeros((n, n))
    D_sym = (D + D.T) / 2.0
    residuals = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            for k in range(n):
                if k == i or k == j:
                    continue
                excess = D_sym[i, j] - D_sym[i, k] - D_sym[j, k]
                if excess > 0:
                    residuals[i, j] += excess
    return residuals
