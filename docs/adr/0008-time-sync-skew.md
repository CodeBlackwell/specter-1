ADR 0008: Time-sync model — envelope timestamp skew threshold
================================================================

Status: Accepted (2026-05-05)

Context
-------

`Envelope.timestamp_ns` is set by the sender at `Identity.seal` time and
verified at the receiver only by signature integrity (the hash binds the
field). The replay window enforces strict-monotonic per-sender nonces but
does *not* compare timestamps to the receiver's wall clock. A peer with
a wildly skewed clock — accidental or adversarial — can therefore stamp
envelopes far in the future to game cohort-close timing, or far in the
past to manipulate decay accounting.

Wave 1 introduces `validate_timestamp(envelope_ts_ns, wall_clock_ns,
max_skew_ns)` (`src/specter/transport/time_sync.py`) as an outer filter
in front of the replay window. It is callable but not yet wired into the
existing bus flow — sros2-agent (Wave 2, US-042/US-043) integrates it at
the DDS receive point.

Decision
--------

Default `max_skew_ns = 5_000_000_000` (5 seconds).

Rejection categories surface in the `VerificationError` message:
- ``clock_skew_future``: envelope timestamp > wall clock + threshold.
- ``clock_skew_past``: envelope timestamp < wall clock − threshold.

Why 5 seconds
-------------

- The cohort-close window in the trust evaluator operates on sub-second
  to single-second granularity (cohort defined by sim-tick or beacon
  cadence at 10 Hz). 5 s is comfortably above any legitimate inter-tick
  jitter caused by network latency or scheduling.
- Real-world NTP-synchronized peers typically maintain skew well under
  100 ms in benign conditions; PTP brings this under a millisecond. 5 s
  is roughly two orders of magnitude above the worst-case benign skew —
  enough to be safely unambiguous about "this is a fault or attack."
- Packet jitter under Wave 1's `LossyBus` defaults (`jitter_max_ms=10`)
  is bounded at 10 ms, far below 5 s, so legitimate buffered envelopes
  do not approach the threshold.
- A future peer claim of +5 s gives an attacker about one cohort cycle
  of head-start to game timing. Tightening below 1 s without proper
  clock synchronization (PTP) would risk false-rejecting honest peers
  whose system clocks drift normally between NTP refreshes.

Consequences
------------

Positive:
- A peer cannot trivially advance other peers' cohort-close timing by
  forward-stamping envelopes — the receiver rejects them outright.
- Past-stamped envelopes that escape the replay window (e.g. captured
  before the receiver started a fresh `ReplayWindow`) get a second
  defensive check.
- Categories are machine-readable: telemetry in Wave 0's anomaly schema
  can route ``clock_skew_*`` alongside ``signature_invalid`` etc.

Negative:
- Wall-clock dependency at the receiver. Two peers without a shared
  time source (no NTP, no PTP, no GPS PPS) cannot exchange envelopes
  even if both are honest.
- The threshold is configurable but lives outside the envelope wire
  format. A ROS2 deployment that operates with looser clocks must
  override per-receiver.

Revisit when
------------

- Hardware port runs without NTP and skew floors above 5 s. Either
  rationalize a higher threshold or add a clock-discipline step before
  bus startup.
- The trust engine's cohort-close window tightens below ~1 s. The 5 s
  threshold becomes the dominant attack window and should drop in
  proportion.
- Sros2-agent integrates this at DDS receive — measure false-reject rate
  under realistic peer-clock variance and tune.
