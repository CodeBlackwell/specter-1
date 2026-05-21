"""Wave 2 — motion planner library, Python parity.

Mirrors ui/packages/sim-core/tests/planners.test.ts. Tests are behavioral
(direction flips, radial settling, convergence-and-hold, deterministic replay)
rather than byte-exact against TS — the RNG implementations differ; only
math + closure semantics are shared.
"""

from __future__ import annotations

import math
import random

import pytest

from specter.sim.agent import Agent
from specter.sim.planners import (
    Bounds,
    PlannerContext,
    lawnmower,
    orbit,
    random_walk,
    rendezvous,
)

DT = 0.1


def _run(agents: list[Agent], planner, ticks: int) -> list[list[Agent]]:
    """Apply planner cmds + integrate dt manually; return per-tick agent
    snapshots. We avoid pulling in the full Simulation here so the test
    isolates planner math from physics noise."""
    trajectory: list[list[Agent]] = []
    t = 0.0
    for i in range(ticks):
        ctx = PlannerContext(tick=i, t=t, dt=DT)
        cmds = planner(agents, ctx)
        for a in agents:
            c = cmds.get(a.id)
            if c is None:
                continue
            a.vx, a.vy, a.omega = c.vx, c.vy, c.omega
        for a in agents:
            a.step(DT)
        t += DT
        trajectory.append([a.snapshot() for a in agents])
    return trajectory


def _row(n: int) -> list[Agent]:
    return [Agent(id=f"a{i}", x=0.0, y=float(i), theta=0.0) for i in range(n)]


class TestLawnmower:
    def test_walks_to_xmax_then_flips_back(self) -> None:
        agents = _row(2)
        bounds = Bounds(xmin=0.0, ymin=0.0, xmax=5.0, ymax=4.0)
        trail = _run(agents, lawnmower(bounds, stripe_m=2.0, speed=1.0), 80)
        a0_xs = [snap[0].x for snap in trail]
        peak = max(a0_xs)
        assert peak > 4.9
        assert peak <= 5.1
        peak_idx = a0_xs.index(peak)
        # After the flip, x must decrease over the next few ticks
        assert a0_xs[peak_idx + 5] < a0_xs[peak_idx]

    def test_agents_separate_into_stripes(self) -> None:
        agents = _row(3)
        bounds = Bounds(xmin=0.0, ymin=0.0, xmax=5.0, ymax=6.0)
        trail = _run(agents, lawnmower(bounds, stripe_m=2.0, speed=1.0), 30)
        final = trail[-1]
        # Stripes target y = 1, 3, 5
        assert final[0].y < final[1].y < final[2].y


class TestOrbit:
    def test_settles_on_radius_in_one_tick(self) -> None:
        agents = [Agent(id="a0", x=2.0, y=0.0, theta=0.0)]
        trail = _run(agents, orbit(center=(0.0, 0.0), radius=1.0, omega_rad=math.pi / 8), 40)
        for snap in trail:
            r = math.hypot(snap[0].x, snap[0].y)
            assert r == pytest.approx(1.0, abs=1e-8)

    def test_ccw_omega_advances_angle(self) -> None:
        agents = [Agent(id="a0", x=1.0, y=0.0, theta=0.0)]
        trail = _run(agents, orbit(center=(0.0, 0.0), radius=1.0, omega_rad=math.pi / 4), 4)
        final = trail[-1][0]
        theta = math.atan2(final.y, final.x)
        # Total swept angle = π/4 · 0.4 = π/10
        assert theta == pytest.approx(math.pi / 10, abs=1e-8)


class TestRendezvous:
    def test_converges_and_holds(self) -> None:
        agents = [
            Agent(id="a0", x=-5.0, y=0.0, theta=0.0),
            Agent(id="a1", x=0.0, y=5.0, theta=0.0),
        ]
        trail = _run(agents, rendezvous(target=(0.0, 0.0), speed=1.0), 120)
        final = trail[-1]
        for a in final:
            assert math.hypot(a.x, a.y) <= 0.15
        # Hold property: positions at tick 100 ≈ positions at tick 120
        tick100 = trail[99]
        for i, a in enumerate(final):
            assert a.x == pytest.approx(tick100[i].x, abs=1e-4)
            assert a.y == pytest.approx(tick100[i].y, abs=1e-4)


class TestRandomWalk:
    def test_deterministic_replay(self) -> None:
        def _make() -> list[Agent]:
            return [
                Agent(id="a0", x=0.0, y=0.0, theta=0.0),
                Agent(id="a1", x=0.0, y=0.0, theta=math.pi),
            ]

        trail_a = _run(_make(), random_walk(random.Random(7), speed=1.0, turn_sigma=0.1), 50)
        trail_b = _run(_make(), random_walk(random.Random(7), speed=1.0, turn_sigma=0.1), 50)
        for snap_a, snap_b in zip(trail_a, trail_b, strict=True):
            for a, b in zip(snap_a, snap_b, strict=True):
                assert a.x == pytest.approx(b.x, abs=1e-12)
                assert a.y == pytest.approx(b.y, abs=1e-12)

    def test_speed_magnitude_preserved(self) -> None:
        agents = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
        planner = random_walk(random.Random(7), speed=2.0, turn_sigma=0.2)
        t = 0.0
        for i in range(30):
            ctx = PlannerContext(tick=i, t=t, dt=DT)
            cmds = planner(agents, ctx)
            c = cmds["a0"]
            assert math.hypot(c.vx, c.vy) == pytest.approx(2.0, abs=1e-8)
            agents[0].vx, agents[0].vy = c.vx, c.vy
            agents[0].step(DT)
            t += DT
