"""Revocation list — forward-only key blocklist.

Standard revocation pattern: an envelope signed by a revoked key is
rejected even if the agent_id is otherwise in the roster. Revocation is
*forward-only* — envelopes timestamped before revocation pass; envelopes
at or after the revocation instant are blocked.
"""

from dataclasses import dataclass, field

from ..secure_bus import Envelope, Roster, VerificationError


@dataclass
class RevocationList:
    # public_key_bytes → earliest revocation t_ns
    _revoked: dict[bytes, int] = field(default_factory=dict)

    def revoke(self, public_key_bytes: bytes, t_ns: int) -> None:
        existing = self._revoked.get(public_key_bytes)
        if existing is None or t_ns < existing:
            self._revoked[public_key_bytes] = t_ns

    def is_revoked(self, public_key_bytes: bytes, t_ns: int) -> bool:
        revoked_at = self._revoked.get(public_key_bytes)
        return revoked_at is not None and t_ns >= revoked_at


def filter_envelope(env: Envelope, roster: Roster, revocation: RevocationList) -> None:
    """Raise `VerificationError("key_revoked")` if the sender's pubkey is
    revoked at or before `env.timestamp_ns`. No-op otherwise.

    Composes with `open_envelope`: callers run this filter and then
    `open_envelope` (or vice versa). Order doesn't matter for correctness;
    revocation is a roster-side check that's cheaper than ECDSA verify.
    """
    pub = roster.keys.get(env.sender_id)
    if pub is None:
        return  # let open_envelope produce the unknown-sender error
    from cryptography.hazmat.primitives import serialization

    pub_bytes = pub.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    if revocation.is_revoked(pub_bytes, env.timestamp_ns):
        raise VerificationError(f"key_revoked: {env.sender_id}")
