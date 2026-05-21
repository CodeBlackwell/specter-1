"""Headless tick loop. Visualization is a separate consumer of `Tick` snapshots."""

import random
from dataclasses import dataclass, field

from ..types import IMUSample, RangeMeasurement
from .agent import Agent
from .beacons import BeaconReturn, range_beacons
from .physics import bounce
from .sensors import IMUBias, imu_sample, initial_imu_bias, lidar_scan, propagate_imu_bias
from .world import World


@dataclass(frozen=True)
class Tick:
    t: float
    agents: tuple[Agent, ...]
    scans: dict[str, tuple[RangeMeasurement, ...]]
    imu: dict[str, IMUSample]
    beacons: dict[str, tuple[BeaconReturn, ...]]


@dataclass
class Simulation:
    world: World
    agents: list[Agent]
    seed: int = 0
    dt: float = 0.05
    t: float = 0.0
    bounce_walls: bool = False
    rng: random.Random = field(init=False)
    _imu_biases: dict[str, IMUBias] = field(init=False)

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)
        self._imu_biases = {a.id: initial_imu_bias(self.rng) for a in self.agents}

    def tick(self) -> Tick:
        self.t += self.dt
        for a in self.agents:
            prev_x, prev_y = a.x, a.y
            a.step(self.dt)
            if self.bounce_walls:
                bounce(a, prev_x, prev_y, self.world)
        for a in self.agents:
            propagate_imu_bias(self._imu_biases[a.id], self.rng)
        scans = {a.id: tuple(lidar_scan(a, self.world, self.rng, self.t)) for a in self.agents}
        imu = {
            a.id: imu_sample(a, self.rng, self.t, self._imu_biases[a.id]) for a in self.agents
        }
        beacons = {
            a.id: tuple(range_beacons(a, self.agents, self.rng, self.t)) for a in self.agents
        }
        snaps = tuple(a.snapshot() for a in self.agents)
        return Tick(self.t, snaps, scans, imu, beacons)

    def run(self, steps: int) -> list[Tick]:
        return [self.tick() for _ in range(steps)]
