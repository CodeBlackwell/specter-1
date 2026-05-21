"""Wave 0 — sensor adapter translation tests.

Tests the pure translation functions (`*_to_*`) — these work without rclpy
because they accept any duck-typed message object. The rclpy-backed adapter
classes are smoke-tested in `tests/test_agent_node.py` (Wave 1).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from specter.ros2.adapters import (
    _UwbReturnView,
    imu_msg_to_imu_sample,
    laser_scan_to_range_measurements,
    uwb_msg_to_beacon_returns,
)
from specter.sim.beacons import BeaconReturn
from specter.types import IMUSample, RangeMeasurement


def _stamp(sec: int = 1, nanosec: int = 500_000_000) -> SimpleNamespace:
    return SimpleNamespace(sec=sec, nanosec=nanosec)


def _laser_scan_msg(
    *, ranges: list[float], angle_min: float, angle_increment: float,
    range_min: float = 0.05, range_max: float = 30.0,
) -> SimpleNamespace:
    return SimpleNamespace(
        header=SimpleNamespace(stamp=_stamp()),
        angle_min=angle_min,
        angle_increment=angle_increment,
        range_min=range_min,
        range_max=range_max,
        ranges=ranges,
    )


def test_laser_scan_translates_evenly_spaced_angles():
    msg = _laser_scan_msg(
        ranges=[1.0, 2.0, 3.0, 4.0],
        angle_min=-math.pi,
        angle_increment=math.pi / 2,
    )
    out = laser_scan_to_range_measurements(msg)
    assert len(out) == 4
    assert all(isinstance(r, RangeMeasurement) for r in out)
    assert out[0].angle == pytest.approx(-math.pi)
    assert out[3].angle == pytest.approx(-math.pi + 3 * math.pi / 2)
    assert [r.distance for r in out] == [1.0, 2.0, 3.0, 4.0]
    assert all(r.t == pytest.approx(1.5) for r in out)


def test_laser_scan_maps_out_of_range_and_nonfinite_to_inf():
    msg = _laser_scan_msg(
        ranges=[0.01, 1.0, 100.0, float("nan"), float("inf")],
        angle_min=0.0,
        angle_increment=0.1,
        range_min=0.05,
        range_max=30.0,
    )
    out = laser_scan_to_range_measurements(msg)
    distances = [r.distance for r in out]
    # 0.01 < range_min → inf; 1.0 ok; 100.0 > range_max → inf;
    # nan → inf; inf → inf
    assert math.isinf(distances[0])
    assert distances[1] == 1.0
    assert math.isinf(distances[2])
    assert math.isinf(distances[3])
    assert math.isinf(distances[4])


def test_laser_scan_empty_ranges():
    msg = _laser_scan_msg(ranges=[], angle_min=0.0, angle_increment=0.1)
    assert laser_scan_to_range_measurements(msg) == []


def _imu_msg(
    *, ax: float = 0.1, ay: float = 0.2, az: float = 9.8, omega: float = 0.05,
) -> SimpleNamespace:
    return SimpleNamespace(
        header=SimpleNamespace(stamp=_stamp(sec=2, nanosec=0)),
        linear_acceleration=SimpleNamespace(x=ax, y=ay, z=az),
        angular_velocity=SimpleNamespace(x=0.0, y=0.0, z=omega),
    )


def test_imu_translates_planar_components_only():
    msg = _imu_msg(ax=0.5, ay=-0.3, az=9.81, omega=0.7)
    sample = imu_msg_to_imu_sample(msg)
    assert isinstance(sample, IMUSample)
    assert sample.ax == 0.5
    assert sample.ay == -0.3
    assert sample.omega == 0.7
    assert sample.t == 2.0


def test_uwb_returns_translate_via_view_objects():
    views = [
        _UwbReturnView(subject_id="bravo", range_m=1.5, bearing_rad=0.1, t=10.0),
        _UwbReturnView(subject_id="charlie", range_m=2.7, bearing_rad=-0.4, t=10.0),
    ]
    out = uwb_msg_to_beacon_returns(views)
    assert len(out) == 2
    assert all(isinstance(b, BeaconReturn) for b in out)
    assert out[0].subject_id == "bravo"
    assert out[0].range_m == 1.5
    assert out[1].subject_id == "charlie"
    assert out[1].bearing_rad == -0.4


def test_uwb_returns_accept_duck_typed_objects():
    @dataclass(frozen=True)
    class FakeReturn:
        subject_id: str
        range_m: float
        bearing_rad: float
        t: float

    out = uwb_msg_to_beacon_returns([FakeReturn("alpha", 0.5, 0.0, 1.0)])
    assert out == [BeaconReturn(subject_id="alpha", range_m=0.5, bearing_rad=0.0, t=1.0)]


def test_uwb_returns_coerces_numeric_subject_id():
    """Vendor messages may use numeric IDs; adapter str-coerces consistently."""
    fake_int = SimpleNamespace(subject_id=42, range_m=1.0, bearing_rad=0.0, t=0.0)
    out = uwb_msg_to_beacon_returns([fake_int])
    assert out[0].subject_id == "42"
