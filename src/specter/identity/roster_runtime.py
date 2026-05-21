"""Runtime-mutable roster.

Wraps `secure_bus.Roster` with timestamped add/remove and an append-only
audit log. Drop-in for `Roster.lookup`-style access via the `keys` dict
and `lookup(agent_id)` method, so existing call-sites that read
`roster.keys.get(...)` continue to work for the *currently* active roster.

For time-aware checks (`was this peer in the roster at t_ns?`) callers
must use `lookup(agent_id, t_ns)`.

Rotation-aware verification lives on `verify_envelope` so that the
explicit `key_revoked_post_rotation` category can be raised for envelopes
signed by a key that was rotated out (vs. the generic `bad signature`).
"""

from dataclasses import dataclass, field
from typing import Literal

from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey

from ..crypto import public_from_bytes, verify
from ..secure_bus import (
    Envelope,
    ReplayWindow,
    Roster,
    VerificationError,
    WIRE_VERSION,
    _signed_blob,
)

EventKind = Literal["add", "remove", "rotate"]


@dataclass(frozen=True)
class RosterEvent:
    kind: EventKind
    agent_id: str
    public_bytes: bytes  # for "remove": empty bytes; for "rotate": new pubkey
    t_ns: int


@dataclass
class MutableRoster:
    """Wraps a `Roster` with timestamped mutation and an audit log.

    `keys` reflects the *latest* active state — drop-in compatible with
    `Roster.lookup(agent_id)` / `roster.keys.get(...)` patterns. For
    time-aware queries use `lookup(agent_id, t_ns)`.
    """

    inner: Roster = field(default_factory=Roster)
    _events: list[RosterEvent] = field(default_factory=list)
    # agent_id → list of (rotation_t_ns, old_pubkey_bytes), ordered
    _rotated_keys: dict[str, list[tuple[int, bytes]]] = field(default_factory=dict)

    @property
    def keys(self) -> dict[str, EllipticCurvePublicKey]:
        return self.inner.keys

    def add_peer(self, agent_id: str, public_bytes: bytes, t_ns: int) -> None:
        self.inner.add(agent_id, public_bytes)
        self._events.append(RosterEvent("add", agent_id, public_bytes, t_ns))

    def remove_peer(self, agent_id: str, t_ns: int) -> None:
        self.inner.keys.pop(agent_id, None)
        self._events.append(RosterEvent("remove", agent_id, b"", t_ns))

    def rotate_peer(
        self, agent_id: str, new_pubkey: bytes, old_pubkey: bytes, t_ns: int
    ) -> None:
        """Swap active key from `old_pubkey` to `new_pubkey` at `t_ns`.

        Records the old key in rotation history so post-rotation envelopes
        signed by it are rejected as `key_revoked_post_rotation`.
        """
        self.inner.add(agent_id, new_pubkey)
        self._rotated_keys.setdefault(agent_id, []).append((t_ns, old_pubkey))
        self._events.append(RosterEvent("rotate", agent_id, new_pubkey, t_ns))

    def events(self) -> list[RosterEvent]:
        return list(self._events)

    def lookup(self, agent_id: str, t_ns: int | None = None) -> EllipticCurvePublicKey | None:
        """Return the active public key for `agent_id` at `t_ns`.

        With `t_ns=None`, returns the *current* active key. With a
        timestamp, replays the audit log up to (and including) that
        instant: returns the key from the most recent add/rotate not
        followed by a remove.
        """
        if t_ns is None:
            return self.inner.keys.get(agent_id)
        active: bytes | None = None
        for ev in self._events:
            if ev.t_ns > t_ns or ev.agent_id != agent_id:
                continue
            if ev.kind == "remove":
                active = None
            else:  # add or rotate
                active = ev.public_bytes
        return public_from_bytes(active) if active else None

    def verify_envelope(self, env: Envelope, replay: ReplayWindow) -> bytes:
        """Like `secure_bus.open_envelope`, but distinguishes a rotated-out
        signing key from a generic bad signature.

        Behavior:
          - Active key verifies → return payload (after replay check).
          - Active key rejects but a rotated-out key for this sender
            verifies → raise `VerificationError("key_revoked_post_rotation: ...")`.
          - Otherwise → raise the same `VerificationError` as
            `open_envelope`.
        """
        if env.version != WIRE_VERSION:
            raise VerificationError(f"unsupported version {env.version}")
        pub = self.inner.keys.get(env.sender_id)
        if pub is None:
            raise VerificationError(f"unknown sender {env.sender_id}")
        blob = _signed_blob(
            env.version, env.sender_id, env.nonce, env.timestamp_ns, env.kind, env.payload
        )
        if verify(pub, blob, env.signature):
            if not replay.accept(env.sender_id, env.nonce):
                raise VerificationError(f"replay from {env.sender_id} nonce={env.nonce}")
            return env.payload
        # Active key rejected — check if a previously-rotated key signed this.
        for rotated_t, old_bytes in self._rotated_keys.get(env.sender_id, []):
            if rotated_t > env.timestamp_ns:
                continue  # rotation hadn't happened yet; old key was still legit
            try:
                old_pub = public_from_bytes(old_bytes)
            except Exception:
                continue
            if verify(old_pub, blob, env.signature):
                raise VerificationError(
                    f"key_revoked_post_rotation: {env.sender_id} signed with rotated-out key"
                )
        raise VerificationError(f"bad signature from {env.sender_id}")
