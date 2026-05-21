ADR 0002: ECDSA P-256 signing + Beta-reputation scoring
========================================================

Status: Accepted (2026-05-02)

Context
-------

Trust engine needs (a) per-message authenticity and (b) per-peer reputation accumulation.

Decision
--------

a) ECDSA over NIST P-256 via `cryptography.hazmat`. Selected because:
- Maps directly to ATECC608A hardware secure element on the demonstrator (Phase 04).
- Supported by SROS2 PKI overlay (Phase 03).
- Standard library, no custom primitives (Annex C).

b) Beta-reputation as the per-peer scoring substrate. Each peer maintains `(alpha, beta)` per other peer; positive evidence increments alpha, negative increments beta. Reputation = `alpha / (alpha + beta)`. Selected because:
- Closed-form Bayesian update.
- Adapts to streaming observations naturally.
- Well-studied in the multi-agent trust literature.

Consequences
------------

Positive:
- Hardware path is direct: same algorithm, just key handle changes.
- No custom crypto primitives to audit.

Negative:
- Beta-reputation has known cold-start sensitivity. Mitigation: bootstrap priors per ADR 0003 (TBD) when reputation behavior is tuned.
