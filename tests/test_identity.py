"""Identity-layer tests: runtime roster, key rotation, revocation, attestation."""

import pytest

from specter.crypto import Keypair
from specter.identity import (
    AttestationRequiredFilter,
    KeyRotationAnnouncement,
    MockAttestationProvider,
    MutableRoster,
    RevocationList,
    apply_rotation,
    filter_envelope,
    sign_rotation,
    verify_rotation,
)
from specter.identity.rotation import rotation_payload
from specter.messages import KIND_POSE, PoseReport, encode
from specter.secure_bus import (
    Identity,
    ReplayWindow,
    Roster,
    VerificationError,
    open_envelope,
)

from tests._helpers import make_identity


# ------------------------------------------------------------------
# US-030: Runtime roster mutation
# ------------------------------------------------------------------


def test_mutable_roster_add_then_envelope_accepted():
    alpha = make_identity("alpha")
    roster = MutableRoster()
    roster.add_peer(alpha.agent_id, alpha.keypair.public_bytes, t_ns=0)
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 1, 2, 0, 1000)), timestamp_ns=1000)
    # Drop-in: open_envelope reads roster.keys[sender_id]
    payload = open_envelope(env, roster, ReplayWindow())  # type: ignore[arg-type]
    assert payload == env.payload


def test_mutable_roster_remove_then_envelope_rejected():
    alpha = make_identity("alpha")
    roster = MutableRoster()
    roster.add_peer(alpha.agent_id, alpha.keypair.public_bytes, t_ns=0)
    roster.remove_peer(alpha.agent_id, t_ns=5_000_000_000)
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)))
    with pytest.raises(VerificationError, match="unknown sender"):
        open_envelope(env, roster, ReplayWindow())  # type: ignore[arg-type]


def test_mutable_roster_lookup_is_time_aware():
    alpha = make_identity("alpha")
    roster = MutableRoster()
    roster.add_peer(alpha.agent_id, alpha.keypair.public_bytes, t_ns=1000)
    roster.remove_peer(alpha.agent_id, t_ns=5000)
    assert roster.lookup("alpha", t_ns=999) is None
    assert roster.lookup("alpha", t_ns=1000) is not None
    assert roster.lookup("alpha", t_ns=4999) is not None
    assert roster.lookup("alpha", t_ns=5000) is None
    assert roster.lookup("alpha", t_ns=10_000) is None


def test_mutable_roster_remove_then_readd_with_new_key():
    from cryptography.hazmat.primitives import serialization

    def to_bytes(pub) -> bytes:
        return pub.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )

    alpha_old = Keypair.generate()
    alpha_new = Keypair.generate()
    roster = MutableRoster()
    roster.add_peer("alpha", alpha_old.public_bytes, t_ns=0)
    roster.remove_peer("alpha", t_ns=5)
    roster.add_peer("alpha", alpha_new.public_bytes, t_ns=10)
    pre_remove = roster.lookup("alpha", t_ns=4)
    assert pre_remove is not None
    assert to_bytes(pre_remove) == alpha_old.public_bytes
    assert roster.lookup("alpha", t_ns=7) is None
    post_readd = roster.lookup("alpha", t_ns=10)
    assert post_readd is not None
    assert to_bytes(post_readd) == alpha_new.public_bytes
    # Drop-in: open_envelope sees the active (new) key in roster.keys
    new = Identity("alpha", alpha_new)
    env = new.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)))
    open_envelope(env, roster, ReplayWindow())  # type: ignore[arg-type]


def test_mutable_roster_events_are_ordered_and_appended():
    roster = MutableRoster()
    a = Keypair.generate()
    b = Keypair.generate()
    roster.add_peer("alpha", a.public_bytes, t_ns=1)
    roster.add_peer("bravo", b.public_bytes, t_ns=2)
    roster.remove_peer("alpha", t_ns=3)
    events = roster.events()
    assert [(e.kind, e.agent_id, e.t_ns) for e in events] == [
        ("add", "alpha", 1),
        ("add", "bravo", 2),
        ("remove", "alpha", 3),
    ]


# ------------------------------------------------------------------
# US-031: Key rotation protocol
# ------------------------------------------------------------------


def test_rotation_announcement_signed_by_old_key_accepted():
    old = Keypair.generate()
    new = Keypair.generate()
    ann = KeyRotationAnnouncement(
        agent_id="alpha",
        old_pubkey=old.public_bytes,
        new_pubkey=new.public_bytes,
        effective_t_ns=1000,
    )
    sig = sign_rotation(ann, old)
    assert verify_rotation(ann, sig, t_ns=900) is True


def test_rotation_announcement_signed_by_random_key_rejected():
    old = Keypair.generate()
    new = Keypair.generate()
    rogue = Keypair.generate()
    ann = KeyRotationAnnouncement(
        agent_id="alpha",
        old_pubkey=old.public_bytes,
        new_pubkey=new.public_bytes,
        effective_t_ns=1000,
    )
    sig = rogue.sign(rotation_payload(ann))
    assert verify_rotation(ann, sig, t_ns=900) is False


def test_apply_rotation_swaps_active_key_at_effective_t():
    old = Keypair.generate()
    new = Keypair.generate()
    roster = MutableRoster()
    roster.add_peer("alpha", old.public_bytes, t_ns=0)
    ann = KeyRotationAnnouncement(
        agent_id="alpha",
        old_pubkey=old.public_bytes,
        new_pubkey=new.public_bytes,
        effective_t_ns=1000,
    )
    apply_rotation(roster, ann, t_ns=500)
    # New key seals envelope after effective_t_ns — accepted
    new_ident = Identity("alpha", new)
    env_new = new_ident.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=2000)
    roster.verify_envelope(env_new, ReplayWindow())


def test_old_key_after_rotation_rejected_as_key_revoked_post_rotation():
    """Old key envelope post-rotation rejected with explicit category."""
    old = Keypair.generate()
    new = Keypair.generate()
    roster = MutableRoster()
    roster.add_peer("alpha", old.public_bytes, t_ns=0)
    ann = KeyRotationAnnouncement(
        agent_id="alpha",
        old_pubkey=old.public_bytes,
        new_pubkey=new.public_bytes,
        effective_t_ns=1000,
    )
    apply_rotation(roster, ann, t_ns=500)
    old_ident = Identity("alpha", old)
    env_old = old_ident.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=2000)
    with pytest.raises(VerificationError, match="key_revoked_post_rotation"):
        roster.verify_envelope(env_old, ReplayWindow())


def test_rotation_grace_window_rejects_far_past_effective():
    old = Keypair.generate()
    new = Keypair.generate()
    ann = KeyRotationAnnouncement(
        agent_id="alpha",
        old_pubkey=old.public_bytes,
        new_pubkey=new.public_bytes,
        effective_t_ns=0,
    )
    sig = sign_rotation(ann, old)
    # effective_t_ns=0; t_ns=1 year of ns >> 30-day grace → rejected
    one_year_ns = 365 * 24 * 60 * 60 * 1_000_000_000
    assert verify_rotation(ann, sig, t_ns=one_year_ns) is False


# ------------------------------------------------------------------
# US-032: Revocation list
# ------------------------------------------------------------------


def test_revocation_list_basic_revoke_and_check():
    a = Keypair.generate()
    rev = RevocationList()
    assert rev.is_revoked(a.public_bytes, t_ns=1000) is False
    rev.revoke(a.public_bytes, t_ns=500)
    assert rev.is_revoked(a.public_bytes, t_ns=1000) is True


def test_revocation_is_forward_only():
    a = Keypair.generate()
    rev = RevocationList()
    rev.revoke(a.public_bytes, t_ns=500)
    # Envelope with timestamp before revocation: not revoked
    assert rev.is_revoked(a.public_bytes, t_ns=499) is False
    # At or after: revoked
    assert rev.is_revoked(a.public_bytes, t_ns=500) is True
    assert rev.is_revoked(a.public_bytes, t_ns=10_000) is True


def test_filter_envelope_rejects_revoked_key():
    alpha = make_identity("alpha")
    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    rev = RevocationList()
    rev.revoke(alpha.keypair.public_bytes, t_ns=500)
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1000)
    with pytest.raises(VerificationError, match="key_revoked"):
        filter_envelope(env, roster, rev)


def test_filter_envelope_passes_non_revoked_key():
    alpha = make_identity("alpha")
    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    rev = RevocationList()
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1000)
    filter_envelope(env, roster, rev)  # no raise


def test_filter_envelope_passes_when_revocation_after_envelope_ts():
    alpha = make_identity("alpha")
    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    rev = RevocationList()
    rev.revoke(alpha.keypair.public_bytes, t_ns=2000)
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1000)
    filter_envelope(env, roster, rev)  # envelope predates revocation → passes


# ------------------------------------------------------------------
# US-033: Hardware attestation
# ------------------------------------------------------------------


def test_attested_key_passes_filter():
    alpha = make_identity("alpha")
    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    rev = RevocationList()
    attestor = MockAttestationProvider({alpha.keypair.public_bytes})
    f = AttestationRequiredFilter(roster, rev, attestor)
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1000)
    f.check(env)  # no raise


def test_unattested_key_rejected_with_unattested_category():
    alpha = make_identity("alpha")
    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    rev = RevocationList()
    attestor = MockAttestationProvider(allowlist=set())  # nobody attested
    f = AttestationRequiredFilter(roster, rev, attestor)
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1000)
    with pytest.raises(VerificationError, match="unattested_key"):
        f.check(env)
