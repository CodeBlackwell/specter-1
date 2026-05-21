"""Shared test helpers."""

from __future__ import annotations

import json
import math

from specter.crypto import Keypair
from specter.secure_bus import Identity, Roster, envelope_from_wire
from specter.sim.sensors import ray_cast
from specter.sim.world import Wall
from specter.types import Pose, RangeMeasurement


def make_identity(agent_id: str) -> Identity:
    return Identity(agent_id=agent_id, keypair=Keypair.generate())


def make_roster(*identities: Identity) -> Roster:
    r = Roster()
    for ident in identities:
        r.add(ident.agent_id, ident.keypair.public_bytes)
    return r


def box_walls(x0: float, x1: float, y0: float, y1: float, dx: float = 0.0, dy: float = 0.0) -> tuple[Wall, ...]:
    return (
        Wall(x0 + dx, y0 + dy, x1 + dx, y0 + dy),
        Wall(x1 + dx, y0 + dy, x1 + dx, y1 + dy),
        Wall(x1 + dx, y1 + dy, x0 + dx, y1 + dy),
        Wall(x0 + dx, y1 + dy, x0 + dx, y0 + dy),
    )


def scans_against_walls(pose: Pose, walls, n_beams: int = 36) -> list[RangeMeasurement]:
    out: list[RangeMeasurement] = []
    for i in range(n_beams):
        body_angle = (i / n_beams) * 2.0 * math.pi
        d = ray_cast(pose.x, pose.y, pose.theta + body_angle, walls)
        out.append(RangeMeasurement(angle=body_angle, distance=d, t=pose.t))
    return out


def decode_grid(grid_bytes: bytes) -> dict:
    return json.loads(grid_bytes)


def sender_id_key(_topic: str, payload: bytes) -> str:
    """Realistic radio model: per-sender FIFO is preserved by the TX queue.
    Drop/jitter still applies globally; only cross-sender order can swap.
    Without this, jitter induces within-sender nonce reorder, which the
    replay window correctly rejects — that's a sender-side protocol issue,
    not a trust-engine resilience question.
    """
    return envelope_from_wire(payload).sender_id
