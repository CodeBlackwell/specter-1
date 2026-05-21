"""Two agents exchange signed pose reports over the in-process bus.

Demonstrates: sealing → bus delivery → verification → decode. The middle of
the run injects a tampered packet and a replayed packet to show rejection.
"""

import time

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


def main() -> None:
    alpha = Identity("alpha", Keypair.generate())
    bravo = Identity("bravo", Keypair.generate())

    roster = Roster()
    roster.add(alpha.agent_id, alpha.keypair.public_bytes)
    roster.add(bravo.agent_id, bravo.keypair.public_bytes)

    bus = InProcessBus()
    replay = ReplayWindow()

    def on_pose(wire: bytes) -> None:
        env = envelope_from_wire(wire)
        try:
            payload = open_envelope(env, roster, replay)
        except VerificationError as e:
            print(f"  REJECT  {env.sender_id} nonce={env.nonce}  reason={e}")
            return
        pose = decode(env.kind, payload)
        print(f"  ACCEPT  {env.sender_id} nonce={env.nonce}  pose=({pose.x:.2f},{pose.y:.2f},{pose.theta:.2f})")

    bus.subscribe("pose", on_pose)

    print("--- normal traffic ---")
    for i in range(3):
        for ident in (alpha, bravo):
            pose = PoseReport(ident.agent_id, float(i), float(i * 2), 0.1 * i, time.time_ns())
            env = ident.seal(KIND_POSE, encode(pose))
            print(f"PUB     {ident.agent_id} nonce={env.nonce}")
            bus.publish("pose", envelope_to_wire(env))

    print("--- tamper attack ---")
    pose = PoseReport("alpha", 5.0, 5.0, 0.0, time.time_ns())
    env = alpha.seal(KIND_POSE, encode(pose))
    fake_payload = encode(PoseReport("alpha", 999.0, 999.0, 0.0, env.timestamp_ns))
    tampered = Envelope(env.version, env.sender_id, env.nonce, env.timestamp_ns, env.kind, fake_payload, env.signature)
    print(f"PUB(*)  alpha nonce={env.nonce}  payload swapped post-sign")
    bus.publish("pose", envelope_to_wire(tampered))

    print("--- replay attack ---")
    legit = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 1.0, 1.0, 0.0, time.time_ns())))
    bus.publish("pose", envelope_to_wire(legit))
    print(f"PUB(*)  alpha nonce={legit.nonce}  same envelope replayed")
    bus.publish("pose", envelope_to_wire(legit))


if __name__ == "__main__":
    main()
