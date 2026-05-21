"""SLAM drift bounds. Dead-reckoning's breakdown at bounces is the gap that
motivates the scan-match upgrade — when the real robot's velocity reverses
on a wall hit, the held-velocity estimator continues integrating the
pre-bounce velocity and diverges fast.

Empirical baseline (recorded 2026-05-04, dead-reckoning):
- 80 ticks pre-bounce: 0.95 m drift (gyro bias rotating velocity vector).
- 200 ticks (≥1 bounce): 12.95 m drift — completely wrong.
- 400 ticks (≥2 bounces): 16.85 m drift.

Pass criterion: max drift over a 200-tick bouncing run stays under 1.5 m.
This is what scan-match (radial-flow velocity correction) must deliver.
"""

from math import hypot

from specter.sim.agent import Agent
from specter.sim.runner import Simulation
from specter.sim.world import box_world
from specter.slam import DeadReckoningSlam, ScanMatchSlam
from specter.types import Pose


def _bouncing_sim() -> Simulation:
    """4 agents at v=1.0 m/s in an 8×8 box — reach walls in ~2s, bounce."""
    return Simulation(
        world=box_world(8.0, 8.0),
        agents=[
            Agent(id="alpha", x=3.5, y=3.5, theta=0.0, vx=1.0, vy=0.0),
            Agent(id="bravo", x=4.5, y=3.5, theta=3.14, vx=-1.0, vy=0.0),
            Agent(id="charlie", x=3.5, y=4.5, theta=1.57, vx=0.0, vy=1.0),
            Agent(id="delta", x=4.5, y=4.5, theta=-1.57, vx=0.0, vy=-1.0),
        ],
        seed=7,
        bounce_walls=True,
    )


def _run(slam_factory, ticks: int) -> float:
    sim = _bouncing_sim()
    slam = {
        a.id: slam_factory(
            agent_id=a.id,
            init_pose=Pose(x=a.x, y=a.y, theta=a.theta, t=0.0),
            dt=sim.dt,
            init_velocity=(a.vx, a.vy),
        )
        for a in sim.agents
    }
    max_drift = 0.0
    for _ in range(ticks):
        tick = sim.tick()
        for a in tick.agents:
            slam[a.id].update(list(tick.scans[a.id]), tick.imu[a.id])
            p = slam[a.id].pose()
            max_drift = max(max_drift, hypot(p.x - a.x, p.y - a.y))
    return max_drift


def test_dead_reckoning_diverges_at_bounce() -> None:
    """Negative test: documents that DeadReckoningSlam fails the drift bound
    once velocity reverses. Locks in the gap that scan-match must close."""
    drift = _run(DeadReckoningSlam, ticks=200)
    assert drift > 5.0, (
        f"dead-reckoning unexpectedly stayed bounded at {drift:.2f}m — "
        "did the scenario stop bouncing?"
    )


def test_scan_match_bounded_through_bounces() -> None:
    """Scan-match recovers velocity from radial lidar flow. Drift bounded
    over a 200-tick bouncing run — the gap dead-reckoning fails to close."""
    drift = _run(ScanMatchSlam, ticks=200)
    assert drift < 1.5, f"scan-match drift {drift:.2f}m exceeded 1.5m bound"


def test_scan_match_bounded_at_400_ticks() -> None:
    """Drift stays bounded over a longer run — dead-reckoning hits 16.85m
    here, scan-match should hold. Tighter assertion at 2.0m gives margin
    for accumulated theta error from gyro bias."""
    drift = _run(ScanMatchSlam, ticks=400)
    assert drift < 2.0, f"scan-match drift {drift:.2f}m exceeded 2.0m bound"
