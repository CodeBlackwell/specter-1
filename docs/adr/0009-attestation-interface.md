ADR 0009: Hardware attestation interface
==========================================

Status: Accepted (2026-05-05)

Context
-------

`THREAT_MODEL.md` lists "Hardware key compromise → Sybil minting" as a
known limit: the V2 self-anchored beacon-presence rule (`evaluator.py`)
catches sybils that lack a physical body, but it cannot catch sybils
*minted by a peer that holds a real, in-roster compromised key*. Such
sybils inherit the compromised peer's signing authority — their
envelopes are cryptographically valid and would be accepted by the bus
into the trust evaluator.

The standard fix is hardware-bound keys: an ATECC608A, TPM 2.0, or
ARM Secure Enclave provably attests that a private key was generated
inside the device and cannot be extracted. Software-minted sybils
created on a compromised host cannot produce equivalent attestations.

Phase 1 cannot ship the hardware path (target ATECC608A integration is
Phase 4 per ADR 0006). This ADR specifies the *interface* now so the
trust path can be wired against it; the real implementation slots in
behind the same ABC later.

Decision
--------

`src/specter/identity/attestation.py` defines:

```python
class AttestationProvider(ABC):
    def is_attested(self, public_key_bytes: bytes) -> bool: ...
```

A boolean return shape — not a richer attestation document — for three
reasons:

1. The trust path needs a single yes/no decision at the bus boundary.
   Trust evaluators don't reason about *why* a key is attested; they
   only need to know whether the envelope should reach them.
2. Real hardware attestation flows (TPM PCR quotes, SE certificates)
   are evaluated *once* at roster admission time, not per-envelope. The
   provider caches the verdict; per-envelope cost stays at hash-table
   lookup speed (≈O(1)).
3. A wider interface (return certificate chain, return PCR values)
   forces every consumer to handle hardware-specific fields, defeating
   the abstraction. Surface those via a separate
   `AttestationProvider.evidence(pubkey)` if a future deployer needs
   audit trails — out of scope for Phase 1.

`MockAttestationProvider(allowlist: set[bytes])` is the test stand-in:
a key is attested iff its bytes are in the allowlist. Eval scenarios
seed the allowlist with the original honest fleet's pubkeys; sybils
minted at runtime fail the check by construction.

`AttestationRequiredFilter` composes attestation with revocation and
roster lookup at the bus boundary:

```
filter_envelope (revocation) → roster.lookup → attestation.is_attested
```

Failures raise `VerificationError` with category `unattested_key`. This
sits *in front of* `open_envelope` so unattested envelopes never reach
the trust evaluator's record-paths.

How a real TPM/SE implementation would look (Phase 3+)
------------------------------------------------------

A `TPMAttestationProvider` would:

1. At roster admission, request a PCR quote from each peer's TPM,
   verify the quote against a known-good attestation key (AK)
   certificate chain rooted at a manufacturer or operator CA.
2. Bind the verified peer's signing pubkey to the attested AK chain
   (TPM 2.0 supports certify-key-with-AK).
3. Cache the verdict keyed by the signing pubkey bytes; return True
   from `is_attested` on cache hit, False otherwise.
4. Periodically re-verify (PCR quotes time out under TPM policy).

For ATECC608A on Crazyflie+UWB swarms, the simpler equivalent is the
device's signed compressed certificate slot — the public key is
provisioned with a manufacturer-signed certificate that the operator's
CA trusts. The provider becomes a chain-of-trust check against the
on-device cert.

Either way, the boolean return shape stays the same; the heavy lifting
moves into provider construction (one-shot per peer admission), not the
hot path.

Why this closes the V2 residual
-------------------------------

V2 self-anchoring (`evaluator.py`) catches sybils that lack physical
presence — honest robots' real beacons never list a body-less sybil as
a subject. The cabal-internal mutual-corroboration variant
(`sybil_flood_mutual`) is bounded but not crushed at extreme ratios
(rep 0.28 at 25:3) because mutual β piles up.

Attestation cuts the attack at a different layer: even if a compromised
real robot mints sybils that *would* survive the trust path, those
sybils' keys are not in the allowlist (they were generated on a
compromised host, not on attested hardware). They never reach the
trust evaluator.

Combined: V2 catches body-less sybils; attestation catches signature-
valid-but-software-minted sybils. The residual that remains is a
physically present compromised peer publishing from its own attested
key — that's a Byzantine-honest-majority problem, not an identity
problem, and is bounded by roster sizing.

Consequences
------------

Positive:
- Identity layer composes cleanly at the bus boundary; trust path is
  agnostic to whether attestation is real or mock.
- Phase 4 hardware integration is a drop-in: implement
  `AttestationProvider`, swap the mock in `AttestationRequiredFilter`'s
  construction, no other changes.
- Eval harness can now express the V2 residual scenario *and* its
  resolution: same scenario, two filter configurations.

Negative:
- `MockAttestationProvider` is an obvious test stand-in. A deployer
  who wires it into production gets no real attestation guarantee.
  Treat the mock as a development-only artifact; document this in the
  filter's docstring.
- The boolean shape doesn't carry attestation evidence. If audit logs
  need "this key was attested by TPM PCR X at time T", a separate
  evidence API is required — defer until a real consumer asks.

Revisit when
------------

- Phase 4 hardware lands and a `TPMAttestationProvider` /
  `ATECC608AAttestationProvider` is implemented; this ADR documents
  the contract that those will satisfy.
- Multi-tenant deployments require per-roster attestation policies
  (different operator CAs per fleet). The provider grows from a flat
  allowlist to a policy-driven check.
- Hardware key rotation needs to coordinate with the rotation protocol
  (`rotation.py`); today the two are independent and a rotation
  announcement does not re-trigger attestation.
