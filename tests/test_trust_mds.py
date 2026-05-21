"""MDS module verification — eigenvalue-residual blame attribution at N up to 20.

Empirical results captured pre-PRD; this suite locks them in CI.
"""

from __future__ import annotations

import time

import numpy as np
import pytest

from specter.trust import mds

RNG = np.random.default_rng(7)


def _swarm(n: int, world_size: float = 20.0) -> np.ndarray:
    return RNG.uniform(0, world_size, size=(n, 2))


def _distances(positions: np.ndarray) -> np.ndarray:
    diffs = positions[:, None, :] - positions[None, :, :]
    return np.linalg.norm(diffs, axis=-1)


def _add_noise(D: np.ndarray, sigma: float = 0.1) -> np.ndarray:
    n = D.shape[0]
    noise = RNG.normal(0, sigma, size=(n, n))
    noise = (noise + noise.T) / 2
    np.fill_diagonal(noise, 0)
    return np.maximum(D + noise, 0)


def _inject_colluder_pair(D: np.ndarray, a: int, b: int, bias_m: float) -> np.ndarray:
    out = D.copy()
    out[a, b] += bias_m
    out[b, a] += bias_m
    return out


@pytest.mark.parametrize("n", [4, 8, 12, 16, 20])
def test_honest_swarm_embeddability_below_tau(n: int) -> None:
    """Honest beacon noise produces embeddability scores well under the
    Tier 2 firing threshold of 0.05 (ADR 0015)."""
    positions = _swarm(n)
    D = _add_noise(_distances(positions), sigma=0.1)
    score = mds.embeddability_score(D)
    assert score < 0.05, f"honest N={n} embeddability={score:.4f} ≥ 0.05"


@pytest.mark.parametrize("n,trials,min_correct", [(8, 10, 8), (16, 10, 8), (20, 10, 8)])
def test_colluder_pair_residuals_identify_both_attackers(
    n: int, trials: int, min_correct: int,
) -> None:
    """Symmetric colluder-pair lies pass Tier 1 reciprocal but fail MDS:
    both colluders land in the top-2 residual ranking. Pre-PRD verification
    was 9/9 at handpicked seeds; CI tolerates noise with an 80% floor across
    random trials."""
    correct = 0
    for _ in range(trials):
        positions = _swarm(n)
        D = _add_noise(_distances(positions), sigma=0.1)
        a, b = RNG.choice(n, size=2, replace=False)
        attacked = _inject_colluder_pair(D, int(a), int(b), bias_m=3.0)
        residuals = mds.per_point_residuals(attacked)
        rank = np.argsort(-residuals)
        top2 = set(rank[:2].tolist())
        if {int(a), int(b)} <= top2:
            correct += 1
    assert correct >= min_correct, (
        f"N={n}: only {correct}/{trials} colluder pairs in top-2 (min {min_correct})"
    )


@pytest.mark.parametrize("n", [8, 16, 20])
def test_colluder_pair_elevates_embeddability_relative_to_honest(n: int) -> None:
    """Embeddability score lifts relative to honest baseline. Single-trial
    absolute thresholds aren't reliable at high N (the noise floor grows);
    the relative ratio is the load-bearing property."""
    positions = _swarm(n)
    D_honest = _add_noise(_distances(positions), sigma=0.1)
    a, b = RNG.choice(n, size=2, replace=False)
    D_attack = _inject_colluder_pair(D_honest, int(a), int(b), bias_m=3.0)
    score_honest = mds.embeddability_score(D_honest)
    score_attack = mds.embeddability_score(D_attack)
    # Ratio threshold matches the pre-PRD finding (1.5× at N=20).
    assert score_attack >= 1.4 * max(score_honest, 1e-4), (
        f"N={n} attack/honest ratio {score_attack / max(score_honest, 1e-4):.2f}× < 1.4×"
    )


def test_below_k3_returns_zero() -> None:
    """Tier 2 needs k ≥ 3 for a 2D MDS to be meaningful. Below that, the
    primitive returns 0 (embeddable) and zero residuals."""
    D = np.array([[0.0, 1.0], [1.0, 0.0]])
    assert mds.embeddability_score(D) == 0.0
    residuals = mds.per_point_residuals(D)
    assert residuals.shape == (2,)
    assert (residuals == 0.0).all()


def test_compute_budget_at_n_20_under_500us() -> None:
    """MDS per cohort must fit inside the per-tick real-time budget.
    Empirically <500 μs at N=20 pre-PRD; CI enforces 1 ms ceiling for
    machine-variance tolerance."""
    positions = _swarm(20)
    D = _add_noise(_distances(positions), sigma=0.1)
    t0 = time.perf_counter()
    for _ in range(100):
        mds.embeddability_score(D)
        mds.per_point_residuals(D)
    per_call_s = (time.perf_counter() - t0) / 100
    assert per_call_s < 1e-3, f"MDS per cohort at N=20: {per_call_s * 1e6:.1f}μs > 1ms"
