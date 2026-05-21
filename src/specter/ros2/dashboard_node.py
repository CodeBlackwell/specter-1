"""Operator-station ROS2 node — read-only dashboard for swarm health.

Subscribes to the four envelope topics (`pose`, `observation`, `reputation`,
`fragment`) and renders three panels with the demo's pygame helpers:

  * Reputation bars + rep-history sparkline (per peer)
  * Anomaly stream (typed `AnomalyEvent` ring)
  * Per-robot belief overlay (thumbnail-grid of each peer's most recent
    merged occupancy fragment)

NO ground-truth dependencies — the dashboard sees only what the swarm
gossips. There's no `Agent` object, no `World` walls, no lidar rays from
ground-truth pose; only the bus envelopes the operator can legitimately
observe.

`SDL_VIDEODRIVER=dummy` is supported for headless smoke (pygame surface
operations without a real window). Set the env var before constructing
the node.

The constructor takes a `MessageBus` so tests can pass `InProcessBus`;
`from_rclpy(...)` is the deployment helper that wraps an `rclpy.Node` +
`Sros2Bus`.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections import deque
from collections.abc import Callable
from pathlib import Path
from typing import Any

from specter.demo.orchestration import StreamTelemetry, pub_bytes
from specter.identity import (
    AttestationProvider,
    MockAttestationProvider,
    MutableRoster,
    RevocationList,
)
from specter.interfaces import MessageBus
from specter.messages import (
    KIND_FRAGMENT,
    KIND_OBSERVATION,
    KIND_POSE,
    KIND_REPUTATION,
    decode,
)
from specter.ros2.roster_loader import RosterLoader
from specter.secure_bus import (
    InProcessBus,
    ReplayWindow,
    VerificationError,
    envelope_from_wire,
)
from specter.telemetry import ReputationTrace
from specter.transport.time_sync import DEFAULT_MAX_SKEW_NS, validate_timestamp
from specter.trust import BetaTrustEvaluator, ListTelemetry


class SpecterDashboardNode:
    """Operator-station observer — accumulates per-peer state from the bus.

    Mirrors what an honest peer would compute (a `BetaTrustEvaluator`
    snapshot, a `ReputationTrace`, the latest `merged_grid` per peer) but
    with `agent_id="dashboard"` — the dashboard never publishes, only
    observes. The same hardened receive chain runs so a malformed peer
    can't poison the dashboard's view.
    """

    DASHBOARD_ID = "_dashboard"

    def __init__(
        self,
        roster: MutableRoster,
        bus: MessageBus,
        *,
        revocation: RevocationList | None = None,
        attestation: AttestationProvider | None = None,
        attestation_required: bool = False,
        latest_fragments_per_peer: int = 1,
    ) -> None:
        self.roster = roster
        self.bus = bus
        self.revocation = revocation or RevocationList()
        self.attestation = attestation
        self.attestation_required = attestation_required
        self.list_telemetry = ListTelemetry()
        self.telemetry = StreamTelemetry(self.list_telemetry)
        self.evaluator = BetaTrustEvaluator(
            telemetry=self.telemetry, self_id=self.DASHBOARD_ID
        )
        self.replay = ReplayWindow()
        self.rep_trace = ReputationTrace()
        self.latest_fragments: dict[str, deque[bytes]] = {}
        self._latest_fragments_per_peer = latest_fragments_per_peer

        self._handler = self._make_handler()
        for topic in ("pose", "observation", "reputation", "fragment"):
            bus.subscribe(topic, self._handler)

    # ── Receive chain ─────────────────────────────────────────────────────
    def _make_handler(self) -> Callable[[bytes], None]:
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
                    snap = self.evaluator.gossip_snapshot()
                    for peer_id, ab in snap.items():
                        self.rep_trace.record(peer_id, ab[0], ab[1], env.timestamp_ns)
                elif env.kind == KIND_FRAGMENT:
                    buf = self.latest_fragments.setdefault(
                        env.sender_id, deque(maxlen=self._latest_fragments_per_peer)
                    )
                    buf.append(payload)
            except VerificationError as e:
                self.evaluator.record_reject(env, e)

        return on_envelope

    # ── Read-only views the renderer consumes ─────────────────────────────
    def known_peers(self) -> list[str]:
        return list(self.roster.keys.keys())

    def reputation_snapshot(self) -> dict[str, float]:
        """{peer_id: reputation in [0,1]} — what to render as bars."""
        return {pid: self.evaluator.reputation(pid) for pid in self.known_peers()}

    def latest_fragment(self, peer_id: str) -> bytes | None:
        buf = self.latest_fragments.get(peer_id)
        return buf[-1] if buf else None


# ── Render loop ──────────────────────────────────────────────────────────


def render_frame(
    node: SpecterDashboardNode,
    screen: Any,  # pygame.Surface
    font: Any,
    bold: Any,
    *,
    log_w: int = 360,
    grid_thumb_w: int = 80,
) -> None:
    """One pass of the dashboard's panels onto `screen`. Pure render — no
    state mutation. Safe to call from a pygame main loop or once-and-quit
    in a test under `SDL_VIDEODRIVER=dummy`."""
    import pygame

    from specter.viz.dashboard import (
        DIVIDER,
        GOLD,
        HIST_H,
        INK_DIM,
        PADDING,
        PANEL,
        PEER_COLORS,
        draw_anomaly_panel,
        draw_history_overlay,
        draw_merged_grid,
    )

    screen.fill((10, 13, 10))
    win_w, win_h = screen.get_size()
    log_x = win_w - log_w
    pygame.draw.rect(screen, PANEL, (log_x, 0, log_w, win_h))
    pygame.draw.line(screen, DIVIDER, (log_x, 0), (log_x, win_h), 1)

    peers = node.known_peers()
    rep = node.reputation_snapshot()
    y = PADDING
    screen.blit(bold.render("REPUTATION", True, GOLD), (log_x + 12, y))
    y += 18
    bar_w = log_w - 60
    for idx, peer in enumerate(peers):
        color = PEER_COLORS[idx % len(PEER_COLORS)]
        screen.blit(font.render(peer[:8], True, INK_DIM), (log_x + 12, y))
        bar_x = log_x + 70
        pygame.draw.rect(screen, DIVIDER, (bar_x, y + 3, bar_w, 8))
        fill = max(0.0, min(1.0, rep.get(peer, 0.5)))
        if fill > 0:
            pygame.draw.rect(screen, color, (bar_x, y + 3, int(bar_w * fill), 8))
        y += 14

    y += 10
    y = draw_anomaly_panel(screen, font, bold, node.telemetry, log_x + 12, y, log_w - 24)

    # Sparkline
    draw_history_overlay(
        screen, node.rep_trace, peers, time.time_ns(),
        (log_x + 12, win_h - HIST_H - PADDING), font,
    )

    # Per-robot belief thumbnails (US-122) — small grids stacked along the
    # left strip. Each thumbnail uses `draw_merged_grid` against a small
    # surface, then blits scaled into the dashboard.
    thumb_x = PADDING
    thumb_y = PADDING
    for idx, peer in enumerate(peers):
        frag = node.latest_fragment(peer)
        if frag is None:
            continue
        thumb = pygame.Surface((grid_thumb_w, grid_thumb_w))
        thumb.fill(PANEL)
        # The merged-grid drawer expects a world-frame surface; passing a
        # small thumb means the cells render small. That's the intent —
        # this is a read-at-a-glance overview, not a precision view.
        draw_merged_grid(thumb, frag, world_h=grid_thumb_w / 50.0)
        screen.blit(thumb, (thumb_x, thumb_y + idx * (grid_thumb_w + 8)))


# ── CLI / dry-run path ────────────────────────────────────────────────────


def dry_run(roster_path: Path, operator_pubkey: bytes) -> int:
    """Headless smoke (no rclpy required, no real DDS).

    Builds the dashboard against `InProcessBus`, hand-publishes a tiny
    sequence of envelopes, calls `render_frame` once under
    `SDL_VIDEODRIVER=dummy`, exits 0. Proves the renderer + receive chain
    composes without raising.
    """
    import os

    os.environ.setdefault("SDL_VIDEODRIVER", "dummy")
    import pygame

    roster = RosterLoader.from_yaml(roster_path, operator_pubkey)
    bus = InProcessBus()
    attestation = MockAttestationProvider(allowlist=set())
    node = SpecterDashboardNode(
        roster=roster, bus=bus, attestation=attestation
    )

    pygame.init()
    screen = pygame.display.set_mode((800, 600))
    font = pygame.font.SysFont("Menlo", 11)
    bold = pygame.font.SysFont("Menlo", 12, bold=True)
    render_frame(node, screen, font, bold)
    pygame.quit()
    print("[dashboard] dry-run rendered one frame OK", file=sys.stderr)
    return 0


def _build_rclpy_node(args: argparse.Namespace) -> tuple[Any, SpecterDashboardNode]:
    from specter.transport.qos import qos_for_topic
    from specter.transport.sros2_bus import Sros2Bus
    from specter.transport.sros2_marshal import make_secure_node

    operator_pubkey = bytes.fromhex(Path(args.operator_pubkey).read_text().strip())
    roster = RosterLoader.from_yaml(args.roster, operator_pubkey)
    rclpy_node = make_secure_node("specter_dashboard", args.keystore)
    bus = Sros2Bus(rclpy_node, qos_for_topic=qos_for_topic)
    dash = SpecterDashboardNode(roster=roster, bus=bus)
    return rclpy_node, dash


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Operator-station dashboard.")
    parser.add_argument("--roster", type=Path, required=True)
    parser.add_argument("--operator-pubkey")
    parser.add_argument("--keystore")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Headless smoke (no rclpy required) — render one frame and exit 0",
    )
    args = parser.parse_args(argv)

    if not args.operator_pubkey:
        args.operator_pubkey = str(args.roster.parent / "operator.pub.hex")
    operator_pubkey = bytes.fromhex(Path(args.operator_pubkey).read_text().strip())

    if args.dry_run:
        return dry_run(args.roster, operator_pubkey)

    import pygame
    import rclpy  # type: ignore[import-not-found,unused-ignore] # noqa: PLC0415

    rclpy_node, dash = _build_rclpy_node(args)
    pygame.init()
    screen = pygame.display.set_mode((1000, 700))
    pygame.display.set_caption("SPECTER-1 // operator dashboard")
    font = pygame.font.SysFont("Menlo", 11)
    bold = pygame.font.SysFont("Menlo", 12, bold=True)
    clock = pygame.time.Clock()
    try:
        running = True
        while running and rclpy.ok():
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    running = False
            rclpy.spin_once(rclpy_node, timeout_sec=0.0)
            render_frame(dash, screen, font, bold)
            pygame.display.flip()
            clock.tick(30)
    finally:
        pygame.quit()
        rclpy_node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
