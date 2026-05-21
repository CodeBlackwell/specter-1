"""Runtime identity layer: roster mutation, key rotation, revocation, attestation.

Composes with `specter.secure_bus` without modifying it. The bus's `Roster`
remains the immutable form set at swarm formation; `MutableRoster` is the
runtime-aware wrapper that real fleets need.
"""

from .attestation import (
    AttestationProvider,
    AttestationRequiredFilter,
    MockAttestationProvider,
)
from .revocation import RevocationList, filter_envelope
from .roster_runtime import MutableRoster, RosterEvent
from .rotation import KeyRotationAnnouncement, apply_rotation, sign_rotation, verify_rotation

__all__ = [
    "AttestationProvider",
    "AttestationRequiredFilter",
    "KeyRotationAnnouncement",
    "MockAttestationProvider",
    "MutableRoster",
    "RevocationList",
    "RosterEvent",
    "apply_rotation",
    "filter_envelope",
    "sign_rotation",
    "verify_rotation",
]
