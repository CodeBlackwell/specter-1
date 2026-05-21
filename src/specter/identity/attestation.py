"""Hardware attestation interface + mock implementation.

Closes the V2 sybil residual identified in `THREAT_MODEL.md`: a
compromised honest robot's key minting sybils. Without attestation, a
cabal that controls one real robot can publish from arbitrarily many
sybil identities, all with valid signatures from in-roster keys. With
attestation, only keys bound to a real physical device pass the filter,
so sybils minted in software are rejected before reaching the trust
evaluator.

Phase 1 ships the interface plus a `MockAttestationProvider` that uses
an explicit allowlist (the test stand-in for "this key is on a real
TPM"). Phase 3 swaps in a real TPM/Secure-Enclave-backed implementation.
ADR 0009 covers the interface design and migration path.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass

from cryptography.hazmat.primitives import serialization

from ..secure_bus import Envelope, Roster, VerificationError
from .revocation import RevocationList, filter_envelope


class AttestationProvider(ABC):
    @abstractmethod
    def is_attested(self, public_key_bytes: bytes) -> bool: ...


class MockAttestationProvider(AttestationProvider):
    """Allowlist-backed attestation. Test stand-in for hardware-bound keys.

    Use the original honest-fleet pubkeys as the allowlist; software-minted
    sybils with new keypairs will be missing and therefore rejected.
    """

    def __init__(self, allowlist: set[bytes]) -> None:
        self._allowlist = set(allowlist)

    def is_attested(self, public_key_bytes: bytes) -> bool:
        return public_key_bytes in self._allowlist


@dataclass
class AttestationRequiredFilter:
    """Composed filter: roster lookup → revocation check → attestation check.

    Drop-in at the bus boundary. Call `check(env)` before `open_envelope`
    (or before `MutableRoster.verify_envelope`); raises `VerificationError`
    with category `unattested_key` for sybils, `key_revoked` for revoked
    keys, falls through to the next layer for unknown senders.
    """

    roster: Roster
    revocation: RevocationList
    attestation: AttestationProvider

    def check(self, env: Envelope) -> None:
        filter_envelope(env, self.roster, self.revocation)
        pub = self.roster.keys.get(env.sender_id)
        if pub is None:
            return  # unknown sender — let downstream raise
        pub_bytes = pub.public_bytes(
            serialization.Encoding.X962,
            serialization.PublicFormat.UncompressedPoint,
        )
        if not self.attestation.is_attested(pub_bytes):
            raise VerificationError(f"unattested_key: {env.sender_id}")
