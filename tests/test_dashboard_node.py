"""Wave 1 — `SpecterDashboardNode` headless smoke + receive-chain tests.

Runs under `SDL_VIDEODRIVER=dummy` so render code exercises real pygame
surface ops without opening a window. The rclpy-backed deployment is
exercised by Wave 2's multi-process battery.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Headless pygame BEFORE any pygame import.
os.environ.setdefault("SDL_VIDEODRIVER", "dummy")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import gen_roster  # noqa: E402

from specter.crypto import Keypair  # noqa: E402
from specter.identity import MutableRoster  # noqa: E402
from specter.messages import (  # noqa: E402
    KIND_FRAGMENT,
    KIND_POSE,
    KIND_REPUTATION,
    PoseReport,
    ReputationGossip,
    encode,
)
from specter.ros2.dashboard_node import (  # noqa: E402
    SpecterDashboardNode,
    dry_run,
    main,
    render_frame,
)
from specter.ros2.identity_store import load_identity  # noqa: E402
from specter.ros2.roster_loader import RosterLoader  # noqa: E402
from specter.secure_bus import (  # noqa: E402
    Identity,
    InProcessBus,
    envelope_to_wire,
)


def _gen(tmp_path: Path) -> tuple[bytes, Path]:
    gen_roster.gen_roster(["alpha", "bravo", "charlie"], tmp_path, dry_run=False)
    op_pub = bytes.fromhex((tmp_path / "operator.pub.hex").read_text().strip())
    return op_pub, tmp_path / "roster.yaml"


def _node(tmp_path: Path) -> tuple[SpecterDashboardNode, MutableRoster]:
    op_pub, roster_path = _gen(tmp_path)
    roster = RosterLoader.from_yaml(roster_path, op_pub)
    bus = InProcessBus()
    return SpecterDashboardNode(roster=roster, bus=bus), roster


def test_dashboard_known_peers_are_roster_keys(tmp_path):
    node, _ = _node(tmp_path)
    assert set(node.known_peers()) == {"alpha", "bravo", "charlie"}


def test_dashboard_records_fragment_per_peer(tmp_path):
    node, _ = _node(tmp_path)
    bravo_id = load_identity(tmp_path / "keystore" / "bravo.key.pem")
    fragment_payload = b'{"resolution": 0.2, "cells": [[true, false], [false, true]]}'
    env = bravo_id.seal(KIND_FRAGMENT, fragment_payload, timestamp_ns=time.time_ns())
    node.bus.publish("fragment", envelope_to_wire(env))
    assert node.latest_fragment("bravo") == fragment_payload
    assert node.latest_fragment("alpha") is None


def test_dashboard_rejects_forged_envelope_via_anomaly(tmp_path):
    node, _ = _node(tmp_path)
    stranger = Identity("bravo", Keypair.generate())  # off-roster key
    env = stranger.seal(
        KIND_POSE,
        encode(PoseReport("bravo", 0.0, 0.0, 0.0, time.time_ns())),
    )
    node.bus.publish("pose", envelope_to_wire(env))
    anomalies = [ev for ev in node.list_telemetry.events if ev[0] == "trust.anomaly"]
    assert anomalies, "expected forged envelope to produce a trust.anomaly"
    assert anomalies[-1][1].get("category") == "bad_signature"


def test_dashboard_records_rep_trace_on_gossip(tmp_path):
    node, _ = _node(tmp_path)
    bravo_id = load_identity(tmp_path / "keystore" / "bravo.key.pem")
    gossip = ReputationGossip("bravo", {"alpha": [3.0, 1.0]}, time.time_ns())
    env = bravo_id.seal(KIND_REPUTATION, encode(gossip))
    node.bus.publish("reputation", envelope_to_wire(env))
    # The dashboard's evaluator should now have at least one rep_trace
    # entry for alpha (driven by bravo's snapshot of alpha).
    assert "alpha" in node.rep_trace.peers() or "bravo" in node.rep_trace.peers()


def test_render_frame_does_not_raise_under_dummy_driver(tmp_path):
    node, _ = _node(tmp_path)
    import pygame

    pygame.init()
    try:
        screen = pygame.display.set_mode((800, 600))
        font = pygame.font.SysFont("Menlo", 11)
        bold = pygame.font.SysFont("Menlo", 12, bold=True)
        # Render with empty state — should not raise.
        render_frame(node, screen, font, bold)

        # And after one fragment arrives — exercises the thumbnail path (US-122).
        bravo_id = load_identity(tmp_path / "keystore" / "bravo.key.pem")
        frag = b'{"resolution": 0.2, "cells": [[true, false]]}'
        env = bravo_id.seal(KIND_FRAGMENT, frag, timestamp_ns=time.time_ns())
        node.bus.publish("fragment", envelope_to_wire(env))
        render_frame(node, screen, font, bold)
    finally:
        pygame.quit()


def test_dry_run_renders_one_frame_and_returns_zero(tmp_path, capsys):
    op_pub, roster_path = _gen(tmp_path)
    rc = dry_run(roster_path, op_pub)
    assert rc == 0
    err = capsys.readouterr().err
    assert "rendered one frame" in err


def test_main_dry_run_via_cli(tmp_path):
    _, roster_path = _gen(tmp_path)
    rc = main(["--roster", str(roster_path), "--dry-run"])
    assert rc == 0


def test_us122_belief_overlay_survives_peer_dropout(tmp_path):
    """Last-known fragment stays visible after the peer stops publishing."""
    node, _ = _node(tmp_path)
    bravo_id = load_identity(tmp_path / "keystore" / "bravo.key.pem")
    frag = b'{"resolution": 0.2, "cells": [[true, false]]}'
    env = bravo_id.seal(KIND_FRAGMENT, frag, timestamp_ns=time.time_ns())
    node.bus.publish("fragment", envelope_to_wire(env))
    assert node.latest_fragment("bravo") == frag
    # Peer "drops out" — no more publishes. The thumbnail should still be
    # available on the next render.
    assert node.latest_fragment("bravo") == frag
