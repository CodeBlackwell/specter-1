"""Optional wall-bounce: reflect velocity off any wall the agent crossed in
the last step. Off by default — Phase 1 prefers pure observability (ADR 0001).
"""

import math

from .agent import Agent
from .world import World

EPSILON = 1e-3


def _segment_cross(
    p1x: float, p1y: float, p2x: float, p2y: float,
    q1x: float, q1y: float, q2x: float, q2y: float,
) -> float | None:
    rx, ry = p2x - p1x, p2y - p1y
    sx, sy = q2x - q1x, q2y - q1y
    denom = rx * sy - ry * sx
    if abs(denom) < 1e-9:
        return None
    t = ((q1x - p1x) * sy - (q1y - p1y) * sx) / denom
    u = ((q1x - p1x) * ry - (q1y - p1y) * rx) / denom
    if 0.0 < t <= 1.0 and 0.0 <= u <= 1.0:
        return t
    return None


def bounce(agent: Agent, prev_x: float, prev_y: float, world: World) -> None:
    for w in world.walls:
        t = _segment_cross(prev_x, prev_y, agent.x, agent.y, w.x1, w.y1, w.x2, w.y2)
        if t is None:
            continue
        dx, dy = agent.x - prev_x, agent.y - prev_y
        safe = max(0.0, t - EPSILON)
        agent.x = prev_x + dx * safe
        agent.y = prev_y + dy * safe
        wx, wy = w.x2 - w.x1, w.y2 - w.y1
        wlen = math.hypot(wx, wy)
        nx, ny = -wy / wlen, wx / wlen
        v_dot_n = agent.vx * nx + agent.vy * ny
        agent.vx -= 2.0 * v_dot_n * nx
        agent.vy -= 2.0 * v_dot_n * ny
        return
