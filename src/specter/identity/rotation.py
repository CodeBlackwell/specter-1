"""Key rotation protocol.

A peer publishes a `KeyRotationAnnouncement` signed by its OLD key. After
verification, the roster swaps the peer's accepted key from the old
pubkey to the new pubkey at `effective_t_ns`. Envelopes signed by the
old key after that instant are rejected as `key_revoked_post_rotation`
via `MutableRoster.verify_envelope`.

Real fleets need rotation for any deployment past a few weeks; this is
the standard cryptographic design (sign the new key with the old key).
"""

import json
from dataclasses import asdict, dataclass

from ..crypto import Keypair, public_from_bytes, verify
from .roster_runtime import MutableRoster

ROTATION_GRACE_NS = 60 * 60 * 24 * 30 * 1_000_000_000  # 30 days


@dataclass(frozen=True)
class KeyRotationAnnouncement:
    agent_id: str
    old_pubkey: bytes
    new_pubkey: bytes
    effective_t_ns: int


def rotation_payload(ann: KeyRotationAnnouncement) -> bytes:
    """Canonical-JSON byte form of an announcement (signed body)."""
    body = asdict(ann)
    body["old_pubkey"] = ann.old_pubkey.hex()
    body["new_pubkey"] = ann.new_pubkey.hex()
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode()


def sign_rotation(ann: KeyRotationAnnouncement, old_keypair: Keypair) -> bytes:
    return old_keypair.sign(rotation_payload(ann))


def verify_rotation(ann: KeyRotationAnnouncement, old_signature: bytes, t_ns: int) -> bool:
    """True iff `old_signature` is a valid signature by `old_pubkey` over
    the announcement, AND `effective_t_ns` is within the grace window
    relative to `t_ns` (forward, or no further than ROTATION_GRACE_NS in
    the past — protects against ancient announcements being replayed)."""
    if ann.effective_t_ns < t_ns - ROTATION_GRACE_NS:
        return False
    try:
        pub = public_from_bytes(ann.old_pubkey)
    except Exception:
        return False
    return verify(pub, rotation_payload(ann), old_signature)


def apply_rotation(
    mutable_roster: MutableRoster,
    announcement: KeyRotationAnnouncement,
    t_ns: int,
) -> None:
    """Swap the peer's accepted key at `announcement.effective_t_ns`.

    The old pubkey is recorded in the roster's rotation history so that
    `MutableRoster.verify_envelope` can reject any envelope subsequently
    signed by the old key with the explicit `key_revoked_post_rotation`
    category.

    `t_ns` is the wall time at which rotation is being applied; used to
    keep the audit log timestamps coherent if rotation is applied early.
    """
    effective = max(announcement.effective_t_ns, t_ns)
    mutable_roster.rotate_peer(
        agent_id=announcement.agent_id,
        new_pubkey=announcement.new_pubkey,
        old_pubkey=announcement.old_pubkey,
        t_ns=effective,
    )
