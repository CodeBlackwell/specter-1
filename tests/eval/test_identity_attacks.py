"""Identity-layer red-team scenarios.

Two attack classes that the trust-only engine can't catch by itself —
they need the identity layer (revocation, attestation) to compose with
envelope verification:

  1. revoked_compromise — a peer's private key leaks; operator revokes
     the pubkey at tick T; all post-T envelopes from that key are
     rejected before reaching the trust evaluator.

  2. attestation_blocks_sybil_minting — V2 sybil residual: a compromised
     honest robot mints sybils. Without attestation the sybils' valid
     signatures pass the bus and feed mutual-corroboration into the
     trust evaluator. With AttestationRequiredFilter and only the
     original honest pubkeys in the allowlist, the minted sybils are
     rejected at the filter — they never reach the evaluator.

These tests are self-contained (don't drive `runner.py`) so they can
focus on the identity-layer composition without re-asserting the full
trust-detection battery.
"""

import pytest

from specter.crypto import Keypair
from specter.identity import (
    AttestationRequiredFilter,
    MockAttestationProvider,
    RevocationList,
    filter_envelope,
)
from specter.messages import KIND_OBSERVATION, KIND_POSE, Observation, PoseReport, encode
from specter.secure_bus import (
    Identity,
    ReplayWindow,
    Roster,
    VerificationError,
    open_envelope,
)


def _identity(agent_id: str) -> Identity:
    return Identity(agent_id=agent_id, keypair=Keypair.generate())


# ------------------------------------------------------------------
# US-032 — revoked compromised peer
# ------------------------------------------------------------------


def test_revoked_compromised_key_rejected_post_revocation():
    """Compromised peer's envelopes pass before revocation, rejected after.

    Models an operator detecting key exfiltration mid-mission and
    pushing a revocation entry. Pre-revocation envelopes already on the
    wire stay valid (forward-only revocation); subsequent envelopes from
    the same key are dropped by `filter_envelope` before reaching the
    trust evaluator.
    """
    alpha, bravo, charlie = _identity("alpha"), _identity("bravo"), _identity("charlie")
    roster = Roster()
    for ident in (alpha, bravo, charlie):
        roster.add(ident.agent_id, ident.keypair.public_bytes)
    rev = RevocationList()
    replay = ReplayWindow()

    accepted_pre, accepted_post, rejected = 0, 0, 0
    revoke_at_tick = 5
    n_ticks = 10

    for tick in range(1, n_ticks + 1):
        ts = tick * 1_000_000_000

        # Operator revokes alpha's compromised key at tick T (timestamped at T).
        if tick == revoke_at_tick:
            rev.revoke(alpha.keypair.public_bytes, t_ns=ts)

        for ident in (alpha, bravo, charlie):
            env = ident.seal(KIND_POSE, encode(PoseReport(ident.agent_id, 0, 0, 0, ts)), timestamp_ns=ts)
            try:
                filter_envelope(env, roster, rev)
                open_envelope(env, roster, replay)
            except VerificationError as e:
                assert ident.agent_id == "alpha", f"non-attacker rejected: {ident.agent_id}: {e}"
                assert "key_revoked" in str(e)
                rejected += 1
                continue
            if ident.agent_id == "alpha":
                if tick < revoke_at_tick:
                    accepted_pre += 1
                else:
                    accepted_post += 1

    assert accepted_pre == revoke_at_tick - 1, "alpha pre-revocation envelopes should pass"
    assert accepted_post == 0, "alpha post-revocation envelopes must be rejected"
    assert rejected == n_ticks - revoke_at_tick + 1, "post-T envelopes (T inclusive) all rejected"


def test_revocation_does_not_affect_other_peers():
    """Revoking alpha's key has no effect on bravo's envelopes."""
    alpha, bravo = _identity("alpha"), _identity("bravo")
    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    roster.add(bravo.agent_id, bravo.keypair.public_bytes)
    rev = RevocationList()
    rev.revoke(alpha.keypair.public_bytes, t_ns=0)

    env_alpha = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 1000)), timestamp_ns=1000)
    env_bravo = bravo.seal(KIND_POSE, encode(PoseReport("bravo", 0, 0, 0, 1000)), timestamp_ns=1000)

    with pytest.raises(VerificationError, match="key_revoked"):
        filter_envelope(env_alpha, roster, rev)
    filter_envelope(env_bravo, roster, rev)  # no raise


# ------------------------------------------------------------------
# US-033 — attestation blocks sybil minting from a compromised peer
# ------------------------------------------------------------------


def test_attestation_blocks_sybil_minting_from_compromised_robot():
    """V2 sybil residual closed by attestation (in software, mock impl).

    Setup: 3 honest robots (alpha, bravo, charlie) with hardware-attested
    keys. The attacker compromises alpha and mints 5 sybils — generates
    fresh keypairs and inserts them into the roster (the cabal's
    advantage in the V2 attack model). Each sybil publishes mutual
    corroboration of every other sybil + a fake pose-lie observation
    of alpha.

    Without `AttestationRequiredFilter`: every sybil envelope passes the
    bus (valid signature, in-roster sender). The trust evaluator must
    then defend against the cabal alone — the V2 residual.

    With `AttestationRequiredFilter` (allowlist = original 3 honest
    keys): every sybil envelope is rejected at the filter with category
    `unattested_key`. Sybils never reach the trust evaluator.
    """
    honest = [_identity("alpha"), _identity("bravo"), _identity("charlie")]
    sybils = [_identity(f"sybil_{i}") for i in range(5)]

    roster = Roster()
    for ident in honest + sybils:
        roster.add(ident.agent_id, ident.keypair.public_bytes)

    # Attestation: only the 3 original honest hardware-bound keys.
    allowlist = {ident.keypair.public_bytes for ident in honest}
    attestor = MockAttestationProvider(allowlist=allowlist)
    rev = RevocationList()
    f = AttestationRequiredFilter(roster=roster, revocation=rev, attestation=attestor)

    sybil_rejected = 0
    sybil_accepted = 0
    honest_accepted = 0
    honest_rejected = 0

    for ident in honest + sybils:
        env = ident.seal(KIND_POSE, encode(PoseReport(ident.agent_id, 0, 0, 0, 1000)), timestamp_ns=1000)
        try:
            f.check(env)
        except VerificationError as e:
            assert "unattested_key" in str(e)
            if ident in sybils:
                sybil_rejected += 1
            else:
                honest_rejected += 1
            continue
        if ident in sybils:
            sybil_accepted += 1
        else:
            honest_accepted += 1

    assert sybil_rejected == len(sybils), "every sybil rejected at attestation filter"
    assert sybil_accepted == 0
    assert honest_accepted == len(honest), "honest robots pass the filter"
    assert honest_rejected == 0


def test_sybil_observations_blocked_before_reaching_evaluator():
    """End-to-end: with attestation, mutual-corroboration observations
    minted by sybils never reach the bus's payload-decoding path. The
    trust evaluator's view of the world contains only honest envelopes.
    """
    honest = [_identity("alpha"), _identity("bravo")]
    sybils = [_identity(f"sybil_{i}") for i in range(3)]
    roster = Roster()
    for ident in honest + sybils:
        roster.add(ident.agent_id, ident.keypair.public_bytes)

    allowlist = {ident.keypair.public_bytes for ident in honest}
    f = AttestationRequiredFilter(
        roster=roster, revocation=RevocationList(),
        attestation=MockAttestationProvider(allowlist=allowlist),
    )

    delivered: list[bytes] = []
    for sybil in sybils:
        # Each sybil publishes mutual observations of the other sybils — the
        # cabal-internal corroboration that would defeat the trust engine
        # if it reached the evaluator.
        for peer in sybils:
            if peer.agent_id == sybil.agent_id:
                continue
            # range_m=0.14, bearing_rad=π/4 — cabal-internal fake corroboration.
            obs = Observation(sybil.agent_id, peer.agent_id, 0.14, 0.785, 1000)
            env = sybil.seal(KIND_OBSERVATION, encode(obs), timestamp_ns=1000)
            try:
                f.check(env)
                delivered.append(env.payload)
            except VerificationError:
                pass

    assert delivered == [], "no sybil-minted observations reach the evaluator"
