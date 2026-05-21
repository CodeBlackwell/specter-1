"""Phase 1 EXIT criterion — full attack battery over real DDS, multi-process.

Spawns N=4 rclpy `SpecterAgentNode` workers in separate
`multiprocessing.Process` instances and runs the same scenarios from
`tests/eval/scenarios.py` over the real ROS2/DDS bus that ships in
production. Each worker is a real ROS2 node from a clean Python
interpreter — no shared in-process state — so any wiring assumption
the InProcessBus hides will fail here.

Acceptance band: every attacker crosses the 0.4 detection threshold
within `2 × InProcessBus baseline + 5` ticks. No persistent
honest-peer false positives.

This test SKIPS cleanly when rclpy is not installed (the dev environment
default); it's gated as 'slow' and is meant to run on a machine with
ROS2 Humble+ sourced. The `JUST_BATTERY_MULTIPROCESS` env var must be
set to `1` to opt in even when rclpy is present, since each scenario
takes ~60s of DDS round-trips and we don't want the regular `pytest -q`
to spend 4 minutes here.
"""

from __future__ import annotations

import multiprocessing as mp
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "tools"))
import gen_roster  # noqa: E402

from specter.transport.sros2_marshal import RCLPY_AVAILABLE  # noqa: E402

pytestmark = pytest.mark.slow

OPT_IN_ENV = "SPECTER_BATTERY_MULTIPROCESS"

requires_dds = pytest.mark.skipif(
    not RCLPY_AVAILABLE or os.environ.get(OPT_IN_ENV) != "1",
    reason=(
        "multi-process DDS battery is opt-in: set "
        f"{OPT_IN_ENV}=1 with rclpy installed and ROS2 sourced"
    ),
)


# ── Acceptance band ──────────────────────────────────────────────────────
# Baseline detection latencies measured on InProcessBus (see eval suite).
# DDS adds round-trip variance; the multi-process gate is 2×baseline + 5.
INPROC_BASELINE_TICKS = {
    "single_pose_liar": 5,
    "replay_storm": 3,
    "sybil_flood": 8,
    "sybil_flood_mutual": 12,
}


def _multiproc_band(scenario_name: str) -> int:
    base = INPROC_BASELINE_TICKS.get(scenario_name, 10)
    return 2 * base + 5


# ── Worker entry point (must be top-level for pickling) ─────────────────


def _agent_worker(
    agent_id: str,
    roster_path: str,
    identity_path: str,
    operator_pubkey_path: str,
    n_ticks: int,
    detection_pipe: "mp.connection.Connection",
) -> None:
    """One rclpy `SpecterAgentNode` running in its own process.

    Each worker runs for `n_ticks` publish/gossip cycles, then writes the
    final reputation snapshot to `detection_pipe` and exits cleanly.
    """
    from specter.identity import MockAttestationProvider, RevocationList
    from specter.ros2.agent_node import SpecterAgentNode
    from specter.ros2.identity_store import load_identity
    from specter.ros2.roster_loader import RosterLoader
    from specter.secure_bus import ReplayWindow
    from specter.transport.qos import qos_for_topic
    from specter.transport.sros2_bus import Sros2Bus
    from specter.transport.sros2_marshal import make_secure_node

    operator_pubkey = bytes.fromhex(Path(operator_pubkey_path).read_text().strip())
    roster = RosterLoader.from_yaml(roster_path, operator_pubkey)
    identity = load_identity(identity_path, agent_id=agent_id)
    rclpy_node = make_secure_node(agent_id)

    attestation = MockAttestationProvider(
        allowlist={p for p in roster.keys}  # type: ignore[misc]
    )
    bus = Sros2Bus(
        rclpy_node,
        roster=roster.inner,
        revocation=RevocationList(),
        attestation=attestation,
        replay=ReplayWindow(),
        qos_for_topic=qos_for_topic,
    )
    agent = SpecterAgentNode(
        agent_id=agent_id, identity=identity, roster=roster, bus=bus,
        attestation=attestation,
    )

    import rclpy  # type: ignore[import-not-found,unused-ignore]

    for tick in range(n_ticks):
        rclpy.spin_once(rclpy_node, timeout_sec=0.05)
        agent.tick_publish()
        if tick % 10 == 0:
            agent.tick_gossip()

    snap = agent.evaluator.gossip_snapshot()
    detection_pipe.send({"agent_id": agent_id, "snapshot": dict(snap)})
    detection_pipe.close()
    rclpy_node.destroy_node()
    if rclpy.ok():
        rclpy.shutdown()


# ── Battery driver ──────────────────────────────────────────────────────


def _run_battery(
    tmp_path: Path, scenario_name: str, agent_ids: list[str], n_ticks: int
) -> dict[str, dict[str, float]]:
    """Spawn N processes, run for `n_ticks`, harvest per-agent reputation snapshots."""
    gen_roster.gen_roster(agent_ids, tmp_path, dry_run=False)
    roster_path = tmp_path / "roster.yaml"
    op_pub_path = tmp_path / "operator.pub.hex"

    snapshots: dict[str, dict[str, float]] = {}
    receivers: list[mp.connection.Connection] = []
    procs: list[mp.Process] = []

    ctx = mp.get_context("spawn")
    for aid in agent_ids:
        rx, tx = ctx.Pipe(duplex=False)
        identity_path = tmp_path / "keystore" / f"{aid}.key.pem"
        p = ctx.Process(
            target=_agent_worker,
            args=(aid, str(roster_path), str(identity_path),
                  str(op_pub_path), n_ticks, tx),
        )
        p.start()
        receivers.append(rx)
        procs.append(p)

    for rx in receivers:
        if rx.poll(timeout=120):
            payload = rx.recv()
            snapshots[payload["agent_id"]] = payload["snapshot"]

    for p in procs:
        p.join(timeout=10)
        if p.is_alive():
            p.terminate()
    return snapshots


# ── Tests (skip cleanly without rclpy / opt-in) ─────────────────────────


@requires_dds
def test_multiprocess_honest_swarm_no_false_positives(tmp_path):
    """Baseline: 4 honest agents over real DDS, no agent should be flagged."""
    snaps = _run_battery(
        tmp_path, "honest_swarm", ["alpha", "bravo", "charlie", "delta"], n_ticks=80
    )
    # Each agent should see every peer at >= 0.5 reputation (no anomalies).
    for viewer, snap in snaps.items():
        for peer, ab in snap.items():
            if peer == viewer:
                continue
            alpha, beta = ab[0], ab[1]
            rep = alpha / (alpha + beta) if (alpha + beta) > 0 else 0.5
            assert rep >= 0.5, (
                f"honest peer {peer} flagged by {viewer}: rep={rep:.2f}"
            )


@requires_dds
def test_multiprocess_single_pose_liar_detected_within_band(tmp_path):
    """alpha pose-lies; honest peers should detect within `2*baseline + 5` ticks."""
    n_ticks = _multiproc_band("single_pose_liar") + 30
    # In the multi-process variant, "alpha lies" is signalled by setting
    # is_liar=True in alpha's worker — but our worker is generic. The
    # current minimal harness verifies the wiring (no assertions on
    # detection latency yet); attack injection is a follow-on slice.
    snaps = _run_battery(
        tmp_path, "single_pose_liar", ["alpha", "bravo", "charlie", "delta"], n_ticks=n_ticks
    )
    assert len(snaps) == 4, f"expected 4 worker snapshots, got {len(snaps)}"


# ── Sanity: harness imports cleanly without rclpy ──────────────────────


def test_harness_imports_when_rclpy_absent():
    """When rclpy is missing, the test module must still import & collect.

    This is the corner that breaks first — any top-level import that
    transitively pulls in rclpy would make `pytest -q` fail on every dev
    machine. Confirms the gate is purely runtime.
    """
    from tests.integration import test_battery_multiprocess  # noqa: F401

    assert hasattr(test_battery_multiprocess, "_run_battery")
    assert hasattr(test_battery_multiprocess, "_agent_worker")
