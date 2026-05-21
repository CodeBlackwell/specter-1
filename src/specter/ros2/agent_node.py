"""Per-robot ROS2 node — wires sensor adapters → SLAM → publish path → `Sros2Bus`.

This is the deployment-time entry point for one robot. It composes the
identity-hardened receive chain (the same one the demo runs in-process)
with a real ROS2 bus and real sensor adapters.

Construction is deliberately split from rclpy. `SpecterAgentNode` takes a
pre-built `MessageBus` and an optional sensor wiring; the CLI entry
(`main()`) builds the rclpy version, while `--dry-run` wires the same
class onto an `InProcessBus` and pushes one forged envelope through the
receive chain to prove the wiring works without ROS2 installed.

Hardware contract (matches the demo's `_make_handler` exactly):

    validate_timestamp → roster.lookup → revocation → attestation
       → MutableRoster.verify_envelope (signature + replay)
       → BetaTrustEvaluator.record_*

A rejection at any step emits a typed `AnomalyEvent` via the telemetry
sink (`bad_signature`, `replay`, `unknown_sender`, `key_revoked`,
`unattested_key`, `clock_skew_future`, `clock_skew_past`,
`unsupported_version`, `key_revoked_post_rotation`).

Boundaries (intentional non-coverage):

  * Per-robot calibration (IMU bias zeroing, UWB range bias, lidar mount
    offset) is Phase 2 — the adapter outputs are consumed as-is.
  * Cooperative-merge cadence is timer-driven here (not sim-tick driven);
    the merge interval is a constructor knob.
  * Watchdog / fail-safe / partition response is the policy-decisions PRD
    — Phase 1 just emits the anomalies that drive those policies.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any

from specter.demo.orchestration import (
    FRAGMENT_BUFFER_PER_AGENT,
    GRID_RES_M,
    LIE_OFFSET,
    MERGE_INTERVAL_TICKS,
    StreamTelemetry,
    pub_bytes,
)
from specter.identity import (
    AttestationProvider,
    MockAttestationProvider,
    MutableRoster,
    RevocationList,
)
from specter.interfaces import MessageBus, Telemetry
from specter.messages import (
    KIND_FRAGMENT,
    KIND_OBSERVATION,
    KIND_POSE,
    KIND_REPUTATION,
    Observation,
    PoseReport,
    ReputationGossip,
    decode,
    encode,
)
from specter.ros2.identity_store import load_identity
from specter.ros2.roster_loader import RosterLoader
from specter.secure_bus import (
    Identity,
    InProcessBus,
    ReplayWindow,
    VerificationError,
    envelope_from_wire,
    envelope_to_wire,
)
from specter.slam import OccupancyMapMerger, ScanMatchSlam, encode_fragment
from specter.sim.beacons import BeaconReturn
from specter.telemetry import ReputationTrace
from specter.transport.time_sync import DEFAULT_MAX_SKEW_NS, validate_timestamp
from specter.trust import BetaTrustEvaluator, ListTelemetry
from specter.types import IMUSample, Pose, RangeMeasurement


class SpecterAgentNode:
    """Per-robot composition of the trust + SLAM + publish stack.

    Bus-agnostic. Pass `Sros2Bus` for real DDS or `InProcessBus` for the
    headless dry-run / multi-process battery test. Construction does NOT
    require rclpy — adapter wiring is done by the caller after the bus is
    created (see `main()` for the rclpy path and `dry_run()` for the
    no-rclpy path).
    """

    def __init__(
        self,
        agent_id: str,
        identity: Identity,
        roster: MutableRoster,
        bus: MessageBus,
        *,
        revocation: RevocationList | None = None,
        attestation: AttestationProvider | None = None,
        attestation_required: bool = False,
        telemetry: Telemetry | None = None,
        init_pose: Pose | None = None,
        dt: float = 0.1,
        world_w: float = 20.0,
        world_h: float = 20.0,
        grid_res_m: float = GRID_RES_M,
        merge_interval_ticks: int = MERGE_INTERVAL_TICKS,
        is_liar: bool = False,
    ) -> None:
        self.agent_id = agent_id
        self.identity = identity
        self.roster = roster
        self.bus = bus
        self.revocation = revocation or RevocationList()
        self.attestation = attestation
        self.attestation_required = attestation_required
        self.telemetry = telemetry or StreamTelemetry(ListTelemetry())
        self.evaluator = BetaTrustEvaluator(telemetry=self.telemetry, self_id=agent_id)
        self.replay = ReplayWindow()
        self.rep_trace = ReputationTrace()
        self.slam = ScanMatchSlam(
            agent_id=agent_id,
            init_pose=init_pose or Pose(x=0.0, y=0.0, theta=0.0, t=0.0),
            dt=dt,
        )
        self.merger = OccupancyMapMerger(world_w, world_h, resolution_m=grid_res_m)
        self.fragment_buffer: deque[bytes] = deque(
            maxlen=FRAGMENT_BUFFER_PER_AGENT * max(len(roster.keys), 1)
        )
        self.merge_interval_ticks = merge_interval_ticks
        self._tick_count = 0
        self._latest_scans: list[RangeMeasurement] = []
        self._latest_beacons: list[BeaconReturn] = []
        self._is_liar = is_liar
        self.merged_grid: bytes | None = None

        self._handler = self._make_handler()
        for topic in ("pose", "observation", "reputation", "fragment"):
            bus.subscribe(topic, self._handler)

    # ── Receive chain ─────────────────────────────────────────────────────
    def _make_handler(self) -> Callable[[bytes], None]:
        """Build the hardened receive handler. Mirrors `demo.orchestration._make_handler`."""

        def on_envelope(wire: bytes) -> None:
            env = envelope_from_wire(wire)
            try:
                validate_timestamp(env.timestamp_ns, time.time_ns(), DEFAULT_MAX_SKEW_NS)
                pub = self.roster.lookup(env.sender_id, env.timestamp_ns)
                if pub is not None:
                    pub_b = pub_bytes(pub)
                    if self.revocation.is_revoked(pub_b, env.timestamp_ns):
                        raise VerificationError(f"key_revoked: {env.sender_id}")
                    if (
                        self.attestation_required
                        and self.attestation is not None
                        and not self.attestation.is_attested(pub_b)
                    ):
                        raise VerificationError(f"unattested_key: {env.sender_id}")
                payload = self.roster.verify_envelope(env, self.replay)
                self.evaluator.record_accept(env)
                if env.kind == KIND_POSE:
                    self.evaluator.record_pose_report(env, decode(env.kind, payload))
                elif env.kind == KIND_OBSERVATION:
                    self.evaluator.record_observation(env, decode(env.kind, payload))
                elif env.kind == KIND_REPUTATION:
                    self.evaluator.record_gossip(env, decode(env.kind, payload))
                elif env.kind == KIND_FRAGMENT:
                    self.fragment_buffer.append(payload)
            except VerificationError as e:
                self.evaluator.record_reject(env, e)

        return on_envelope

    # ── Sensor sinks (wired to adapters by caller) ────────────────────────
    def on_lidar(self, scans: list[RangeMeasurement]) -> None:
        self._latest_scans = list(scans)

    def on_imu(self, imu: IMUSample) -> None:
        self.slam.update(self._latest_scans, imu)

    def on_uwb(self, returns: list[BeaconReturn]) -> None:
        self._latest_beacons = list(returns)

    # ── Publish path ──────────────────────────────────────────────────────
    def tick_publish(self) -> None:
        """Emit one round of pose / observation / fragment to the bus.

        Called by the rclpy timer (real DDS) or driven manually (tests).
        """
        ts = time.time_ns()
        self._publish_pose(ts)
        self._publish_observations(ts)
        self._publish_fragment(ts)
        self._tick_count += 1
        if self._tick_count % self.merge_interval_ticks == 0:
            self.merged_grid = self.merger.merge(list(self.fragment_buffer))

    def tick_gossip(self) -> None:
        """Emit one reputation gossip snapshot. Lower cadence than `tick_publish`."""
        snap = self.evaluator.gossip_snapshot()
        if not snap:
            return
        ts = time.time_ns()
        gossip = ReputationGossip(self.agent_id, snap, ts)
        env = self.identity.seal(KIND_REPUTATION, encode(gossip), timestamp_ns=ts)
        self.bus.publish("reputation", envelope_to_wire(env))
        for peer_id, ab in snap.items():
            self.rep_trace.record(peer_id, ab[0], ab[1], ts)

    def _publish_pose(self, ts: int) -> None:
        p = self.slam.pose()
        x, y = p.x, p.y
        if self._is_liar:
            x, y = x + LIE_OFFSET[0], y + LIE_OFFSET[1]
        pose = PoseReport(self.agent_id, x, y, p.theta, ts)
        env = self.identity.seal(KIND_POSE, encode(pose), timestamp_ns=ts)
        self.bus.publish("pose", envelope_to_wire(env))

    def _publish_observations(self, ts: int) -> None:
        """Beacon scalars on the wire — see specter.demo.orchestration.step
        for the rationale. Frame-invariant range drives trust; bearing is
        viz-only."""
        if not self._latest_beacons:
            return
        for beacon in self._latest_beacons:
            obs = Observation(
                self.agent_id, beacon.subject_id, beacon.range_m, beacon.bearing_rad, ts
            )
            env = self.identity.seal(KIND_OBSERVATION, encode(obs), timestamp_ns=ts)
            self.bus.publish("observation", envelope_to_wire(env))

    def _publish_fragment(self, ts: int) -> None:
        if not self._latest_scans:
            return
        p = self.slam.pose()
        fragment = encode_fragment(self.agent_id, p, self._latest_scans)
        env = self.identity.seal(KIND_FRAGMENT, fragment, timestamp_ns=ts)
        self.bus.publish("fragment", envelope_to_wire(env))


# ── CLI / dry-run path ────────────────────────────────────────────────────


def dry_run(
    agent_id: str,
    roster_path: Path,
    identity_path: Path,
    operator_pubkey: bytes,
) -> int:
    """Boot the wiring without rclpy, push one forged envelope, exit 0.

    Returns 0 on success; raises if the receive chain didn't classify the
    forged envelope as `bad_signature`. This is the headless smoke for the
    Wave 1 gate — proves the trust + SLAM stack composes correctly even
    without ROS2 installed.
    """
    from specter.crypto import Keypair

    roster = RosterLoader.from_yaml(roster_path, operator_pubkey)
    identity = load_identity(identity_path, agent_id=agent_id)
    bus = InProcessBus()
    attestation = MockAttestationProvider(allowlist={identity.keypair.public_bytes})
    list_telem = ListTelemetry()
    telemetry = StreamTelemetry(list_telem)
    SpecterAgentNode(
        agent_id=agent_id,
        identity=identity,
        roster=roster,
        bus=bus,
        attestation=attestation,
        telemetry=telemetry,
    )

    # Forge an envelope: real sender_id from the roster, but signed by a
    # stranger key. Receive chain should classify as bad_signature.
    peer_id = next(iter(k for k in roster.keys if k != agent_id), None)
    if peer_id is None:
        print("[dry-run] roster has no peers; skipping forge test", file=sys.stderr)
        return 0
    stranger = Identity(peer_id, Keypair.generate())
    forged = stranger.seal(KIND_POSE, encode(PoseReport(peer_id, 1.0, 1.0, 0.0, time.time_ns())))
    bus.publish("pose", envelope_to_wire(forged))

    anomalies = [
        ev for ev in list_telem.events if ev[0] == "trust.anomaly"
    ]
    if not anomalies:
        print("[dry-run] FAIL — no anomaly emitted for forged envelope", file=sys.stderr)
        return 1
    cat = anomalies[-1][1].get("category", "?")
    print(f"[dry-run] OK — caught forged envelope as {cat!r}", file=sys.stderr)
    return 0


def _build_rclpy_node(args: argparse.Namespace) -> Any:
    """Construct the rclpy-backed deployment. Imports rclpy lazily so the
    dry-run path doesn't require it."""
    from specter.transport.qos import qos_for_topic
    from specter.transport.sros2_bus import Sros2Bus
    from specter.transport.sros2_marshal import make_secure_node
    from specter.ros2.adapters import ImuAdapter, LidarAdapter

    operator_pubkey = bytes.fromhex(Path(args.operator_pubkey).read_text().strip())
    roster = RosterLoader.from_yaml(args.roster, operator_pubkey)
    identity = load_identity(args.identity, agent_id=args.agent_id)

    rclpy_node = make_secure_node(args.agent_id, args.keystore)
    list_telem = ListTelemetry()
    telemetry = StreamTelemetry(list_telem)
    attestation = MockAttestationProvider(allowlist={identity.keypair.public_bytes})
    bus = Sros2Bus(
        rclpy_node,
        roster=roster.inner,  # Sros2Bus's filter only needs the inner Roster
        revocation=RevocationList(),
        attestation=attestation,
        replay=ReplayWindow(),
        telemetry=telemetry,
        qos_for_topic=qos_for_topic,
    )
    agent = SpecterAgentNode(
        agent_id=args.agent_id,
        identity=identity,
        roster=roster,
        bus=bus,
        attestation=attestation,
        telemetry=telemetry,
    )
    LidarAdapter(rclpy_node, args.lidar_topic, agent.on_lidar)
    ImuAdapter(rclpy_node, args.imu_topic, agent.on_imu)
    rclpy_node.create_timer(args.publish_period_s, agent.tick_publish)
    rclpy_node.create_timer(args.gossip_period_s, agent.tick_gossip)
    return rclpy_node


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Per-robot specter agent node.")
    parser.add_argument("--agent-id", required=True, help="This robot's roster ID")
    parser.add_argument("--roster", type=Path, required=True, help="Signed roster YAML path")
    parser.add_argument("--identity", type=Path, required=True, help="PEM private key path")
    parser.add_argument(
        "--operator-pubkey",
        help="Path to operator.pub.hex (file containing operator pubkey hex)",
    )
    parser.add_argument(
        "--keystore", help="SROS2 keystore path; passed through to make_secure_node"
    )
    parser.add_argument("--lidar-topic", default="/scan")
    parser.add_argument("--imu-topic", default="/imu")
    parser.add_argument("--publish-period-s", type=float, default=0.1)
    parser.add_argument("--gossip-period-s", type=float, default=1.0)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Headless smoke (no rclpy required) — push one forged envelope and exit 0",
    )
    args = parser.parse_args(argv)

    if not args.operator_pubkey:
        # Default: operator.pub.hex sits next to roster.yaml.
        args.operator_pubkey = str(args.roster.parent / "operator.pub.hex")
    operator_pubkey = bytes.fromhex(Path(args.operator_pubkey).read_text().strip())

    if args.dry_run:
        return dry_run(args.agent_id, args.roster, args.identity, operator_pubkey)

    import rclpy  # type: ignore[import-not-found,unused-ignore] # noqa: PLC0415

    rclpy_node = _build_rclpy_node(args)
    try:
        rclpy.spin(rclpy_node)
    finally:
        rclpy_node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
