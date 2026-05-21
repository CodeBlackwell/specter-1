"""Wave 3 — Path / waypoint geometry for Free Play.

Mirrors `ui/packages/sim-core/src/paths.ts`. Math constants must stay
byte-equivalent across the two languages so the Composer's "default path
for preset" produces identical trajectories in TS-driven UI runs and
Python eval scenarios.

A `Path` is an ordered tuple of `(x, y)` waypoints plus a `closed` flag.
`bounce` is only meaningful for open paths (the follower reverses direction
at endpoints).

`path_follower(path, *, speed, arrival_threshold_m=0.2)` returns a
callable `planner(agents, t, dt)` that yields `{agent_id: (vx, vy)}`
velocity commands.  Per-agent waypoint-index state lives in the closure.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

Point2 = tuple[float, float]
PathPreset = Literal["LOOP", "LINEAR", "FIGURE-8"]

DEFAULT_ARRIVAL_M = 0.2
FIGURE8_DEFAULT_SAMPLES = 32
LOOP_INSET_FRACTION = 0.2


@dataclass(frozen=True)
class Path:
    waypoints: tuple[Point2, ...]
    closed: bool
    bounce: bool = False


@dataclass(frozen=True)
class Bounds:
    min_x: float
    min_y: float
    max_x: float
    max_y: float


class _AgentLike(Protocol):
    id: str
    x: float
    y: float


def loop_waypoints(points: Iterable[Point2]) -> Path:
    """Closed loop through the given waypoints."""
    return Path(waypoints=tuple((float(p[0]), float(p[1])) for p in points), closed=True)


def linear_path(start: Point2, end: Point2, *, bounce: bool = False) -> Path:
    """Open path from `start` to `end`. With `bounce=True`, the follower
    reverses direction at either endpoint."""
    return Path(
        waypoints=((float(start[0]), float(start[1])), (float(end[0]), float(end[1]))),
        closed=False,
        bounce=bounce,
    )


def figure8(*, center: Point2, a: float, b: float, samples: int = FIGURE8_DEFAULT_SAMPLES) -> Path:
    """Lissajous figure-8: x = cx + a·sin(t), y = cy + b·sin(2t),
    t evenly spaced over [0, 2π) at `samples` points. Closed."""
    cx, cy = center
    pts: list[Point2] = []
    for i in range(samples):
        t = 2.0 * math.pi * i / samples
        pts.append((cx + a * math.sin(t), cy + b * math.sin(2.0 * t)))
    return Path(waypoints=tuple(pts), closed=True)


def freehand(points: Iterable[Point2]) -> Path:
    """Open polyline.  The follower halts at the last waypoint."""
    return Path(waypoints=tuple((float(p[0]), float(p[1])) for p in points), closed=False)


def default_path_for(preset: PathPreset, bounds: Bounds) -> Path:
    """Built-in preset path geometry derived from world bounds.

    LOOP → inset regular pentagon (5 vertices, 20% inset).
    LINEAR → bounds.min → bounds.max diagonal.
    FIGURE-8 → centered Lissajous (a=width/3, b=height/3, 32 samples).
    FREEHAND raises — caller must supply explicit waypoints.
    """
    width = bounds.max_x - bounds.min_x
    height = bounds.max_y - bounds.min_y
    cx = (bounds.min_x + bounds.max_x) / 2.0
    cy = (bounds.min_y + bounds.max_y) / 2.0
    if preset == "LOOP":
        rx = (width / 2.0) * (1.0 - LOOP_INSET_FRACTION)
        ry = (height / 2.0) * (1.0 - LOOP_INSET_FRACTION)
        pts: list[Point2] = []
        for i in range(5):
            theta = -math.pi / 2.0 + 2.0 * math.pi * i / 5.0
            pts.append((cx + rx * math.cos(theta), cy + ry * math.sin(theta)))
        return Path(waypoints=tuple(pts), closed=True)
    if preset == "LINEAR":
        return linear_path((bounds.min_x, bounds.min_y), (bounds.max_x, bounds.max_y))
    if preset == "FIGURE-8":
        return figure8(
            center=(cx, cy),
            a=width / 3.0,
            b=height / 3.0,
            samples=FIGURE8_DEFAULT_SAMPLES,
        )
    raise ValueError(
        f'default_path_for: preset "{preset}" has no default geometry — supply explicit waypoints'
    )


Planner = Callable[[Sequence[_AgentLike], float, float], dict[str, Point2]]


def path_follower(path: Path, *, speed: float, arrival_threshold_m: float = DEFAULT_ARRIVAL_M) -> Planner:
    """Per-agent path-follower planner.

    Returns a callable `(agents, t, dt) -> {id: (vx, vy)}` that commands
    velocity toward each agent's current target waypoint, advancing when
    within `arrival_threshold_m`.  Closed paths wrap to W0; open + bounce
    reverses direction at endpoints; open without bounce halts at the
    last waypoint.
    """
    state: dict[str, list[int]] = {}  # id → [idx, direction]
    waypoints = path.waypoints
    last = len(waypoints) - 1

    def _advance(s: list[int]) -> None:
        if path.closed:
            s[0] = (s[0] + 1) % len(waypoints)
            return
        if path.bounce:
            nxt = s[0] + s[1]
            if nxt < 0 or nxt > last:
                s[1] = -s[1]
                s[0] = s[0] + s[1]
            else:
                s[0] = nxt
            return
        if s[0] < last:
            s[0] += 1

    def planner(agents: Sequence[_AgentLike], _t: float, _dt: float) -> dict[str, Point2]:
        cmds: dict[str, Point2] = {}
        if not waypoints:
            return cmds
        for a in agents:
            s = state.setdefault(a.id, [0, 1])
            target = waypoints[s[0]]
            dx = target[0] - a.x
            dy = target[1] - a.y
            dist = math.hypot(dx, dy)
            if dist <= arrival_threshold_m:
                halted = (not path.closed) and (not path.bounce) and s[0] == last
                _advance(s)
                if halted:
                    cmds[a.id] = (0.0, 0.0)
                    continue
                nxt = waypoints[s[0]]
                ndx = nxt[0] - a.x
                ndy = nxt[1] - a.y
                ndist = math.hypot(ndx, ndy)
                if ndist == 0.0:
                    cmds[a.id] = (0.0, 0.0)
                else:
                    cmds[a.id] = ((ndx / ndist) * speed, (ndy / ndist) * speed)
                continue
            cmds[a.id] = ((dx / dist) * speed, (dy / dist) * speed)
        return cmds

    return planner
