"""Synthetic ToF + IMU readings against a 2D wall world.

Noise is Gaussian, draws from an injected `random.Random` so seeded runs are
byte-for-byte reproducible. Outputs the typed `RangeMeasurement` / `IMUSample`
contracts from `specter.types` so downstream SLAM consumers don't depend on
positional tuple shapes.

Frame convention: `RangeMeasurement.angle` is the **body-frame** bearing of the
beam (independent of robot heading). World-frame ray = `agent.theta + angle`.

Realism layers:
- Lidar: range-dependent noise + occasional dropouts (`math.inf`).
- IMU: per-agent slow bias drift on top of per-sample white noise. Bias state
  lives in `IMUBias` dataclasses owned by `Simulation` and propagated each tick
  via `propagate_imu_bias`. `imu_sample` reads bias but does not mutate it,
  keeping the rng-call sequence inspectable.
"""

import math
import random
from dataclasses import dataclass

from ..types import IMUSample, RangeMeasurement
from .agent import Agent
from .world import Wall, World

MAX_RANGE = 10.0

LIDAR_NOISE_STD_BASE = 0.05  # σ at d=0; scales linearly with range
LIDAR_P_DROP = 0.02

IMU_ACCEL_STD = 0.02
IMU_OMEGA_STD = 0.005
IMU_BIAS_RW_STD = 0.0005  # per-tick random walk on bias
IMU_INIT_BIAS_STD = 0.01  # initial bias draw at simulation start


@dataclass
class IMUBias:
    """Per-agent slow-varying IMU bias. Mutated only by `propagate_imu_bias`."""

    omega: float = 0.0
    accel_x: float = 0.0
    accel_y: float = 0.0


def initial_imu_bias(rng: random.Random) -> IMUBias:
    return IMUBias(
        omega=rng.gauss(0.0, IMU_INIT_BIAS_STD),
        accel_x=rng.gauss(0.0, IMU_INIT_BIAS_STD),
        accel_y=rng.gauss(0.0, IMU_INIT_BIAS_STD),
    )


def propagate_imu_bias(bias: IMUBias, rng: random.Random) -> None:
    bias.omega += rng.gauss(0.0, IMU_BIAS_RW_STD)
    bias.accel_x += rng.gauss(0.0, IMU_BIAS_RW_STD)
    bias.accel_y += rng.gauss(0.0, IMU_BIAS_RW_STD)


def _ray_segment(
    px: float, py: float, dx: float, dy: float, x1: float, y1: float, x2: float, y2: float
) -> float | None:
    sx, sy = x2 - x1, y2 - y1
    denom = dx * sy - dy * sx
    if abs(denom) < 1e-9:
        return None
    t = ((x1 - px) * sy - (y1 - py) * sx) / denom
    u = ((x1 - px) * dy - (y1 - py) * dx) / denom
    if t > 0.0 and 0.0 <= u <= 1.0:
        return t
    return None


def ray_cast(x: float, y: float, angle: float, walls: tuple[Wall, ...]) -> float:
    closest = MAX_RANGE
    dx, dy = math.cos(angle), math.sin(angle)
    for w in walls:
        d = _ray_segment(x, y, dx, dy, w.x1, w.y1, w.x2, w.y2)
        if d is not None and d < closest:
            closest = d
    return closest


def lidar_scan(
    agent: Agent,
    world: World,
    rng: random.Random,
    t: float,
    n_beams: int = 36,
    noise_std: float = LIDAR_NOISE_STD_BASE,
    p_drop: float = LIDAR_P_DROP,
) -> list[RangeMeasurement]:
    out: list[RangeMeasurement] = []
    for i in range(n_beams):
        body_angle = (i / n_beams) * 2.0 * math.pi
        if rng.random() < p_drop:
            distance = math.inf
        else:
            world_angle = agent.theta + body_angle
            d = ray_cast(agent.x, agent.y, world_angle, world.walls)
            sigma = noise_std * (1.0 + d / 10.0)
            distance = d + rng.gauss(0.0, sigma)
        out.append(RangeMeasurement(angle=body_angle, distance=distance, t=t))
    return out


def imu_sample(
    agent: Agent,
    rng: random.Random,
    t: float,
    bias: IMUBias,
    accel_std: float = IMU_ACCEL_STD,
    omega_std: float = IMU_OMEGA_STD,
) -> IMUSample:
    return IMUSample(
        ax=bias.accel_x + rng.gauss(0.0, accel_std),
        ay=bias.accel_y + rng.gauss(0.0, accel_std),
        omega=agent.omega + bias.omega + rng.gauss(0.0, omega_std),
        t=t,
    )
