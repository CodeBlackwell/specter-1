# Workshop Outline

A Jupyter-notebook curriculum that decomposes specter-1's shipped capabilities
into a layered, runnable narrative. The library is Byzantine-resilient
cooperative SLAM; the workshop is its **executable threat model + hardware-
integration handover**.

This document is the planning artifact. Slices land via `PROGRESS.md`; durable
design calls promote to ADRs.

---

## Bottom line

The library is wired (204 tests, 13 ADRs, 12 eval scenarios, MapMerger + SROS2
+ identity-lifecycle + scan-match SLAM all shipped). `examples/unified_demo.py`
already exercises every shipped capability in 719 LOC. Workshopification is
**decomposition, not new content**: slice the demo into 9 layered notebooks
that import the real library, end with measured claims from `tests/eval/`, and
surface the ABC seams a hardware integrator will subclass.

Estimated effort: 9 notebooks + 1 renderer + 1 demo refactor + CI gate, across
~10 slices. Ships behind a `[workshop]` extra in `pyproject.toml`.

---

## Audience priority

| Priority | Audience | What they need |
|---|---|---|
| 1 | **Hardware integrator** (TurtleBot4 / Crazyflie+UWB port per ADR 0006) | ABC seams (`SensorAdapter`, `LocalSlam`, `MessageBus`), what survives a transport swap, inherited threat model |
| 2 | **Reviewer** (30-min top-down read) | Headline claim verification: does the trust engine actually catch the attacks, does cooperative SLAM actually converge |
| 3 | **Security engineer** (deep dive on trust math) | Already served by 13 ADRs + `THREAT_MODEL.md` + `tests/eval/` |

Notebooks read top-down for audience 2, cell-by-cell for audience 1. No
notebook is built specifically for audience 3.

---

## Design rules

1. **Import-only.** Notebooks `import specter.*`; no inlined library logic.
   Prevents rot when the library evolves.
2. **Three cell types.**
   - **Intuition cells** — plot, inspect, single-message demo. Build the
     mental model. Use the library, never duplicate it.
   - **Claim cells** — call an existing `tests/eval/` scenario (or a short
     variant of it) and assert a numeric bound from `PROGRESS.md` /
     `THREAT_MODEL.md`. Every notebook has at least one.
   - **Limit cells** — link the section in `THREAT_MODEL.md` or
     `HARDWARE_READINESS.md` that owns the residual gap. Every notebook has
     at least one. No overselling.
3. **No claims without measurements.** Same rule as `THREAT_MODEL.md`. A
   claim cell with no scenario behind it doesn't ship.
4. **rclpy is optional.** SROS2 cells gate on import; print a clear "install
   `[ros2]` extra" message when absent. Mirrors the test-suite skip pattern.
5. **Laptop-runnable.** End-to-end execute under 15 minutes on a laptop. Long
   eval scenarios run as short variants in-cell with a reference link to the
   full audited test.

---

## Notebook sequence (T-shape)

The library's dependency graph is a T: **trust trunk** + **SLAM trunk** +
**transport orthogonal**. Notebook order mirrors the graph, not chronology.

### Trust trunk

| # | Notebook | Covers | Claim cell | Limit cell |
|---|---|---|---|---|
| 01 | `01_signed_envelopes_and_bus.ipynb` | `crypto.py`, `messages.py`, `secure_bus.py` | 5 rejection categories from `tests/test_signed_bus.py` | `THREAT_MODEL.md` § hardware-key-compromise |
| 02 | `02_identity_lifecycle.ipynb` | `identity/` (roster, rotation, revocation, attestation) | `tests/eval/test_identity_attacks.py` — sybil-mint blocked by attestation | ADR 0009 — mock attestation; real TPM/SE is Phase 4 |
| 03 | `03_beta_reputation_and_decay.ipynb` | `trust/evaluator.py` Beta core, α-tightening, 10s decay | Decay-window inflection at ~100 ms jitter from `tests/eval/test_calibration.py` (ADR 0013) | Decay constant tuning deferred until Phase 1+ radio jitter measured |
| 04 | `04_voting_triangulation_gossip.ipynb` | Cohort-close **range-only voting** (Tier 1 reciprocal-range + Tier 2 MDS multilateration, ADR 0015), reputation gossip, sparkline trace | `range_lie` + `colluder_pair` detection from `tests/eval/test_attack_battery.py`; architectural property at any N from `tests/eval/test_scale.py`; sybil 4:3 ceiling from `tests/eval/test_sybil_scale.py` | `pose_lie` is now a trust-layer no-op (map-merger anomaly only per ADR 0015); 4:3 sybil ceiling sharp not graceful |

### SLAM trunk

| # | Notebook | Covers | Claim cell | Limit cell |
|---|---|---|---|---|
| 05 | `05_sim_and_sensor_realism.ipynb` | `sim/*`, lidar dropouts, IMU bias drift, UWB NLOS multipath | Sensor noise model bounds from ADR 0005 | Simulated noise; no Gazebo PointCloud2 |
| 06 | `06_slam_dead_reckoning_to_scan_match.ipynb` | `DeadReckoningSlam` (negative test) → `ScanMatchSlam` (default) | Drift bound 0.5 m vs 12.95 m at 200 ticks (`tests/eval/test_slam_drift.py`, ADR 0007) | Theta still gyro-driven; no full pose-graph optimization |
| 07 | `07_cooperative_map_merge.ipynb` | `OccupancyMapMerger` trust-weighted fusion, loop closure | Honest 4-peer recall ≥90% / precision ≥95%; adversarial with `peer_weights={liar:0.1}` holds ≥85%/≥90% vs uniform-weight collapse <70% (`tests/eval/test_map_convergence.py`, ADR 0010) | Pose correction out of scope; detection signal is the deliverable |

### Composition + transport

| # | Notebook | Covers | Claim cell | Limit cell |
|---|---|---|---|---|
| 08 | `08_attack_battery_tour.ipynb` | All 12 scripted scenarios (classical + Sybil + SLAM-native) one cell each | Every Byzantine attacker crosses 0.4 detection threshold; SLAM-native within 3–50 ticks | Detection bounds; not pose-correction bounds |
| 09 | `09_full_byzantine_swarm.ipynb` | `unified_demo.py` decomposed: 4 agents, scan-match, map merger, signed bus, gossip, one Byzantine + one liar. Appendix: rerun under `Sros2Bus`. | Full-stack composition: detection holds + map converges. Appendix: same battery within `2 × baseline + 5` ticks under DDS (`tests/test_sros2.py`, ADR 0011) | rclpy required for appendix; phase 1 hardware criteria in `HARDWARE_READINESS.md` |

---

## Visualization plan

Each entry is a high-leverage visualization that reveals a load-bearing
mechanism. Built once in `viz/notebook.py` (W1), called from the listed
notebook. All matplotlib + `ipywidgets.interact` — no new dependencies.

| Notebook | Visualization | Mechanism it reveals |
|---|---|---|
| 03 | Beta(α,β) PDF with sliders for α, β | Prior → posterior intuition. The math doesn't build it; sliding α and watching mass concentrate does. |
| 03 | Decay trajectory plot — α(t), β(t) toward (1,1) with stacked events on a time axis | 10s half-life intuition. The decay constant is invisible in code; visible as a curve. |
| 04 | Cohort-close timeline — observations as colored ticks, cohort closing on later-ts envelope, vote-fire marked | The load-bearing fix from the colluder bug (`6de52c0`). Temporal logic that's hard to read in code. |
| 04 | Range-circle 2D plot — each observer's range to the subject as a circle around the observer; intersection point is the subject, wrong-sized circle is the liar (ADR 0015) | Frame-invariant geometry made visible. Replaces the world-absolute "implied poses" plot since each observer now operates in its own private SLAM frame. |
| 06 | Trajectory comparison — truth + dead-reckoning + scan-match for `bouncing_walls_200t` | The 12.95 m → 0.5 m claim *is* this notebook. Overlaid trajectories beat citing the number. |
| 06 | Two-scan radial-flow diagram — matched beams, Δr arrows, recovered body-frame velocity vector | Core mechanism of scan-match (ADR 0007). One figure makes the LSQ click. |
| 07 | Three-panel heatmap — free-vote layer / occupied-vote layer / `occ > free` binary output | Reveals *how* the merger fuses fragments. Binary grid alone hides the voting mechanism. |
| 07 | Side-by-side merge — `peer_weights={liar:0.1}` vs. uniform weights | The load-bearing demonstration of trust-weighted fusion. Precision collapse is visceral. |
| 08 | Small-multiples 4×3 grid — rep(t) per scenario with attacker line, honest mean, 0.4 threshold | The entire threat-model claim surface in one figure. Reusable as a screenshot in `THREAT_MODEL.md`. |
| 09 | Sim animation (FuncAnimation over `WorldState`) + reputation sparkline (`ReputationTrace`) | Already implicit in the design; listed for completeness. |

### Static asset

`docs/abc_seams.svg` — block diagram of `SensorAdapter`, `LocalSlam`,
`MessageBus`, `MapMerger`, `Telemetry` with data-flow arrows; each ABC labeled
"subclass for hardware port." Embedded in notebook 09 as the hardware-
integrator handover artifact. Static SVG, zero execution cost.

### Out of scope (decorative)

- 3D anything (sim is 2D)
- Per-notebook architecture diagrams (one ABC-seam diagram is enough)
- Force-directed gossip-graph layouts (static circular for N≤6 is enough)
- Polar lidar-dropout plot, IMU random-walk trajectory, gossip topology graph
  — already understandable from code + a claim cell

---

## Implementation slices (in order)

Each slice ends with `pytest -q` green + `ruff check` clean + `PROGRESS.md`
update entry. Same discipline as every other slice.

| # | Slice | Why this order |
|---|---|---|
| **W0** | Reconnaissance + refactor pass on `examples/unified_demo.py`. Extract orchestration helpers (`build_swarm`, `step`, `attach_attack`, `snapshot`) into `examples/_demo_lib.py` (or `src/specter/demo/`). Demo behavior unchanged; headless smoke green; `just demo` unaffected. | Notebook 09 depends on this. **Highest implementation risk** — sizes the entire effort. |
| **W1** | `viz/notebook.py` (~150 LOC): matplotlib `WorldState` snapshot + `FuncAnimation`; Beta-PDF `interact` sliders; α/β decay trajectory plot; cohort-close timeline; triangulation 2D plot; SLAM trajectory overlay; two-scan radial-flow diagram; three-panel merge heatmap; side-by-side merge comparison; small-multiples rep(t) grid; reuse `ReputationTrace` if renderer-agnostic. See § Visualization plan. Plus `docs/abc_seams.svg`. | Inline rendering blocker for notebooks 03–09. |
| **W2** | Notebooks 01 + 02. | Smallest notebooks; validates the cell-type discipline before scaling. |
| **W3** | Notebooks 03 + 04. Sparkline appears here in intuition mode. | Self-contained — toy α/β streams, no sim dep. |
| **W4** | Notebooks 05 + 06. | First use of W1 renderer. |
| **W5** | Notebook 07. | Uses W1; cites `test_map_convergence.py`. |
| **W6** | Notebook 08. | Reuses runner + scenarios; short variants for laptop budget. |
| **W7** | Notebook 09. SROS2 appendix gates on `rclpy` import. | Last; uses W0 helpers + W1 renderer. |
| **W8** | `justfile` `just workshop` target + `[workshop]` extra in `pyproject.toml` (`jupyterlab`, `matplotlib`, `ipywidgets`) + CI gate (`jupyter nbconvert --to notebook --execute notebooks/*.ipynb`). | Workshop becomes a green-light gate, not a maintenance liability. |
| **W9** | `PROGRESS.md` row + ADR 0014 (workshop notebooks as audit surface). | Codifies intuition/claim/limit cell discipline + import-only rule for future contributors. |

---

## Out of scope (YAGNI)

- **No standalone notebook for LossyBus / cadences / time-sync / per-topic
  QoS / decay-window calibration.** They live in ADRs 0008 / 0012 / 0013;
  appendix cells in 06 and 09 reference the calibration tables.
- **No JupyterBook / Binder / Colab hosting.** Laptop-runnable; revisit only
  if external traffic justifies cost.
- **No interactive widgets beyond `matplotlib` + `ipywidgets.interact`.**
- **No notebook 10 covering Phase 3 Gazebo bridge.** Add when that slice
  ships, not before.
- **No deep-dive notebook for security engineers.** Audience 3 is served by
  existing ADRs + `THREAT_MODEL.md`.
- **No parallel "tutorial" reimplementations of trust/SLAM logic outside
  `src/specter/`.**

---

## Open uncertainties

1. **`unified_demo.py` factorability.** 719 LOC, presumably pygame-loop
   centric. If orchestration is interleaved with rendering, W0 grows
   substantially. *Action:* read end-to-end before sizing W0.
2. **`ReputationTrace` coupling.** If pygame-coupled, W1 needs to expose a
   small data accessor before the matplotlib sparkline can land.
3. **Notebook execution time budget.** 12 scenarios in 08 + a 4-agent run in
   09 may exceed 15 min. Mitigation: short scenario variants in-cell, full
   eval as a single reference cell. Same `2 × baseline + 5` discipline the
   SROS2 battery already uses.
4. **CI cost of `nbconvert --execute`.** Adds 2–5 min to the pipeline.
   Acceptable; gate to PRs touching `notebooks/` or `src/specter/**` only.
5. **rclpy-gated UX.** SROS2 appendix cell in 09 must print a clear "install
   `[ros2]` extra" message rather than fail. Mirror the test-suite skip
   convention.

---

## Suggested next action

**W0 reconnaissance.** Read `examples/unified_demo.py` end-to-end and decide
whether it factors cleanly into helpers or whether the workshop needs a small
`src/specter/demo/` package extracted first. That single decision sizes the
entire workshop effort.
