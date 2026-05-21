"""Wave 3 — path / waypoint geometry parity tests.

Mirrors `ui/packages/sim-core/tests/paths.test.ts`. The TS sim-core
drives the React Workshop Console; this Python module is the source of
truth for any eval scenario that wants reproducible path-following on
the headless side. Both must produce the same waypoint geometry (math
constants byte-equivalent) and the same advancement behavior.
"""

import math

import pytest

from specter.sim.agent import Agent
from specter.sim.paths import (
    Bounds,
    default_path_for,
    figure8,
    freehand,
    linear_path,
    loop_waypoints,
    path_follower,
)


def _step(agents: list[Agent], planner, dt: float, ticks: int) -> list[tuple[float, float, float, float]]:
    """Run the planner for `ticks` steps and return the agent[0] trace
    of (x, y, vx, vy) per tick. Pure Euler integration — no swarm noise."""
    trace: list[tuple[float, float, float, float]] = []
    for i in range(ticks):
        cmds = planner(agents, i * dt, dt)
        for a in agents:
            if a.id in cmds:
                a.vx, a.vy = cmds[a.id]
            a.step(dt)
        trace.append((agents[0].x, agents[0].y, agents[0].vx, agents[0].vy))
    return trace


def test_loop_waypoints_is_closed():
    p = loop_waypoints([(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)])
    assert p.closed is True
    assert len(p.waypoints) == 4
    assert p.waypoints[0] == (0.0, 0.0)


def test_linear_path_defaults_bounce_off():
    p = linear_path((0.0, 0.0), (10.0, 0.0))
    assert p.closed is False
    assert p.bounce is False
    assert p.waypoints == ((0.0, 0.0), (10.0, 0.0))


def test_figure8_produces_samples_on_lissajous_curve():
    samples = 32
    p = figure8(center=(0.0, 0.0), a=10.0, b=5.0, samples=samples)
    assert p.closed is True
    assert len(p.waypoints) == samples
    # t=0 → (0, 0)
    assert p.waypoints[0] == pytest.approx((0.0, 0.0), abs=1e-10)
    # t=π/2 (i=8) → (10·sin(π/2), 5·sin(π)) = (10, 0)
    assert p.waypoints[8] == pytest.approx((10.0, 0.0), abs=1e-10)
    # t=π (i=16) → (0, 0)
    assert p.waypoints[16] == pytest.approx((0.0, 0.0), abs=1e-10)


def test_freehand_open_polyline():
    p = freehand([(0.0, 0.0), (2.0, 0.0), (4.0, 3.0)])
    assert p.closed is False
    assert len(p.waypoints) == 3


def test_default_path_for_loop_pentagon_inset():
    bounds = Bounds(0.0, 0.0, 100.0, 100.0)
    p = default_path_for("LOOP", bounds)
    assert len(p.waypoints) == 5
    assert p.closed is True
    # Radius 50 · (1 − 0.20) = 40, center (50, 50)
    for x, y in p.waypoints:
        r = math.hypot(x - 50.0, y - 50.0)
        assert r == pytest.approx(40.0, abs=1e-6)


def test_default_path_for_linear_diagonal():
    bounds = Bounds(0.0, 0.0, 100.0, 100.0)
    p = default_path_for("LINEAR", bounds)
    assert p.waypoints == ((0.0, 0.0), (100.0, 100.0))
    assert p.closed is False


def test_default_path_for_figure8_centered_and_scaled():
    bounds = Bounds(0.0, 0.0, 100.0, 100.0)
    p = default_path_for("FIGURE-8", bounds)
    assert len(p.waypoints) == 32
    assert p.waypoints[0] == pytest.approx((50.0, 50.0), abs=1e-10)
    assert p.waypoints[8] == pytest.approx((50.0 + 100.0 / 3.0, 50.0), abs=1e-10)


def test_default_path_for_freehand_raises():
    bounds = Bounds(0.0, 0.0, 100.0, 100.0)
    with pytest.raises(ValueError):
        default_path_for("FREEHAND", bounds)  # type: ignore[arg-type]


def test_follower_visits_each_waypoint_and_wraps_on_closed_loop():
    path = loop_waypoints([(2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (0.0, 0.0)])
    agents = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    planner = path_follower(path, speed=1.0)
    trace = _step(agents, planner, dt=0.1, ticks=200)
    visited = [False, False, False, False]
    for x, y, _vx, _vy in trace:
        for w, (wx, wy) in enumerate(path.waypoints):
            if math.hypot(x - wx, y - wy) <= 0.25:
                visited[w] = True
    assert all(visited)
    # After visiting W3 the agent must come back near W0 — proves the closed wrap.
    tail = trace[-30:]
    came_back = any(math.hypot(x - 2.0, y - 0.0) <= 1.0 for x, y, _, _ in tail)
    assert came_back


def test_follower_bounce_reverses_at_endpoint():
    path = linear_path((0.0, 0.0), (3.0, 0.0), bounce=True)
    agents = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    planner = path_follower(path, speed=1.0)
    trace = _step(agents, planner, dt=0.1, ticks=100)
    xs = [t[0] for t in trace]
    max_x = max(xs)
    assert max_x > 2.8
    max_idx = xs.index(max_x)
    after = xs[max_idx + 1 :]
    assert len(after) > 5
    assert min(after) < max_x - 1.0


def test_follower_no_bounce_halts_at_last_waypoint():
    path = linear_path((0.0, 0.0), (3.0, 0.0))
    agents = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    planner = path_follower(path, speed=1.0)
    trace = _step(agents, planner, dt=0.1, ticks=80)
    x_final, y_final, vx_final, vy_final = trace[-1]
    assert abs(x_final - 3.0) < 1.0
    assert vx_final == pytest.approx(0.0, abs=1e-6)
    assert vy_final == pytest.approx(0.0, abs=1e-6)


def test_freehand_follower_halts_at_last_waypoint():
    path = freehand([(0.0, 0.0), (2.0, 0.0), (2.0, 2.0)])
    agents = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    planner = path_follower(path, speed=1.0)
    trace = _step(agents, planner, dt=0.1, ticks=100)
    x_final, y_final, vx_final, vy_final = trace[-1]
    assert vx_final == pytest.approx(0.0, abs=1e-6)
    assert vy_final == pytest.approx(0.0, abs=1e-6)
    assert math.hypot(x_final - 2.0, y_final - 2.0) < 0.3


def test_follower_deterministic_re_run_produces_identical_trajectories():
    path = figure8(center=(0.0, 0.0), a=5.0, b=3.0, samples=16)
    a1 = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    a2 = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    p1 = path_follower(path, speed=1.0)
    p2 = path_follower(path, speed=1.0)
    t1 = _step(a1, p1, dt=0.1, ticks=150)
    t2 = _step(a2, p2, dt=0.1, ticks=150)
    assert t1 == t2


def test_arrival_threshold_honored_advances_when_within_threshold():
    # Agent at (0, 0), W0 at (0.1, 0) → within default 0.2 m threshold;
    # follower must aim at W1 from the very first tick.
    path = loop_waypoints([(0.1, 0.0), (5.0, 0.0), (5.0, 5.0)])
    agents = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    planner = path_follower(path, speed=2.0)
    cmds = planner(agents, 0.0, 0.1)
    assert cmds["a0"][0] > 1.5  # vx aimed at W1
    # Threshold respected: W0 at (1, 0) is *outside* 0.2 m threshold,
    # so the follower must aim at W0 not W1.
    path2 = loop_waypoints([(1.0, 0.0), (5.0, 0.0)])
    agents2 = [Agent(id="a0", x=0.0, y=0.0, theta=0.0)]
    planner2 = path_follower(path2, speed=2.0)
    cmds2 = planner2(agents2, 0.0, 0.1)
    assert cmds2["a0"][0] == pytest.approx(2.0, abs=1e-4)
    assert cmds2["a0"][1] == pytest.approx(0.0, abs=1e-6)
