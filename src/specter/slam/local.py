"""Per-agent dead-reckoning SLAM. Slice-1 estimator.

Drives `theta` from the IMU gyro and integrates a held world-frame velocity
each tick. Velocity is seeded at construction (analog of a robot's commanded
cruise or wheel-encoder readout at startup) and held constant — the estimator
models a "constant-cruise" robot. World-position drift therefore comes
primarily from gyro bias accumulating into theta error, not from raw accel
double-integration. This is realistic for ground robots that don't change
speed often (Crazyflie hover, TurtleBot4 cruise) and intentionally simple so
the trust path can replace ground-truth pose without the SLAM itself becoming
a source of confounding error.

ADR 0004 records the choice; scan-match upgrade is a follow-up slice.
"""

import json
import math
from dataclasses import asdict

from ..interfaces import LocalSlam as LocalSlamABC
from ..types import IMUSample, Pose, RangeMeasurement


class DeadReckoningSlam(LocalSlamABC):
    def __init__(
        self,
        agent_id: str,
        init_pose: Pose,
        dt: float,
        init_velocity: tuple[float, float] = (0.0, 0.0),
    ) -> None:
        self._agent_id = agent_id
        self._x = init_pose.x
        self._y = init_pose.y
        self._theta = init_pose.theta
        self._t = init_pose.t
        self._dt = dt
        self._vx_world, self._vy_world = init_velocity
        self._latest_scans: list[RangeMeasurement] = []

    def update(self, scans: list[RangeMeasurement], imu: IMUSample) -> None:
        self._x += self._vx_world * self._dt
        self._y += self._vy_world * self._dt
        self._theta += imu.omega * self._dt
        self._t = imu.t
        self._latest_scans = [m for m in scans if not math.isinf(m.distance)]

    def pose(self) -> Pose:
        return Pose(x=self._x, y=self._y, theta=self._theta, t=self._t)

    def map_fragment(self) -> bytes:
        payload = {
            "agent_id": self._agent_id,
            "t": self._t,
            "scans": [asdict(m) for m in self._latest_scans],
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
