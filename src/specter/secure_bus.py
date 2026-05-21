"""Signed in-process message bus + replay protection.

Threat model coverage:
- Tampering: any modification to envelope fields invalidates signature.
- Spoofing: receiver verifies signature against claimed sender's roster key.
- Replay: per-sender nonce must be strictly monotonic.

Phase 03 swaps the in-process bus for SROS2 transport using the same envelope
contract (ADR 0001 + 0003).
"""

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field

from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey

from .crypto import Keypair, public_from_bytes, verify
from .interfaces import MessageBus

WIRE_VERSION = 1


class VerificationError(Exception):
    """Envelope failed signature, roster, version, or replay check."""


@dataclass(frozen=True)
class Envelope:
    version: int
    sender_id: str
    nonce: int
    timestamp_ns: int
    kind: str
    payload: bytes
    signature: bytes


def _signed_blob(
    version: int, sender_id: str, nonce: int, timestamp_ns: int, kind: str, payload: bytes
) -> bytes:
    return json.dumps(
        {
            "version": version,
            "sender_id": sender_id,
            "nonce": nonce,
            "timestamp_ns": timestamp_ns,
            "kind": kind,
            "payload": payload.hex(),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def envelope_to_wire(env: Envelope) -> bytes:
    return json.dumps(
        {
            "version": env.version,
            "sender_id": env.sender_id,
            "nonce": env.nonce,
            "timestamp_ns": env.timestamp_ns,
            "kind": env.kind,
            "payload": env.payload.hex(),
            "signature": env.signature.hex(),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode()


def envelope_from_wire(data: bytes) -> Envelope:
    blob = json.loads(data)
    return Envelope(
        version=blob["version"],
        sender_id=blob["sender_id"],
        nonce=blob["nonce"],
        timestamp_ns=blob["timestamp_ns"],
        kind=blob["kind"],
        payload=bytes.fromhex(blob["payload"]),
        signature=bytes.fromhex(blob["signature"]),
    )


@dataclass
class Roster:
    """agent_id → public key. Distributed at swarm formation."""

    keys: dict[str, EllipticCurvePublicKey] = field(default_factory=dict)

    def add(self, agent_id: str, public_bytes: bytes) -> None:
        self.keys[agent_id] = public_from_bytes(public_bytes)


@dataclass
class Identity:
    """An agent's signing identity + outbound nonce counter."""

    agent_id: str
    keypair: Keypair
    _nonce: int = 0

    def next_nonce(self) -> int:
        self._nonce += 1
        return self._nonce

    def seal(self, kind: str, payload: bytes, timestamp_ns: int | None = None) -> Envelope:
        nonce = self.next_nonce()
        ts = timestamp_ns if timestamp_ns is not None else time.time_ns()
        blob = _signed_blob(WIRE_VERSION, self.agent_id, nonce, ts, kind, payload)
        return Envelope(WIRE_VERSION, self.agent_id, nonce, ts, kind, payload, self.keypair.sign(blob))


@dataclass
class ReplayWindow:
    """Strict-monotonic per-sender nonce tracker."""

    last_seen: dict[str, int] = field(default_factory=dict)

    def accept(self, sender_id: str, nonce: int) -> bool:
        if nonce <= self.last_seen.get(sender_id, 0):
            return False
        self.last_seen[sender_id] = nonce
        return True


def open_envelope(env: Envelope, roster: Roster, replay: ReplayWindow) -> bytes:
    if env.version != WIRE_VERSION:
        raise VerificationError(f"unsupported version {env.version}")
    pub = roster.keys.get(env.sender_id)
    if pub is None:
        raise VerificationError(f"unknown sender {env.sender_id}")
    blob = _signed_blob(env.version, env.sender_id, env.nonce, env.timestamp_ns, env.kind, env.payload)
    if not verify(pub, blob, env.signature):
        raise VerificationError(f"bad signature from {env.sender_id}")
    if not replay.accept(env.sender_id, env.nonce):
        raise VerificationError(f"replay from {env.sender_id} nonce={env.nonce}")
    return env.payload


class InProcessBus(MessageBus):
    def __init__(self) -> None:
        self._subs: dict[str, list[Callable[[bytes], None]]] = {}

    def publish(self, topic: str, payload: bytes) -> None:
        for handler in self._subs.get(topic, []):
            handler(payload)

    def subscribe(self, topic: str, handler: Callable[[bytes], None]) -> None:
        self._subs.setdefault(topic, []).append(handler)
