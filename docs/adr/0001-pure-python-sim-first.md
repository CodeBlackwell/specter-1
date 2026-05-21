ADR 0001: Pure-Python 2D sim before ROS2/Gazebo
================================================

Status: Accepted (2026-05-02)

Context
-------

The roadmap requires algorithmic IP (trust engine, consensus, map merge) to be developed and validated before being ported to a high-fidelity simulator (Phase 03) and hardware (Phase 04).

Two paths considered:
1. Start directly in ROS2 + Gazebo. Realistic from day one.
2. Start in a 2D pure-Python sim with full observability and deterministic seeding.

Decision
--------

Path 2. The trust engine is the project's core IP and must be debuggable down to the message. Realistic dynamics introduce noise that confounds early algorithm debugging.

Consequences
------------

Positive:
- Iteration speed: tests run in milliseconds, not seconds.
- Deterministic regression: same seed = same byte-for-byte trace.
- Algorithm bugs surface as algorithm bugs, not physics bugs.

Negative:
- Phase 03 will discover bugs that only physics surfaces.
- Risk of building a sim-only abstraction that does not survive the port.

Mitigation:
- Module ABCs designed to wrap ROS2 lifecycle nodes unchanged. Code written in Phase 01 must run unmodified under ROS2 in Phase 03 (this is the Phase 03 exit gate).
