import pytest

from specter.crypto import Keypair
from specter.messages import KIND_POSE, PoseReport, decode, encode
from specter.secure_bus import (
    Envelope,
    Identity,
    InProcessBus,
    ReplayWindow,
    Roster,
    VerificationError,
    envelope_from_wire,
    envelope_to_wire,
    open_envelope,
)


from tests._helpers import make_identity, make_roster


def test_signed_envelope_roundtrip():
    alpha = make_identity("alpha")
    pose = PoseReport("alpha", 1.0, 2.0, 0.5, 1000)
    env = alpha.seal(KIND_POSE, encode(pose), timestamp_ns=1000)
    payload = open_envelope(env, make_roster(alpha), ReplayWindow())
    assert decode(KIND_POSE, payload) == pose


def test_wire_serialization_roundtrip():
    alpha = make_identity("alpha")
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 1, 2, 0.5, 1000)), timestamp_ns=1000)
    assert envelope_from_wire(envelope_to_wire(env)) == env


def test_tampered_payload_rejected():
    alpha = make_identity("alpha")
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 1, 2, 0.5, 1000)))
    tampered = Envelope(
        env.version, env.sender_id, env.nonce, env.timestamp_ns, env.kind,
        encode(PoseReport("alpha", 99, 99, 0, 1000)), env.signature,
    )
    with pytest.raises(VerificationError, match="bad signature"):
        open_envelope(tampered, make_roster(alpha), ReplayWindow())


def test_replay_rejected():
    alpha = make_identity("alpha")
    roster = make_roster(alpha)
    replay = ReplayWindow()
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 1, 2, 0.5, 1000)))
    open_envelope(env, roster, replay)
    with pytest.raises(VerificationError, match="replay"):
        open_envelope(env, roster, replay)


def test_unknown_sender_rejected():
    rogue = make_identity("rogue")
    env = rogue.seal(KIND_POSE, encode(PoseReport("rogue", 0, 0, 0, 0)))
    with pytest.raises(VerificationError, match="unknown sender"):
        open_envelope(env, Roster(), ReplayWindow())


def test_spoofed_sender_id_rejected():
    """Attacker uses their own key but claims to be alpha."""
    alpha = make_identity("alpha")
    fake = Identity(agent_id="alpha", keypair=Keypair.generate())
    env = fake.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)))
    with pytest.raises(VerificationError, match="bad signature"):
        open_envelope(env, make_roster(alpha), ReplayWindow())


def test_unsupported_version_rejected():
    alpha = make_identity("alpha")
    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)))
    bad = Envelope(99, env.sender_id, env.nonce, env.timestamp_ns, env.kind, env.payload, env.signature)
    with pytest.raises(VerificationError, match="unsupported version"):
        open_envelope(bad, make_roster(alpha), ReplayWindow())


def test_in_process_bus_delivers_in_order():
    bus = InProcessBus()
    received: list[bytes] = []
    bus.subscribe("topic", received.append)
    bus.publish("topic", b"first")
    bus.publish("topic", b"second")
    assert received == [b"first", b"second"]


def test_in_process_bus_fans_out_to_all_subscribers():
    bus = InProcessBus()
    a: list[bytes] = []
    b: list[bytes] = []
    bus.subscribe("topic", a.append)
    bus.subscribe("topic", b.append)
    bus.publish("topic", b"x")
    assert a == [b"x"]
    assert b == [b"x"]


def test_end_to_end_two_agents_via_bus():
    alpha = make_identity("alpha")
    bravo = make_identity("bravo")
    roster = make_roster(alpha, bravo)
    replay = ReplayWindow()
    bus = InProcessBus()
    received: list[PoseReport] = []

    def handler(wire: bytes) -> None:
        env = envelope_from_wire(wire)
        payload = open_envelope(env, roster, replay)
        received.append(decode(env.kind, payload))

    bus.subscribe("pose", handler)
    pose = PoseReport("alpha", 3.5, 2.1, 0.7, 1234)
    env = alpha.seal(KIND_POSE, encode(pose), timestamp_ns=1234)
    bus.publish("pose", envelope_to_wire(env))
    assert received == [pose]
