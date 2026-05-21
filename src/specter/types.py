from dataclasses import dataclass


@dataclass(frozen=True)
class Pose:
    x: float
    y: float
    theta: float
    t: float


@dataclass(frozen=True)
class RangeMeasurement:
    angle: float
    distance: float
    t: float


@dataclass(frozen=True)
class IMUSample:
    ax: float
    ay: float
    omega: float
    t: float
