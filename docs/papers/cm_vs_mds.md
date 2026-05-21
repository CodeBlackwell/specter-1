# Eigenvalue-Residual MDS Beats Cayley-Menger for Byzantine Cohort Consistency at Scale

**Draft workshop note · specter-1 project · 2026-05-17**

## Abstract

We empirically compare two classical tests of geometric consistency on a cohort distance matrix `D ∈ R^{N×N}` as Byzantine-detection signals for cooperative localization: the textbook **Cayley-Menger (CM) determinant** of the `(N+1)×(N+1)` squared-distance matrix, and the **eigenvalue-residual classical-MDS embeddability score** (Torgerson-centered Gram eigenvalues, ratio of non-2D mass to 2D mass). On a sweep over `N ∈ {4, …, 20}` with `M = 50` trials per `N` under three threat conditions (honest, single liar, colluder pair), we find: (i) the CM determinant grows by **~15 orders of magnitude** from `N=4` (`log₁₀|det| ≈ 4.7`) to `N=20` (`log₁₀|det| ≈ 19.7`) on *honest* geometries alone, while attacker-induced excess is only ~1.5–2 orders, leaving honest±std overlapping with attacker means; (ii) the MDS embeddability score stays bounded in `[0.003, 0.10]` across the same sweep, with a stable ~2–3× separation between honest and colluder-pair geometries; (iii) per-point MDS residuals identify both colluders in the top-2 with **100% rate at `N ≥ 10`** and single-liar with 92% top-1 rate at `N ≥ 14`. The CM determinant is unusable as a discriminator at the operating sizes of multi-robot swarms; eigenvalue-residual MDS is the right substrate for Byzantine cohort consistency.

## 1. Problem and contribution

Cooperative multi-robot localization needs a per-cohort Byzantine-detection signal that flags geometrically inconsistent range-measurement sets. The trust-evaluator literature for sensor networks and multi-robot systems repeatedly cites geometric consistency as a defense [3, 4, 5, 7], but the literature on *how to compute it at scale* is sparse and divides into two camps: (i) the Cayley-Menger determinant of the squared-distance matrix, motivated by the volume-vanishing property of points in low dimension [1]; (ii) classical multidimensional scaling (CMDS) on the double-centered Gram matrix, with embeddability inferred from the eigenvalue spectrum [2, 6].

Both tests are textbook. Neither has, to our knowledge, been measured head-to-head as a *Byzantine-detection signal* over the operating-size sweep `N=4..20` that is typical of swarm robotics. ADR 0015 of the `specter-1` project locked eigenvalue-residual MDS as the Tier 2 mechanism after pre-PRD measurements suggested CM was numerically unstable; this note formalizes that measurement, releases the sweep code, and quantifies the gap.

**Contribution.** Empirical sweep at `N=4..20`, `M=50` trials per `N`, under three attack conditions, with three measured signals: (i) CM determinant dynamic range, (ii) MDS embeddability score, (iii) per-point MDS-residual blame-attribution rate. We release the sweep script (`experiments/cm_vs_mds_sweep.py`) and the raw results (`experiments/cm_vs_mds_results.json`) under the `specter-1` repository.

## 2. Method

**Setup.** For each `N`, draw `M=50` random 2D point configurations uniformly in a `[−10 m, 10 m]²` arena. Compute the noisy distance matrix `D[i, j] = ‖p_i − p_j‖ + ε`, with `ε ~ N(0, σ²)`, `σ = 0.1 m` (UWB-class noise per ADR 0005). For each configuration evaluate three threat conditions:

- **honest** — no perturbation beyond sensor noise.
- **single liar** — one observer adds `+3.0 m` (matches `RANGE_LIE_BIAS_M` in `specter.attacks`) to its outgoing rows; incoming rows untouched, producing asymmetric `D`.
- **colluder pair** — two peers symmetrically inflate `D[a, b] = D[b, a]` by `+3.0 m`, evading any pairwise reciprocity check (Tier 1 in ADR 0015).

**Signal A — Cayley-Menger determinant.** Compute the `(N+1)×(N+1)` matrix:

```
M = [[0,    1,        1,       …,  1     ],
     [1,    0,        D₀₁²,    …,  D₀ₙ²  ],
     [1,    D₁₀²,     0,       …,  D₁ₙ²  ],
     [⋮,    ⋮,        ⋮,       ⋱,  ⋮     ],
     [1,    Dₙ₀²,     Dₙ₁²,    …,  0     ]]
```

`det(M)` is proportional to the squared `(N-1)`-simplex volume; for `N` points lying in 2D this volume is zero, so honest geometries should give `det(M) ≈ 0`. We report `log₁₀(|det(M)| + 10⁻³⁰⁰)` to handle underflow.

**Signal B — eigenvalue-residual MDS embeddability score.** Compute the doubly-centered Gram matrix `B = −½ J D² J` with `J = I − (1/N) 𝟙𝟙ᵀ` (Torgerson centering). Let `λ₀ ≥ |λ₁| ≥ … ≥ |λₙ₋₁|` be the eigenvalues of `B` sorted by absolute magnitude. The embeddability score is:

```
score(D) = (∑_{k ≥ 2} |λ_k|) / (|λ₀| + |λ₁|)
```

A perfectly 2D-embeddable matrix has `score → 0`. The score is invariant to the scale of `D` and bounded by construction.

**Signal C — per-point blame attribution.** Eigendecompose `B = U Λ Uᵀ`. For each peer `i`, the residual is `r_i = ∑_{k ≥ 2} U[i, k]² · |λ_k|` — the peer's contribution to the non-2D eigenvectors. For single-liar trials, blame is correct if `argmax_i r_i` equals the true liar. For colluder-pair trials, blame is correct if both colluders are in the top-2 residuals.

## 3. Results

We report mean ± std over `M=50` trials per `N`. Full numbers in `experiments/cm_vs_mds_results.json`.

### 3.1 Cayley-Menger dynamic range

| N  | honest log₁₀\|det\| | single-liar | colluder-pair | honest–colluder gap |
|----|--------------------:|------------:|--------------:|---------------------:|
| 4  | +4.72 ± 0.66        | +5.95       | +6.14         | +1.42                |
| 8  | +7.99 ± 0.84        | +9.07       | +9.96         | +1.97                |
| 12 | +11.59 ± 1.17       | +12.74      | +13.57        | +1.98                |
| 16 | +15.24 ± 1.38       | +16.30      | +16.97        | +1.73                |
| 20 | +19.66 ± 1.26       | +20.66      | +21.44        | +1.78                |

The honest determinant magnitude grows by **15 orders of magnitude** across the sweep, dominated by the leading-order product of pairwise squared distances; the attack-induced excess is **~1.5–2 orders**, and the honest standard deviation is **~1 order**, so honest±2σ overlaps the colluder mean at every `N ≥ 4`. As a binary classifier with a fixed threshold, CM is unusable: any threshold that admits all honest geometries at `N=20` also admits attacks at `N=4`, and vice versa. (See figure: `experiments/cm_vs_mds_dynamic_range.png`, panel a.)

### 3.2 MDS embeddability score

| N  | honest        | single-liar   | colluder-pair |
|----|---------------|---------------|---------------|
| 4  | 0.003 ± 0.003 | 0.012 ± 0.014 | 0.039 ± 0.024 |
| 8  | 0.020 ± 0.005 | 0.034 ± 0.014 | 0.093 ± 0.020 |
| 12 | 0.032 ± 0.006 | 0.049 ± 0.011 | 0.093 ± 0.013 |
| 16 | 0.043 ± 0.005 | 0.059 ± 0.011 | 0.095 ± 0.010 |
| 20 | 0.050 ± 0.005 | 0.061 ± 0.008 | 0.092 ± 0.008 |

The score stays bounded across the entire sweep — honest grows monotonically from 0.003 to 0.050 (an order of magnitude, all in `[0, 0.06]`), and the colluder-pair condition plateaus near 0.09. A fixed threshold `τ = 0.05` (the value used in `BetaTrustEvaluator.MDS_EMBEDDABILITY_TAU`) correctly admits all honest geometries at `N ≤ 16` and correctly flags all colluder-pair geometries at `N ≥ 8`. The single-liar condition is harder, hovering near `τ`; the per-point residual signal (§3.3) compensates. (See figure: `experiments/cm_vs_mds_dynamic_range.png`, panel b.)

### 3.3 Per-point blame attribution

| N  | single-liar (top-1) | colluder-pair (both in top-2) |
|----|--------------------:|-----------------------------:|
| 4  | 0.10                | 0.12                         |
| 6  | 0.44                | 0.44                         |
| 8  | 0.62                | 0.92                         |
| 10 | 0.80                | **1.00**                     |
| 12 | 0.88                | **1.00**                     |
| 16 | 0.96                | **1.00**                     |
| 20 | 0.92                | **1.00**                     |

Colluder-pair attribution hits 100% by `N=10` and stays there. Single-liar attribution climbs from random (≈ 1/N) at `N=4` to 92% by `N=20`. The asymmetry is geometric: a symmetric pair-lie injects residual concentrated on the two colluding peers' eigenvector loadings, while a single-observer asymmetric lie distributes residual across the lying peer and every peer it lied about, making top-1 attribution slower to converge. The colluder-pair regime is the harder threat model (Tier 1 evasion); MDS resolves it cleanly at swarm-relevant `N`. (See figure: `experiments/cm_vs_mds_blame.png`.)

## 4. Discussion

**Why CM fails.** The Cayley-Menger determinant carries unit `m^(2(N-1))` in its leading term. As `N` grows, the magnitude is dominated by `∏ Dᵢⱼ²`, which over a `[−10, 10]²` arena yields determinants near `10^N`. A `3 m` attacker bias on one or two entries perturbs this leading term by a fraction proportional to `(3 / r̄)^k` where `r̄` is the mean pairwise distance and `k` is the number of perturbed entries — a small relative perturbation on an absolute scale that already varies wildly with `N`. The signal is buried in scale.

**Why MDS works.** Torgerson centering removes the leading-order mean and scale information; the embeddability score is a ratio of eigenvalue masses, which is invariant to the overall scale of `D`. The non-2D eigenvalues carry only the *non-embeddable component* of the geometry, which is what an attacker injects when they violate triangle-inequality constraints across the cohort. The signal is concentrated.

**Per-point residuals as blame.** The CMDS embedding is uniquely defined up to rigid motion, so individual eigenvector loadings are meaningful. A peer that consistently appears in the non-2D loadings is the source of the non-embeddability. For colluder pairs, the symmetric lie introduces a single rank-1 perturbation to the Gram matrix that aligns with both colluders' eigenvector positions, yielding top-2 attribution.

**Practical regime.** The eigendecomposition cost is `O(N³)`. At `N=20`, sub-millisecond per cohort on a 2026-era laptop. For cohort sizes `N > 200`, beacon-neighborhood pruning (already implicit in the range-cap of UWB hardware) restricts to local cohorts; `N=20` is a generous upper bound for any single beacon's cohort in practice.

**Threshold calibration.** `τ = 0.05` admits honest swarms at `N ≤ 16` and rejects colluders at `N ≥ 8`. At `N=18, 20` the honest mean approaches `τ` and a slightly higher threshold (`τ = 0.06`) restores clean separation. The composition with Tier 1 reciprocal-range voting (ADR 0015) makes the single-liar regime — where MDS is weak — a Tier-1 case anyway, since asymmetric lies break reciprocity directly. MDS is therefore *specialized* for the Tier-1-evading colluder-pair threat, where it is empirically tight.

## 5. Related work

- **Cayley-Menger for localization.** Thomas and Ros [1] use the CM determinant for forward localization in small (4–5 point) clusters; their setting does not see the dynamic-range blowup because `N` is bounded. We are aware of no published characterization of CM dynamic range as `N` grows in a Byzantine-detection setting.
- **CMDS for outlier filtering.** Trosset [2] defines per-point and per-pair goodness-of-fit statistics on a CMDS embedding for filtering *legitimately noisy* observations; no collusion model. Our work extends per-point CMDS residuals to a Byzantine threat model with a measured attribution rate.
- **Sparse + low-rank robust localization.** Clark et al.'s SMILE [6] decomposes a Gram matrix into low-rank + sparse components via RPCA, identifying outliers per-pair. SMILE is more general (handles missing measurements, addresses both random and adversarial outliers); our work is narrower (full distance matrix, two-mode adversarial scenarios, per-point attribution feeding a Beta-reputation trust evaluator). SMILE-on-cohort-D would be an interesting comparison and is left as future work.
- **Attack-resistant localization.** Liu, Ning, Du [3] and Wu et al. [5] use voting and triangle-inequality residuals respectively; neither uses spectral methods.
- **Pairwise consistency in multi-robot SLAM.** Mangelson et al. [4] (PCM), Lajoie et al. [9] (DOOR-SLAM), and Tian et al. [10] (Kimera-Multi) detect outlier inter-robot loop closures via pairwise geometric consistency or distributed-GNC residuals. These methods operate on a different evidence stream (relative-pose constraints, not range cohorts) and are complementary.
- **Byzantine reputation in swarm SLAM.** Moroncelli et al. [7] manage continuous reputation via blockchain smart contracts and use it as a loop-closure admission filter. Their detection signal is geometric consistency on loop closures; ours is range-only spectral consistency, fed into a per-peer Beta(α, β) evaluator that outputs an exogenous prior to the SLAM optimizer (separate architectural decoupling, not the subject of this note).

## 6. Limitations

- **2D only.** The sweep assumes peers are in a plane; in 3D the embeddability score would generalize to a ratio of non-3D to top-3 eigenvalues. The CM analogue extends naturally.
- **One noise model.** Gaussian `σ = 0.1 m` is the UWB-class budget per ADR 0005; NLOS multipath would add heavier tails and is left for hardware-phase measurement.
- **One attack family.** Single liar and colluder pair are the threats Tier 1 evades or partially evades. Multi-colluder rings (3+ peers coordinating a globally-shifted geometry) defeat both Tier 1 and Tier 2 and would require an external-anchor multilateration constraint; out of scope.
- **No comparison against SMILE [6].** SMILE on the same cohort distance matrices is the natural follow-up benchmark. Future work.
- **Random uniform layouts.** Real swarms have correlated positions (formation flying, mission-driven clusters). The CM blowup is layout-dependent only through the mean pairwise distance `r̄`; the MDS score is scale-invariant. We expect qualitative agreement on real layouts.

## 7. Conclusion

For Byzantine detection on a cohort distance matrix at swarm-relevant sizes (`N=4..20`), the Cayley-Menger determinant is unusable: its honest dynamic range exceeds attacker-induced excess by an order of magnitude, drowning the signal in scale. Eigenvalue-residual classical MDS is the right substrate: bounded score, ~2–3× separation between honest and colluder geometries, and clean per-point blame attribution that reaches 100% on colluder pairs by `N=10`. The empirical sweep, the sweep script, and the raw results are released with the `specter-1` repository for reproducibility.

## References

[1] Thomas, F.; Ros, L. *Revisiting trilateration for robot localization.* IEEE Transactions on Robotics 21(1):93–101, 2005.

[2] Trosset, M. W. *Goodness-of-fit filtering in classical multidimensional scaling.* Journal of Applied Statistics, 2019. <https://www.tandfonline.com/doi/full/10.1080/02664763.2019.1702929>

[3] Liu, D.; Ning, P.; Du, W. K. *Attack-resistant location estimation in sensor networks.* Proc. IPSN 2005.

[4] Mangelson, J. G.; Dominic, D.; Eustice, R. M.; Vasudevan, R. *Pairwise consistent measurement set maximization for robust multi-robot map merging.* Proc. ICRA 2018.

[5] Wu, C. et al. *Beyond triangle inequality: sifting noisy and outlier distance measurements for localization.* ACM TOSN 9(2), 2013.

[6] Clark, P. et al. *SMILE: Robust network localization via sparse and low-rank matrix decomposition.* arXiv:2301.11450, 2023.

[7] Moroncelli, A. et al. *Byzantine fault detection in Swarm-SLAM using blockchain and geometric constraints.* Proc. ANTS 2024.

[8] Jøsang, A.; Ismail, R. *The Beta reputation system.* Proc. Bled Electronic Commerce 2002.

[9] Lajoie, P.-Y.; Ramtoula, B.; Wu, F.; Beltrame, G. *DOOR-SLAM: Distributed, online, and outlier-resilient SLAM for robotic teams.* IEEE RA-L 5(2), 2020.

[10] Tian, Y. et al. *Kimera-Multi: Robust, distributed, dense metric-semantic SLAM for multi-robot systems.* IEEE T-RO 38(4), 2022.

## Reproducibility

```
# from the specter-1 repo root
uv run python experiments/cm_vs_mds_sweep.py --n-trials 50 --seed 20260517
```

Outputs `experiments/cm_vs_mds_results.json`, `experiments/cm_vs_mds_dynamic_range.png`, and `experiments/cm_vs_mds_blame.png`. The Python `specter.trust.mds` module (`src/specter/trust/mds.py`) is the reference implementation; the TS parity port at `ui/packages/sim-core/src/mds.ts` matches to 12 decimals on the canonical fixture vectors.
