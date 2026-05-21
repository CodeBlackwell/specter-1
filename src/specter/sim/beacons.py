"""UWB-style range beacon model. Each agent broadcasts an ID and replies to
ranging interrogations from peers within `BEACON_MAX_RANGE_M`. Returns carry
the **measured** range and **body-frame** bearing of the peer.

This is the sensor source that replaces ground-truth `subject_id`-tagged
observations in the trust path: peers now identify each other through cleartext
beacon IDs (signed at the envelope layer for authenticity), and trust voting
operates on noisy measured positions, not oracle truth. Maps to real hardware
like Decawave DWM1000 / Crazyflie Loco Positioning.

Walls do not occlude beacons in this model — radio propagates further than line
of sight in the indoor band; the `BEACON_MAX_RANGE_M` cap is the dominant cut.
NLOS multipath is modeled as a small probability of a positive range bias.
"""

import math
import random
from dataclasses import dataclass

from .agent import Agent

BEACON_MAX_RANGE_M = 8.0
BEACON_RANGE_SIGMA = 0.10  # 10 cm — DWM1000-class noise
BEACON_BEARING_SIGMA = math.radians(5.0)  # PDOA bearing noise
BEACON_NLOS_PROB = 0.02
BEACON_NLOS_BIAS = 0.5  # extra range, in meters, on multipath returns


@dataclass(frozen=True)
class BeaconReturn:
    subject_id: str
    range_m: float
    bearing_rad: float  # body-frame bearing of the peer relative to observer.theta
    t: float


def range_beacons(
    observer: Agent,
    peers: list[Agent],
    rng: random.Random,
    t: float,
    max_range_m: float = BEACON_MAX_RANGE_M,
    range_sigma: float = BEACON_RANGE_SIGMA,
    bearing_sigma: float = BEACON_BEARING_SIGMA,
    p_nlos: float = BEACON_NLOS_PROB,
    nlos_bias: float = BEACON_NLOS_BIAS,
) -> list[BeaconReturn]:
    out: list[BeaconReturn] = []
    for peer in peers:
        if peer.id == observer.id:
            continue
        dx = peer.x - observer.x
        dy = peer.y - observer.y
        true_range = math.hypot(dx, dy)
        if true_range > max_range_m:
            continue
        true_bearing = math.atan2(dy, dx) - observer.theta
        range_m = true_range + rng.gauss(0.0, range_sigma)
        if rng.random() < p_nlos:
            range_m += nlos_bias
        bearing_rad = true_bearing + rng.gauss(0.0, bearing_sigma)
        out.append(BeaconReturn(peer.id, range_m, bearing_rad, t))
    return out
