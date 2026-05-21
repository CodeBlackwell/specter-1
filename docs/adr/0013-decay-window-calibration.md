ADR 0013: Decay-window calibration outcomes
==============================================

Status: Accepted (2026-05-05)

Context
-------

`BetaTrustEvaluator` uses two timing constants:

- `DECAY_HALF_LIFE_NS = 10_000_000_000` (10 s) — exponential decay of
  evidence above the prior, so old behavior fades and a peer that stops
  misbehaving rehabilitates over a few half-lives.
- Cohort-close window — a `(subject, ts)` cohort is voted on only when
  an envelope with strictly later `ts` arrives. The implicit "window" is
  the gap between successive ticks; under jittered transport, this gap
  becomes variable.

Both were sim-tuned on a zero-loss `InProcessBus`. Wave 1's `LossyBus`
exposes realistic packet jitter; Wave 2's SROS2 swap exposes real DDS
round-trip times. Before tuning, we needed evidence: at what jitter does
the current decay/window first fail to absorb the perturbation?

Method
------

`tests/eval/test_calibration.py::test_decay_window_jitter_inflection`
runs `single_pose_liar` (the canonical fast-detection scenario, baseline
detection tick = 2) under `LossyBus(jitter_max_ms=ms, drop_prob=0.0)`
for `ms ∈ {1, 5, 10, 25, 50, 100}` with a fixed seed (1729) for
reproducibility. Drop probability is held at zero to isolate jitter as
the variable; loss is already covered by the US-023 battery test.

For each `ms`, the test records the detection tick and the ratio
vs the no-jitter baseline. The inflection point is the smallest jitter
where the ratio first crosses 2× baseline.

Outcome
-------

Measured 2026-05-05 on the `single_pose_liar` scenario, seed 1729:

| jitter_ms | detect_tick | ratio_vs_baseline |
|---:|---:|---:|
| 1 | 2 | 1.00× |
| 5 | 2 | 1.00× |
| 10 | 1 | 0.50× |
| 25 | 2 | 1.00× |
| 50 | 3 | 1.50× |
| 100 | 5 | 2.50× |

(baseline detection tick = 2, no jitter)

**Inflection: ~100 ms.** The current `DECAY_HALF_LIFE_NS = 10s` and
implicit cohort-close window absorb up to ~50 ms of per-message jitter
without crossing the 2× baseline detection-latency budget. At 100 ms
jitter — comparable to a degraded WiFi mesh or worst-case UWB
multipath — detection latency reaches 2.5× baseline.

The 10 ms row showing detection at tick 1 (faster than baseline) is a
sampling artifact: small jitter values reorder a handful of envelopes
in a way that closes the first cohort one tick earlier. It does *not*
indicate that jitter improves detection — repeated runs at different
seeds show variance ±1 tick at low jitter.

Decision
--------

**No constant changes ship in this PRD.** The 100 ms inflection is the
worst-case sim jitter the current decay/window can absorb; it is *not*
a measurement of real-radio jitter. The tuning question is:

1. What is the actual per-message jitter on the target radio
   (TurtleBot4 WiFi, Crazyflie+UWB)? Phase 1+ instrumentation will
   measure this.
2. Once measured, does the inflection sit comfortably above the
   measured jitter? If yes, no tuning needed. If no, the cohort-close
   window should grow proportionally (decay half-life is a separate
   knob — it controls rehabilitation speed, not vote correctness).

The output of this slice is the calibration *evidence*. The follow-on
slice — once Phase 1 hardware data exists — is constant tuning.

Consequences
------------

Positive:
- We have a numerical bound on what the current implementation absorbs.
- The test stays in CI as a regression guard: if a future change
  reduces this margin (e.g., shrinks the implicit cohort window), the
  printed table makes the regression visible.
- `docs/HARDWARE_READINESS.md` row "Decay-window / cohort-close
  calibration vs real radio jitter" can promote from "open" to "evidence
  in `tests/eval/test_calibration.py`; tuning pending hardware data".

Negative:
- The measurement is sim-only. Real radio jitter is non-uniform
  (bursty, NLOS-correlated) and the per-message uniform-distribution
  model in `LossyBus` is a simplification.
- Single-scenario sweep. `single_pose_liar` was chosen because its
  baseline is fast and its (then-current) detection mechanism — voting
  on closed cohorts — was the one most sensitive to cohort-window width.
  Other scenarios (e.g. `gradient_drift`) accumulate β over many
  ticks and are less sensitive to per-cohort timing — including them
  would dilute the signal we're trying to measure.

  *Amendment (2026-05-15)*: ADR 0015 reclassifies `pose_lie` as a
  trust-layer no-op (`single_pose_liar` no longer crosses 0.4 at the
  trust layer). Re-run the sweep against `range_lie` (Tier 1 reciprocal
  check, equally fast baseline) once real-radio jitter measurements
  motivate retuning. The methodology (single fast-detect scenario across
  the jitter sweep) is unchanged.

Revisit when
------------

- Phase 1+ Gazebo or Phase 2 TurtleBot4 produces real jitter
  measurements — at that point, decide whether to ship updated
  constants based on measured-vs-inflection margin.
- A new attack scenario is added whose detection depends critically on
  cohort-window timing; add it to the calibration sweep.
