ADR 0014: Workshop notebooks as audit surface
================================================

Status: Accepted (2026-05-05)

Context
-------

`README.md` declares specter-1 a "demonstrator and workshop curriculum."
With Wave-3 polish closed, every shipped capability (signed envelopes,
identity lifecycle, Beta + decay, voting/triangulation/gossip, sim +
sensor realism, scan-match SLAM, cooperative map merger, SROS2 transport)
has at least one `tests/eval/` scenario asserting a measured bound.

The workshop notebooks (`notebooks/01_*.ipynb` … `notebooks/09_*.ipynb`)
decompose `examples/unified_demo.py` into a layered narrative tied to
those bounds. They are part of the release artifact, not a side project.

Decision
--------

The notebook curriculum is governed by four rules:

1. **Import-only.** Notebooks `import specter.*`; no inlined library
   logic. Prevents rot when the library evolves. Orchestration helpers
   live in `src/specter/demo/`; visualization helpers live in
   `src/specter/viz/notebook.py`. Both are part of the public surface.

2. **Three cell types per notebook.**
   - **Intuition** — plot, inspect, single-message demo. Uses real
     library types; no inlined math.
   - **Claim** — call an existing `tests/eval/` test (or a short variant
     of it) and reference the asserted bound. Every notebook has at
     least one. **No claims without measurements.**
   - **Limit** — link the section in `THREAT_MODEL.md` /
     `HARDWARE_READINESS.md` / an ADR that owns the residual gap. Every
     notebook has at least one. No overselling.

3. **rclpy graceful degradation.** SROS2 cells gate on `import rclpy`.
   When absent, print a clear "install the `[ros2]` extra" message and
   skip without failing. Mirrors the test-suite skip convention.

4. **CI gates `nbconvert --execute`.** `.github/workflows/ci.yml` runs
   `MPLBACKEND=Agg jupyter nbconvert --to notebook --execute` on every
   notebook on every PR. The notebook job has a 15-minute wall-clock
   budget; long eval scenarios run as short variants in-cell.

Consequences
------------

Workshop drift surfaces immediately. A library refactor that breaks an
ABC seam fails CI on the notebook job, so the contract is enforceable.
The notebooks become discoverable spec for hardware integrators
(audience priority 1 in `docs/WORKSHOP_OUTLINE.md`).

The ABC-seam diagram (`docs/abc_seams.svg`, embedded in notebook 09)
is the canonical hardware-integration handover artifact: subclass the
boxes marked `<< PORT >>` to run the demonstrator on TurtleBot4 /
Crazyflie+UWB. Other boxes (trust + voting + map merger) stay
unchanged across the port.

Five small library accessors were added for visualization:

- `BetaTrustEvaluator.cohort_events()` — cohort-close events for
  notebook 04's timeline figure.
- `BetaTrustEvaluator.pending_cohorts()` — read accessor for notebook
  04's triangulation 2D figure.
- `ScanMatchSlam.matched_pairs()` (opt-in via `record_pairs=True`) —
  matched-beam tuples for notebook 06's radial-flow diagram.
- `OccupancyMapMerger.merge_with_votes()` — three-layer return for
  notebook 07's heatmap.
- `run_scenario(traces=...)` — optional per-viewer trace recording for
  notebook 08's small-multiples grid.

All additive; no signature change to existing methods. Tests live in
`tests/test_workshop_accessors.py`.

Revisit when
------------

- Phase-1 hardware ships (Gazebo + ROS2). Add notebook 10 covering the
  Gazebo bridge; replace simulated noise with replay logs.
- A new shipped capability needs its own notebook. Default to *no* —
  prefer extending an existing notebook unless the topic earns its own
  audience hour.
- The notebook job's wall-clock budget exceeds 15 minutes consistently.
  Investigate scenario-variant tightening before adding parallelism.
