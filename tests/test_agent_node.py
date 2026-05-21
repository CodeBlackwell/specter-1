"""Wave 1 — `SpecterAgentNode` headless smoke + identity_store unit tests.

The receive-chain assertions exercise the dry-run path on `InProcessBus`
(no rclpy required); they prove the trust+SLAM wiring composes correctly
end-to-end. The rclpy-backed deployment path is exercised by the
multi-process battery in Wave 2.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

# tools/ isn't a package; gen_roster needs sys.path help.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import gen_roster  # noqa: E402

from specter.crypto import Keypair  # noqa: E402
from specter.identity import MockAttestationProvider, MutableRoster, RevocationList  # noqa: E402
from specter.messages import KIND_POSE, PoseReport, encode  # noqa: E402
from specter.ros2.agent_node import SpecterAgentNode, dry_run, main  # noqa: E402
from specter.ros2.identity_store import IdentityStoreError, load_identity  # noqa: E402
from specter.secure_bus import (  # noqa: E402
    Identity,
    InProcessBus,
    envelope_to_wire,
)
from specter.trust import ListTelemetry  # noqa: E402


# ── identity_store ─────────────────────────────────────────────────────────


def _gen(tmp_path: Path) -> tuple[bytes, Path, Path]:
    """gen_roster into tmp_path; return (op_pubkey, roster_path, alpha_key_path)."""
    gen_roster.gen_roster(["alpha", "bravo", "charlie"], tmp_path, dry_run=False)
    op_pub = bytes.fromhex((tmp_path / "operator.pub.hex").read_text().strip())
    return op_pub, tmp_path / "roster.yaml", tmp_path / "keystore" / "alpha.key.pem"


def test_load_identity_returns_correct_agent_id_from_filename(tmp_path):
    _, _, alpha_key = _gen(tmp_path)
    ident = load_identity(alpha_key)
    assert ident.agent_id == "alpha"
    # Round-trip: signing should produce a verifiable signature.
    sig = ident.keypair.sign(b"test")
    assert isinstance(sig, bytes) and len(sig) > 0


def test_load_identity_rejects_world_readable_keyfile(tmp_path):
    _, _, alpha_key = _gen(tmp_path)
    # Loosen permissions to simulate a misconfigured deployment.
    alpha_key.chmod(0o644)
    with pytest.raises(IdentityStoreError, match="group/world bits"):
        load_identity(alpha_key)


def test_load_identity_rejects_unparseable_pem(tmp_path):
    bad = tmp_path / "junk.key.pem"
    bad.write_bytes(b"not a pem file")
    bad.chmod(0o600)
    with pytest.raises(IdentityStoreError, match="failed to parse PEM"):
        load_identity(bad)


def test_load_identity_explicit_agent_id_overrides_filename(tmp_path):
    _, _, alpha_key = _gen(tmp_path)
    ident = load_identity(alpha_key, agent_id="overridden")
    assert ident.agent_id == "overridden"


# ── SpecterAgentNode receive chain ─────────────────────────────────────────


def _build_node(tmp_path: Path) -> tuple[SpecterAgentNode, ListTelemetry]:
    op_pub, roster_path, alpha_key = _gen(tmp_path)
    from specter.ros2.roster_loader import RosterLoader

    roster = RosterLoader.from_yaml(roster_path, op_pub)
    identity = load_identity(alpha_key)
    bus = InProcessBus()
    list_telem = ListTelemetry()
    attestation = MockAttestationProvider(allowlist={identity.keypair.public_bytes})
    from specter.demo.orchestration import StreamTelemetry

    telemetry = StreamTelemetry(list_telem)
    node = SpecterAgentNode(
        agent_id="alpha",
        identity=identity,
        roster=roster,
        bus=bus,
        revocation=RevocationList(),
        attestation=attestation,
        telemetry=telemetry,
    )
    return node, list_telem


def _seal_for(roster: MutableRoster, peer_id: str, kp: Keypair) -> bytes:
    """Forge an envelope: sender_id from roster, signed by an off-roster key."""
    stranger = Identity(peer_id, kp)
    pose = PoseReport(peer_id, 1.0, 1.0, 0.0, time.time_ns())
    env = stranger.seal(KIND_POSE, encode(pose))
    return envelope_to_wire(env)


def test_node_classifies_forged_envelope_as_bad_signature(tmp_path):
    node, list_telem = _build_node(tmp_path)
    forged = _seal_for(node.roster, "bravo", Keypair.generate())
    node.bus.publish("pose", forged)
    anomalies = [ev for ev in list_telem.events if ev[0] == "trust.anomaly"]
    assert anomalies, "expected at least one trust.anomaly event"
    assert anomalies[-1][1].get("category") == "bad_signature"


def test_node_accepts_valid_envelope_from_peer(tmp_path):
    """Honest peer (bravo) seals an envelope that alpha receives over the bus."""
    op_pub, roster_path, alpha_key = _gen(tmp_path)
    from specter.ros2.roster_loader import RosterLoader

    # Build alpha (the receiver) with a roster and a real bravo identity matching it.
    roster = RosterLoader.from_yaml(roster_path, op_pub)
    bravo_key_path = tmp_path / "keystore" / "bravo.key.pem"
    bravo_identity = load_identity(bravo_key_path)
    alpha_identity = load_identity(alpha_key)

    bus = InProcessBus()
    list_telem = ListTelemetry()
    from specter.demo.orchestration import StreamTelemetry

    node = SpecterAgentNode(
        agent_id="alpha",
        identity=alpha_identity,
        roster=roster,
        bus=bus,
        telemetry=StreamTelemetry(list_telem),
    )
    pose = PoseReport("bravo", 2.0, 3.0, 0.5, time.time_ns())
    env = bravo_identity.seal(KIND_POSE, encode(pose))
    node.bus.publish("pose", envelope_to_wire(env))

    # Should NOT have produced a trust.anomaly event for the legit envelope.
    anomalies = [ev for ev in list_telem.events if ev[0] == "trust.anomaly"]
    assert anomalies == [], f"unexpected anomalies: {anomalies}"


def test_node_publishes_pose_to_bus(tmp_path):
    """Calling tick_publish emits a signed pose envelope on the 'pose' topic."""
    node, _ = _build_node(tmp_path)
    received: list[bytes] = []
    node.bus.subscribe("pose", received.append)
    node.tick_publish()
    assert len(received) >= 1, "expected at least one pose envelope on the bus"


# ── dry_run + CLI ──────────────────────────────────────────────────────────


def test_dry_run_returns_zero_and_catches_forge(tmp_path, capsys):
    op_pub, roster_path, alpha_key = _gen(tmp_path)
    rc = dry_run("alpha", roster_path, alpha_key, op_pub)
    assert rc == 0
    err = capsys.readouterr().err
    assert "OK" in err and "bad_signature" in err


def test_main_dry_run_via_cli(tmp_path):
    op_pub, roster_path, alpha_key = _gen(tmp_path)
    op_hex_path = tmp_path / "operator.pub.hex"
    assert op_hex_path.exists()  # gen_roster wrote it
    rc = main(
        [
            "--agent-id",
            "alpha",
            "--roster",
            str(roster_path),
            "--identity",
            str(alpha_key),
            "--operator-pubkey",
            str(op_hex_path),
            "--dry-run",
        ]
    )
    assert rc == 0


def test_main_dry_run_defaults_operator_pubkey_path(tmp_path):
    """Without --operator-pubkey, look for operator.pub.hex next to roster.yaml."""
    op_pub, roster_path, alpha_key = _gen(tmp_path)
    assert (tmp_path / "operator.pub.hex").exists()
    rc = main(
        [
            "--agent-id",
            "alpha",
            "--roster",
            str(roster_path),
            "--identity",
            str(alpha_key),
            "--dry-run",
        ]
    )
    assert rc == 0
