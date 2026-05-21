"""Motion planners — Wave 2 of the Free Play Compose-then-Watch redesign.

Each factory returns a callable that maps the current agent set + tick context
to per-agent velocity commands. Planners are pure-functional given fixed config
+ RNG state; closure-held state (lawnmower direction, random_walk heading) is
deterministic from initial conditions.

TS parity: ui/packages/sim-core/src/planners.ts uses identical math and constants.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Callable, Literal

from .agent import Agent


@dataclass(frozen=True)
class Bounds:
    xmin: float
    ymin: float
    xmax: float
    ymax: float


@dataclass(frozen=True)
class VelocityCommand:
    vx: float
    vy: float
    omega: float = 0.0


@dataclass(frozen=True)
class PlannerContext:
    tick: int
    t: float
    dt: float


Planner = Callable[[list[Agent], PlannerContext], dict[str, VelocityCommand]]


# ---------------------------------------------------------------------------
# Lawnmower — agents sweep parallel stripes inside a rectangular field.
# Each agent is assigned a stripe index by its position in the `agents` list;
# stripes are stacked along Y. Within a stripe the agent walks +X to xmax,
# flips, walks back to xmin, flips, repeat.
# ---------------------------------------------------------------------------


def lawnmower(bounds: Bounds, stripe_m: float, speed: float) -> Planner:
    direction: dict[str, int] = {}

    def planner(agents: list[Agent], _ctx: PlannerContext) -> dict[str, VelocityCommand]:
        cmds: dict[str, VelocityCommand] = {}
        midpoint_x = (bounds.xmin + bounds.xmax) / 2
        for i, a in enumerate(agents):
            d = direction.get(a.id)
            if d is None:
                d = 1 if a.x <= midpoint_x else -1
                direction[a.id] = d
            if d == 1 and a.x >= bounds.xmax:
                d = -1
                direction[a.id] = d
            elif d == -1 and a.x <= bounds.xmin:
                d = 1
                direction[a.id] = d
            stripe_y = bounds.ymin + (i + 0.5) * stripe_m
            clamped_y = min(stripe_y, bounds.ymax)
            ey = clamped_y - a.y
            cmds[a.id] = VelocityCommand(vx=d * speed, vy=ey, omega=0.0)
        return cmds

    return planner


# ---------------------------------------------------------------------------
# Orbit — agents trace a circle around `center` at `radius`, angular velocity
# `omega_rad` (rad/s, signed: + = CCW, - = CW). The next-step closed form is
# `desired = center + radius·(cos(θ+ωdt), sin(θ+ωdt))`; velocity = (desired -
# current) / dt. Self-corrects radial error in one tick.
# ---------------------------------------------------------------------------


def orbit(center: tuple[float, float], radius: float, omega_rad: float) -> Planner:
    cx, cy = center

    def planner(agents: list[Agent], ctx: PlannerContext) -> dict[str, VelocityCommand]:
        cmds: dict[str, VelocityCommand] = {}
        for a in agents:
            dx = a.x - cx
            dy = a.y - cy
            theta = math.atan2(dy, dx)
            next_theta = theta + omega_rad * ctx.dt
            desired_x = cx + radius * math.cos(next_theta)
            desired_y = cy + radius * math.sin(next_theta)
            cmds[a.id] = VelocityCommand(
                vx=(desired_x - a.x) / ctx.dt,
                vy=(desired_y - a.y) / ctx.dt,
                omega=omega_rad,
            )
        return cmds

    return planner


# ---------------------------------------------------------------------------
# Rendezvous — agents converge to `target` at `speed`, then hold. An agent
# within one `speed·dt` step of the target commands zero velocity.
# ---------------------------------------------------------------------------


def rendezvous(target: tuple[float, float], speed: float) -> Planner:
    tx, ty = target

    def planner(agents: list[Agent], ctx: PlannerContext) -> dict[str, VelocityCommand]:
        cmds: dict[str, VelocityCommand] = {}
        stop_threshold = speed * ctx.dt
        for a in agents:
            dx = tx - a.x
            dy = ty - a.y
            dist = math.hypot(dx, dy)
            if dist <= stop_threshold:
                cmds[a.id] = VelocityCommand(vx=0.0, vy=0.0, omega=0.0)
            else:
                cmds[a.id] = VelocityCommand(
                    vx=(dx / dist) * speed,
                    vy=(dy / dist) * speed,
                    omega=0.0,
                )
        return cmds

    return planner


# ---------------------------------------------------------------------------
# Random walk — each agent maintains a heading that diffuses by a Gaussian
# step every tick (turn_sigma rad). Velocity = speed in the current heading.
# The RNG is consumed in agent order so trajectories are deterministic for a
# fixed agent ordering and a seeded random.Random.
# ---------------------------------------------------------------------------


def random_walk(rng: random.Random, speed: float, turn_sigma: float) -> Planner:
    heading: dict[str, float] = {}

    def planner(agents: list[Agent], _ctx: PlannerContext) -> dict[str, VelocityCommand]:
        cmds: dict[str, VelocityCommand] = {}
        for a in agents:
            h = heading.get(a.id)
            if h is None:
                h = a.theta
            h += rng.gauss(0.0, turn_sigma)
            heading[a.id] = h
            cmds[a.id] = VelocityCommand(
                vx=speed * math.cos(h),
                vy=speed * math.sin(h),
                omega=0.0,
            )
        return cmds

    return planner


# ---------------------------------------------------------------------------
# Catalog — string-keyed factory used by simStore.flightPattern. Note: Python
# matches the TS uppercase enum convention for round-tripping with the worker.
# ---------------------------------------------------------------------------

FlightPattern = Literal["LAWNMOWER", "ORBIT", "RENDEZVOUS", "RANDOM_WALK"]


def default_planner_for(
    pattern: FlightPattern,
    *,
    bounds: Bounds,
    agent_count: int,
    rng: random.Random | None = None,
) -> Planner:
    cx = (bounds.xmin + bounds.xmax) / 2
    cy = (bounds.ymin + bounds.ymax) / 2
    width = bounds.xmax - bounds.xmin
    height = bounds.ymax - bounds.ymin
    if pattern == "LAWNMOWER":
        return lawnmower(bounds, stripe_m=height / max(1, agent_count), speed=1.0)
    if pattern == "ORBIT":
        return orbit(center=(cx, cy), radius=min(width, height) / 3, omega_rad=0.3)
    if pattern == "RENDEZVOUS":
        return rendezvous(target=(cx, cy), speed=1.0)
    if pattern == "RANDOM_WALK":
        if rng is None:
            raise ValueError("RANDOM_WALK requires an rng")
        return random_walk(rng, speed=1.0, turn_sigma=0.2)
    raise ValueError(f"unknown flight pattern: {pattern!r}")
