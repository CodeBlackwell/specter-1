"""Sensor contract tests. Lock the typed return shapes and the realism layers
(IMU bias drift, lidar dropouts, range-dependent noise) so SLAM consumers
downstream can rely on them.
"""

import math
import random
import statistics

from specter.sim.agent import Agent
from specter.sim.runner import Simulation
from specter.sim.sensors import (
    IMUBias,
    imu_sample,
    initial_imu_bias,
    lidar_scan,
    propagate_imu_bias,
)
from specter.sim.world import box_world
from specter.types import IMUSample, RangeMeasurement


def _agent(x: float = 1.0, y: float = 1.0, theta: float = 0.0, omega: float = 0.0) -> Agent:
    return Agent(id="alpha", x=x, y=y, theta=theta, omega=omega)


def _world():
    return box_world(10.0, 10.0)


def test_lidar_scan_returns_range_measurements():
    rng = random.Random(0)
    scans = lidar_scan(_agent(), _world(), rng, t=1.5, n_beams=12, p_drop=0.0)
    assert len(scans) == 12
    for m in scans:
        assert isinstance(m, RangeMeasurement)
        assert m.t == 1.5
        assert 0.0 <= m.angle < 2.0 * math.pi
        assert m.distance > 0.0


def test_lidar_scan_body_frame_angle_independent_of_heading():
    rng_a = random.Random(0)
    rng_b = random.Random(0)
    scans_a = lidar_scan(_agent(theta=0.0), _world(), rng_a, t=0.0, n_beams=8, p_drop=0.0)
    scans_b = lidar_scan(_agent(theta=1.234), _world(), rng_b, t=0.0, n_beams=8, p_drop=0.0)
    assert [m.angle for m in scans_a] == [m.angle for m in scans_b]


def test_lidar_scan_deterministic_under_seed():
    a = lidar_scan(_agent(), _world(), random.Random(42), t=0.0)
    b = lidar_scan(_agent(), _world(), random.Random(42), t=0.0)
    assert a == b


def test_lidar_dropouts_emit_inf_distance():
    rng = random.Random(0)
    scans = lidar_scan(_agent(), _world(), rng, t=0.0, n_beams=10000, p_drop=1.0)
    assert all(math.isinf(m.distance) for m in scans)


def test_lidar_dropout_rate_matches_p_drop():
    rng = random.Random(0)
    scans = lidar_scan(_agent(), _world(), rng, t=0.0, n_beams=10000, p_drop=0.02)
    n_drops = sum(1 for m in scans if math.isinf(m.distance))
    fraction = n_drops / len(scans)
    assert 0.013 < fraction < 0.027  # ~3σ around p=0.02 for n=10000


def test_lidar_noise_scales_with_range():
    """σ at d~max is roughly 1.8× σ at d~0 (linear ramp 1 + d/10)."""
    near_world = box_world(0.6, 0.6)  # box wall at d≈0.3-0.4 from center
    far_world = box_world(20.0, 20.0)  # box wall at d=10 (capped at MAX_RANGE)
    rng_near = random.Random(0)
    rng_far = random.Random(0)
    near = lidar_scan(_agent(0.3, 0.3), near_world, rng_near, t=0.0, n_beams=500, p_drop=0.0)
    far = lidar_scan(_agent(10.0, 10.0), far_world, rng_far, t=0.0, n_beams=500, p_drop=0.0)
    near_mean = statistics.mean(m.distance for m in near)
    far_mean = statistics.mean(m.distance for m in far)
    near_sd = statistics.stdev(m.distance - near_mean for m in near)
    far_sd = statistics.stdev(m.distance - far_mean for m in far)
    assert far_sd > 1.4 * near_sd


def test_imu_sample_returns_imu_sample_type():
    sample = imu_sample(_agent(omega=0.5), random.Random(0), t=2.0, bias=IMUBias())
    assert isinstance(sample, IMUSample)
    assert sample.t == 2.0
    assert abs(sample.omega - 0.5) < 0.05


def test_imu_sample_deterministic_under_seed():
    a = imu_sample(_agent(omega=0.3), random.Random(7), t=0.0, bias=IMUBias())
    b = imu_sample(_agent(omega=0.3), random.Random(7), t=0.0, bias=IMUBias())
    assert a == b


def test_imu_sample_includes_bias():
    bias = IMUBias(omega=0.1, accel_x=0.05, accel_y=-0.05)
    sample = imu_sample(_agent(omega=0.0), random.Random(0), t=0.0, bias=bias)
    assert abs(sample.omega - 0.1) < 0.05
    assert abs(sample.ax - 0.05) < 0.1
    assert abs(sample.ay + 0.05) < 0.1


def test_imu_bias_random_walks():
    bias = IMUBias()
    rng = random.Random(0)
    samples = []
    for _ in range(2000):
        propagate_imu_bias(bias, rng)
        samples.append(bias.omega)
    sd = statistics.stdev(samples)
    assert 0.005 < sd < 0.05


def test_imu_bias_is_per_agent_independent():
    sim = Simulation(world=_world(), agents=[_agent(), Agent("bravo", 5, 5, 0)], seed=1)
    for _ in range(200):
        sim.tick()
    bias_alpha = sim._imu_biases["alpha"]
    bias_bravo = sim._imu_biases["bravo"]
    assert bias_alpha.omega != bias_bravo.omega
    assert bias_alpha.accel_x != bias_bravo.accel_x


def test_initial_bias_nonzero():
    bias = initial_imu_bias(random.Random(0))
    assert bias.omega != 0.0


def test_simulation_tick_carries_typed_sensor_outputs():
    sim = Simulation(world=_world(), agents=[_agent(omega=0.1)], seed=0)
    tick = sim.tick()
    scans = tick.scans["alpha"]
    assert all(isinstance(m, RangeMeasurement) for m in scans)
    assert isinstance(tick.imu["alpha"], IMUSample)
    assert tick.imu["alpha"].t == tick.t
