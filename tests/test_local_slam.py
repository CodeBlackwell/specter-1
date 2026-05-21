"""Dead-reckoning SLAM unit tests. Tests feed crafted IMUSample / scan inputs
directly so the SLAM behavior is isolated from sensor noise (those layers are
exercised end-to-end in tests/eval/test_slam_integration.py).
"""

import json
import math

import pytest

from specter.slam import DeadReckoningSlam
from specter.types import IMUSample, Pose, RangeMeasurement


def _zero_imu(t: float = 0.0) -> IMUSample:
    return IMUSample(ax=0.0, ay=0.0, omega=0.0, t=t)


def _imu(omega: float, t: float = 0.0) -> IMUSample:
    return IMUSample(ax=0.0, ay=0.0, omega=omega, t=t)


def _origin_pose() -> Pose:
    return Pose(x=0.0, y=0.0, theta=0.0, t=0.0)


def test_static_agent_pose_stays_within_epsilon():
    slam = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05, init_velocity=(0.0, 0.0))
    for k in range(100):
        slam.update([], _zero_imu(t=k * 0.05))
    p = slam.pose()
    assert abs(p.x) < 1e-9
    assert abs(p.y) < 1e-9
    assert abs(p.theta) < 1e-9


def test_pure_rotation_tracks_theta():
    slam = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05, init_velocity=(0.0, 0.0))
    for k in range(100):
        slam.update([], _imu(omega=0.5, t=k * 0.05))
    p = slam.pose()
    assert p.theta == pytest.approx(0.5 * 0.05 * 100)
    assert abs(p.x) < 1e-9
    assert abs(p.y) < 1e-9


def test_straight_line_xy_integrates_held_velocity():
    slam = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05, init_velocity=(0.5, 0.0))
    for k in range(100):
        slam.update([], _zero_imu(t=k * 0.05))
    p = slam.pose()
    assert p.x == pytest.approx(0.5 * 0.05 * 100)
    assert p.y == pytest.approx(0.0)


def test_dropout_scans_excluded_from_map_fragment():
    slam = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05)
    scans = [
        RangeMeasurement(angle=0.0, distance=1.5, t=0.0),
        RangeMeasurement(angle=1.0, distance=math.inf, t=0.0),
        RangeMeasurement(angle=2.0, distance=2.5, t=0.0),
    ]
    slam.update(scans, _zero_imu())
    fragment = json.loads(slam.map_fragment())
    distances = [m["distance"] for m in fragment["scans"]]
    assert distances == [1.5, 2.5]


def test_run_is_deterministic():
    a = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05, init_velocity=(0.3, 0.1))
    b = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05, init_velocity=(0.3, 0.1))
    for k in range(50):
        a.update([], _imu(omega=0.05, t=k * 0.05))
        b.update([], _imu(omega=0.05, t=k * 0.05))
    assert a.pose() == b.pose()


def test_map_fragment_round_trips_as_json():
    slam = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05)
    scans = [RangeMeasurement(angle=1.5, distance=3.0, t=0.0)]
    slam.update(scans, _zero_imu())
    fragment = json.loads(slam.map_fragment())
    assert fragment["agent_id"] == "alpha"
    assert "scans" in fragment
    assert fragment["scans"][0]["angle"] == 1.5
    assert fragment["scans"][0]["distance"] == 3.0


def test_pose_timestamp_tracks_imu():
    slam = DeadReckoningSlam("alpha", _origin_pose(), dt=0.05)
    slam.update([], _zero_imu(t=42.0))
    assert slam.pose().t == 42.0


def test_holds_init_pose_before_first_update():
    init = Pose(x=1.5, y=2.5, theta=0.3, t=0.0)
    slam = DeadReckoningSlam("alpha", init, dt=0.05)
    p = slam.pose()
    assert p.x == 1.5
    assert p.y == 2.5
    assert p.theta == 0.3
