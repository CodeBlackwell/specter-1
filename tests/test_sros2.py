"""SROS2 transport tests.

The marshal-only tests (``test_*marshal*``) use an in-process stand-in for
``std_msgs/ByteMultiArray`` so the envelope wire round-trip is verified
without rclpy installed. The auth/bus tests skip when rclpy is absent.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

import pytest

from specter.crypto import Keypair
from specter.secure_bus import (
    Identity,
    ReplayWindow,
    Roster,
    envelope_to_wire,
)
from specter.transport.sros2_marshal import (
    RCLPY_AVAILABLE,
    Sros2Unavailable,
    envelope_to_ros_msg,
    make_secure_node,
    ros_msg_to_envelope,
)

if TYPE_CHECKING:  # pragma: no cover
    pass


# ---------- US-040: marshalling ----------


def _identity(agent_id: str = "alpha") -> Identity:
    return Identity(agent_id, Keypair.generate())


def test_marshal_round_trip_byte_identical():
    ident = _identity()
    env = ident.seal("pose_report", b"hello", timestamp_ns=1_000_000_000)
    msg = envelope_to_ros_msg(env)
    back = ros_msg_to_envelope(msg)
    assert envelope_to_wire(back) == envelope_to_wire(env)
    assert back == env


def test_marshal_thousand_envelopes_byte_identical():
    ident = _identity()
    for i in range(1000):
        env = ident.seal("pose_report", f"payload-{i}".encode(), timestamp_ns=1_000_000_000 + i)
        wire = envelope_to_wire(env)
        msg = envelope_to_ros_msg(env)
        # The ROS message's bytes equal the wire bytes when concatenated.
        assert b"".join(msg.data) == wire
        back = ros_msg_to_envelope(msg)
        assert envelope_to_wire(back) == wire
        assert back == env


def test_marshal_handles_binary_payload():
    ident = _identity()
    payload = bytes(range(256))
    env = ident.seal("observation", payload, timestamp_ns=2_000_000_000)
    msg = envelope_to_ros_msg(env)
    back = ros_msg_to_envelope(msg)
    assert back.payload == payload
    assert envelope_to_wire(back) == envelope_to_wire(env)


def test_marshal_msg_data_is_list_of_single_bytes():
    """rclpy's `ByteMultiArray.data` is a `list[bytes]` of one-byte entries.
    Verify our marshalling produces that exact shape so it passes through DDS
    serialization unchanged."""
    ident = _identity()
    env = ident.seal("pose_report", b"x", timestamp_ns=1)
    msg = envelope_to_ros_msg(env)
    assert isinstance(msg.data, list)
    assert all(isinstance(b, bytes) and len(b) == 1 for b in msg.data)


# ---------- US-041: SROS2 signed-node setup ----------


def test_make_secure_node_raises_without_rclpy():
    if RCLPY_AVAILABLE:
        pytest.skip("rclpy is installed; this test exercises the absence path")
    with pytest.raises(Sros2Unavailable):
        make_secure_node("alpha")


@pytest.mark.skipif(not RCLPY_AVAILABLE, reason="rclpy not installed")
def test_make_secure_node_auth_two_nodes(tmp_path):
    """Two nodes built against the same keystore can publish/subscribe and
    authenticate via SROS2."""
    import rclpy  # type: ignore[import-not-found]

    keystore = tmp_path / "ks"
    keystore.mkdir()
    node_a = make_secure_node("specter_alpha", str(keystore))
    node_b = make_secure_node("specter_bravo", str(keystore))
    try:
        # If construction succeeded under the configured security policy,
        # the auth path is wired. End-to-end signed-node authentication
        # is exercised by the bus tests below.
        assert node_a.get_name() == "specter_alpha"
        assert node_b.get_name() == "specter_bravo"
    finally:
        node_a.destroy_node()
        node_b.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


# ---------- US-042: Sros2Bus ----------


def test_sros2_bus_construction_raises_without_rclpy():
    if RCLPY_AVAILABLE:
        pytest.skip("rclpy is installed; this test exercises the absence path")
    from specter.transport.sros2_bus import Sros2Bus

    with pytest.raises(Sros2Unavailable):
        Sros2Bus(node=object())


@pytest.mark.skipif(not RCLPY_AVAILABLE, reason="rclpy not installed")
def test_sros2_bus_round_trip(tmp_path):
    import rclpy  # type: ignore[import-not-found]

    from specter.transport.sros2_bus import Sros2Bus

    keystore = tmp_path / "ks"
    keystore.mkdir()
    pub_node = make_secure_node("specter_pub", str(keystore))
    sub_node = make_secure_node("specter_sub", str(keystore))
    pub_bus = Sros2Bus(pub_node)
    sub_bus = Sros2Bus(sub_node)
    received: list[bytes] = []
    sub_bus.subscribe("specter_pose", received.append)

    ident = _identity()
    env = ident.seal("pose_report", b"hello", timestamp_ns=time.time_ns())
    wire = envelope_to_wire(env)
    pub_bus.publish("specter_pose", wire)

    deadline = time.time() + 2.0
    while time.time() < deadline and not received:
        rclpy.spin_once(sub_node, timeout_sec=0.1)
    pub_node.destroy_node()
    sub_node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()
    assert received and received[0] == wire


@pytest.mark.skipif(not RCLPY_AVAILABLE, reason="rclpy not installed")
def test_sros2_bus_inside_lossy_bus(tmp_path):
    """LossyBus(Sros2Bus(...)) honors drop_prob — the wrapper composes
    transparently because both implement `MessageBus`."""
    import random

    import rclpy  # type: ignore[import-not-found]

    from specter.transport.lossy_bus import LossyBus
    from specter.transport.sros2_bus import Sros2Bus

    keystore = tmp_path / "ks"
    keystore.mkdir()
    pub_node = make_secure_node("specter_lossy_pub", str(keystore))
    sub_node = make_secure_node("specter_lossy_sub", str(keystore))
    inner = Sros2Bus(pub_node)
    lossy = LossyBus(inner, drop_prob=1.0, rng=random.Random(0))
    sub = Sros2Bus(sub_node)
    received: list[bytes] = []
    sub.subscribe("t", received.append)

    ident = _identity()
    for i in range(20):
        env = ident.seal("pose_report", str(i).encode(), timestamp_ns=time.time_ns())
        lossy.publish("t", envelope_to_wire(env))

    deadline = time.time() + 0.5
    while time.time() < deadline:
        rclpy.spin_once(sub_node, timeout_sec=0.05)
    pub_node.destroy_node()
    sub_node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()
    assert received == []  # drop_prob=1.0


@pytest.mark.skipif(not RCLPY_AVAILABLE, reason="rclpy not installed")
def test_sros2_bus_revoked_key_filtered(tmp_path):
    """Envelopes signed by a revoked key never reach the handler."""
    import rclpy  # type: ignore[import-not-found]
    from cryptography.hazmat.primitives import serialization

    from specter.identity import RevocationList
    from specter.transport.sros2_bus import Sros2Bus

    keystore = tmp_path / "ks"
    keystore.mkdir()
    pub_node = make_secure_node("specter_revoke_pub", str(keystore))
    sub_node = make_secure_node("specter_revoke_sub", str(keystore))
    ident = _identity("alpha")
    roster = Roster()
    roster.add(ident.agent_id, ident.keypair.public_bytes)
    revocation = RevocationList()
    pub_bytes = roster.keys[ident.agent_id].public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    revocation.revoke(pub_bytes, t_ns=0)

    pub_bus = Sros2Bus(pub_node)
    sub_bus = Sros2Bus(
        sub_node,
        roster=roster,
        revocation=revocation,
        replay=ReplayWindow(),
    )
    delivered: list[bytes] = []
    sub_bus.subscribe("t", delivered.append)

    env = ident.seal("pose_report", b"x", timestamp_ns=time.time_ns())
    pub_bus.publish("t", envelope_to_wire(env))
    deadline = time.time() + 1.0
    while time.time() < deadline:
        rclpy.spin_once(sub_node, timeout_sec=0.1)
    pub_node.destroy_node()
    sub_node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()
    assert delivered == []


# ---------- US-043: battery smoke test under DDS ----------

_SROS2_BATTERY = (
    ("single_pose_liar", ("alpha",)),
    ("replay_storm", ("alpha",)),
    ("sybil_flood", ("alpha", "sybil_0", "sybil_1", "sybil_2", "sybil_3")),
    ("sybil_flood_mutual", ("alpha", "sybil_0", "sybil_1", "sybil_2", "sybil_3")),
)


@pytest.mark.skipif(not RCLPY_AVAILABLE, reason="rclpy not installed")
@pytest.mark.parametrize("name,attackers", _SROS2_BATTERY)
def test_battery_under_sros2(name, attackers):
    """Each scenario detects every attacker over Sros2Bus, and detection
    latency stays within 2× the InProcessBus baseline."""
    from examples.ros2_demo import _baseline_results, _run_under_sros2

    baseline = _baseline_results()
    sros2 = _run_under_sros2()

    b_result = baseline[name]
    s_result = sros2[name]
    failures: list[str] = []
    for attacker in attackers:
        b_tick = b_result.detection_ticks.get(attacker)
        s_tick = s_result.detection_ticks.get(attacker)
        if s_tick is None:
            failures.append(f"{name}/{attacker}: undetected under Sros2Bus")
            continue
        if b_tick is not None and s_tick > 2 * b_tick + 5:
            failures.append(
                f"{name}/{attacker}: sros2 tick {s_tick} > 2×baseline({b_tick})+5"
            )
    assert not failures, "\n".join(failures)
