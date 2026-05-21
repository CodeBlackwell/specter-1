# Security Policy

## Reporting a vulnerability

Email **codeblackwell@gmail.com** with subject `[specter-1 security]`.
Please do not open public GitHub issues for security-sensitive reports.

Include:
- Affected component (signed bus, evaluator, MDS module, transport, ROS 2 node, etc.)
- Repro steps or proof-of-concept (a `tests/eval/` scenario is ideal)
- Suggested fix or mitigation, if known

Expect an acknowledgement within 7 days.

## Scope and posture

SPECTER-1 is a **research demonstrator and workshop curriculum**, not a
production trust layer. The crypto primitives are conventional (P-256 ECDSA
via the [`cryptography`](https://cryptography.io) library, SHA-256), but the
system as a whole has documented limits:

- See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the audited list of
  attacks the project measurably resists, the scenarios that prove each
  claim, and the empirical bounds.
- See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) § "Out of scope" for
  attack classes intentionally not addressed.
- See [`docs/HARDWARE_READINESS.md`](docs/HARDWARE_READINESS.md) for the
  phased path from simulation to hardware, including the Phase 4
  ATECC608A / TPM hardware-attestation roadmap.

If you find a way to break a stated measured bound — that is a vulnerability
worth reporting. If you find that an out-of-scope attack works — that is
expected behavior; please file a feature request or open a discussion
instead.

## Disclosure

Once a fix is available (or the report is determined out of scope), we
coordinate a disclosure timeline together. Default is 90 days from report.
