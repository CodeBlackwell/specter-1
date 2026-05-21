"""End-to-end checks that pose drift through the full sensor stack
(IMU bias + lidar dropouts → DeadReckoningSlam) stays within sanity
bounds for the honest swarm. The attack-battery tests cover the trust
engine's detection behavior; this test covers SLAM realism.
"""

import math

from specter.sim.scenario import load_scenario
from specter.slam import DeadReckoningSlam
from specter.types import Pose


def test_honest_swarm_pose_drift_bounded_over_80_ticks():
    sim, _ = load_scenario("scenarios/four_corners.yaml")
    slam = {
        a.id: DeadReckoningSlam(
            agent_id=a.id,
            init_pose=Pose(x=a.x, y=a.y, theta=a.theta, t=0.0),
            dt=sim.dt,
            init_velocity=(a.vx, a.vy),
        )
        for a in sim.agents
    }

    max_drift_per_agent: dict[str, float] = {a.id: 0.0 for a in sim.agents}
    for _ in range(80):
        tick = sim.tick()
        for a in tick.agents:
            slam[a.id].update(list(tick.scans[a.id]), tick.imu[a.id])
            p = slam[a.id].pose()
            drift = math.hypot(p.x - a.x, p.y - a.y)
            if drift > max_drift_per_agent[a.id]:
                max_drift_per_agent[a.id] = drift

    overall_max = max(max_drift_per_agent.values())
    assert overall_max < 2.0, f"SLAM drift {overall_max:.2f}m exceeds sanity ceiling: {max_drift_per_agent}"
