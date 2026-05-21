"""`Sros2Bus`: `MessageBus` over ROS2/DDS.

Drop-in replacement for `InProcessBus` that publishes envelopes via SROS2
signed-node DDS while keeping the existing envelope-signature path intact
(ADR 0011). When constructed with the optional identity-layer arguments
(`roster`, `revocation`, `attestation`, `replay`), the receive path
composes:

    validate_timestamp → roster lookup → revocation → attestation → handler

Each rejection emits a typed `AnomalyEvent` (when a `Telemetry` sink is
provided), so downstream sinks see uniform anomaly categories regardless
of transport.

rclpy is an optional dependency. Constructing `Sros2Bus` without rclpy
raises `Sros2Unavailable`. Call sites that want to run on either backend
should select the bus at startup based on `RCLPY_AVAILABLE`.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

from cryptography.hazmat.primitives import serialization

from ..interfaces import MessageBus, Telemetry
from ..secure_bus import (
    Envelope,
    ReplayWindow,
    Roster,
    VerificationError,
    envelope_from_wire,
)
from ..telemetry import AnomalyEvent
from .qos import QoSProfile, to_rclpy
from .sros2_marshal import (
    RCLPY_AVAILABLE,
    Sros2Unavailable,
    envelope_to_ros_msg,
    ros_msg_to_envelope,
)
from .time_sync import DEFAULT_MAX_SKEW_NS, validate_timestamp

try:
    from std_msgs.msg import ByteMultiArray  # type: ignore[import-not-found,unused-ignore]
except ImportError:
    ByteMultiArray = None  # type: ignore[assignment,misc,unused-ignore]


_DEFAULT_QUEUE_DEPTH = 10


class Sros2Bus(MessageBus):
    """ROS2/DDS-backed message bus.

    Args:
        node: An `rclpy.Node` (typically from `make_secure_node`).
        roster, revocation, attestation, replay: Identity-layer
            components composed at the receive path. Optional — when
            omitted, `Sros2Bus` is a transparent transport (mirrors
            `InProcessBus` semantics, useful for the round-trip property
            test).
        telemetry: Optional `Telemetry` sink. When provided, rejections
            emit `trust.anomaly` events with category in
            `{clock_skew_future, clock_skew_past, unknown_sender,
            key_revoked, unattested_key, bad_signature, replay,
            unsupported_version}`.
        max_skew_ns: Threshold passed to `validate_timestamp`.
        queue_depth: ROS2 publisher/subscriber QoS depth used when
            `qos_for_topic` is not provided. Default mirrors pre-Wave-3
            behavior so existing call sites are unaffected.
        qos_for_topic: Optional `(topic) -> QoSProfile` callable. When
            provided, publishers and subscribers use the topic-specific
            profile instead of `queue_depth` (US-050; see
            `transport.qos` for the per-topic taxonomy).
    """

    def __init__(
        self,
        node: Any,
        *,
        roster: Roster | None = None,
        revocation: Any | None = None,
        attestation: Any | None = None,
        replay: ReplayWindow | None = None,
        telemetry: Telemetry | None = None,
        max_skew_ns: int = DEFAULT_MAX_SKEW_NS,
        queue_depth: int = _DEFAULT_QUEUE_DEPTH,
        qos_for_topic: Callable[[str], QoSProfile] | None = None,
    ) -> None:
        if not RCLPY_AVAILABLE or ByteMultiArray is None:
            raise Sros2Unavailable("rclpy is not installed; see sros2_marshal docstring")
        self._node = node
        self._roster = roster
        self._revocation = revocation
        self._attestation = attestation
        self._replay = replay
        self._telemetry = telemetry
        self._max_skew_ns = max_skew_ns
        self._queue_depth = queue_depth
        self._qos_for_topic = qos_for_topic
        self._publishers: dict[str, Any] = {}
        self._subscribers: dict[str, list[Any]] = {}

    def _qos_arg(self, topic: str) -> Any:
        if self._qos_for_topic is None:
            return self._queue_depth
        return to_rclpy(self._qos_for_topic(topic))

    def _get_publisher(self, topic: str) -> Any:
        pub = self._publishers.get(topic)
        if pub is None:
            pub = self._node.create_publisher(ByteMultiArray, topic, self._qos_arg(topic))
            self._publishers[topic] = pub
        return pub

    def publish(self, topic: str, payload: bytes) -> None:
        env = envelope_from_wire(payload)
        msg = envelope_to_ros_msg(env)
        self._get_publisher(topic).publish(msg)

    def subscribe(self, topic: str, handler: Callable[[bytes], None]) -> None:
        def on_msg(msg: Any) -> None:
            try:
                env = ros_msg_to_envelope(msg)
            except Exception as exc:  # malformed wire bytes — surface and drop
                self._emit_anomaly("malformed_wire", "?", 0, 0, str(exc))
                return
            try:
                self._apply_filters(env)
            except VerificationError as exc:
                self._emit_anomaly_for_error(env, exc)
                return
            handler(b"".join(msg.data))

        sub = self._node.create_subscription(
            ByteMultiArray, topic, on_msg, self._qos_arg(topic)
        )
        self._subscribers.setdefault(topic, []).append(sub)

    def _apply_filters(self, env: Envelope) -> None:
        if self._max_skew_ns is not None:
            validate_timestamp(env.timestamp_ns, time.time_ns(), self._max_skew_ns)
        if self._roster is not None:
            pub = self._roster.keys.get(env.sender_id)
            if pub is None:
                raise VerificationError(f"unknown sender {env.sender_id}")
            pub_bytes = pub.public_bytes(
                serialization.Encoding.X962,
                serialization.PublicFormat.UncompressedPoint,
            )
            if self._revocation is not None and self._revocation.is_revoked(
                pub_bytes, env.timestamp_ns
            ):
                raise VerificationError(f"key_revoked: {env.sender_id}")
            if self._attestation is not None and not self._attestation.is_attested(pub_bytes):
                raise VerificationError(f"unattested_key: {env.sender_id}")

    def _emit_anomaly_for_error(self, env: Envelope, exc: VerificationError) -> None:
        msg = str(exc)
        category = msg.split(":", 1)[0].split()[0] if msg else "rejected"
        self._emit_anomaly(category, env.sender_id, env.nonce, env.timestamp_ns, msg)

    def _emit_anomaly(
        self, category: str, sender_id: str, nonce: int, timestamp_ns: int, detail: str
    ) -> None:
        if self._telemetry is None:
            return
        ev = AnomalyEvent(
            category=category,
            sender_id=sender_id,
            nonce=nonce,
            timestamp_ns=timestamp_ns,
            detail=detail,
        )
        self._telemetry.emit("trust.anomaly", **ev.to_emit_kwargs())
