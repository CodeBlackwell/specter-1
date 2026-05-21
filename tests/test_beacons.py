"""UWB-style range beacon sensor tests."""

import math
import random
import statistics

from specter.sim.agent import Agent
from specter.sim.beacons import (
    BEACON_MAX_RANGE_M,
    BEACON_NLOS_BIAS,
    BeaconReturn,
    range_beacons,
)


def test_beacon_returns_within_range():
    observer = Agent("alpha", 0, 0, 0)
    near = Agent("bravo", 1.0, 1.0, 0)
    far = Agent("charlie", 100.0, 100.0, 0)
    rets = range_beacons(observer, [observer, near, far], random.Random(0), t=0.0)
    ids = [r.subject_id for r in rets]
    assert "bravo" in ids
    assert "charlie" not in ids
    assert "alpha" not in ids


def test_beacon_range_within_noise_budget():
    observer = Agent("alpha", 0, 0, 0)
    peer = Agent("bravo", 3.0, 0.0, 0)
    measured = []
    for seed in range(500):
        rets = range_beacons(observer, [peer], random.Random(seed), t=0.0, p_nlos=0.0)
        measured.append(rets[0].range_m)
    mean = statistics.mean(measured)
    assert abs(mean - 3.0) < 0.05  # honest mean
    sd = statistics.stdev(measured)
    assert 0.05 < sd < 0.20  # σ around BEACON_RANGE_SIGMA=0.10


def test_beacon_bearing_in_observer_body_frame():
    observer = Agent("alpha", 0, 0, theta=math.pi / 2)  # facing +y
    peer_in_front = Agent("bravo", 0.0, 1.0, 0)  # body-frame bearing should be ~0
    bearings = []
    for seed in range(200):
        rets = range_beacons(
            observer, [peer_in_front], random.Random(seed), t=0.0, bearing_sigma=0.0
        )
        bearings.append(rets[0].bearing_rad)
    assert max(abs(b) for b in bearings) < 1e-6


def test_beacon_nlos_outliers_present():
    observer = Agent("alpha", 0, 0, 0)
    peer = Agent("bravo", 3.0, 0.0, 0)
    n_nlos_like = 0
    for seed in range(2000):
        rets = range_beacons(
            observer, [peer], random.Random(seed), t=0.0, range_sigma=0.0, p_nlos=0.02
        )
        if rets[0].range_m > 3.0 + BEACON_NLOS_BIAS / 2:
            n_nlos_like += 1
    fraction = n_nlos_like / 2000
    assert 0.01 < fraction < 0.03  # ~2% expected


def test_beacon_seeded_determinism():
    observer = Agent("alpha", 0, 0, 0)
    peers = [observer, Agent("bravo", 2.0, 0.0, 0), Agent("charlie", 0.0, 2.0, 0)]
    a = range_beacons(observer, peers, random.Random(13), t=0.0)
    b = range_beacons(observer, peers, random.Random(13), t=0.0)
    assert a == b


def test_beacon_carries_timestamp_and_dataclass_type():
    observer = Agent("alpha", 0, 0, 0)
    peer = Agent("bravo", 1.0, 0.0, 0)
    rets = range_beacons(observer, [peer], random.Random(0), t=4.2)
    assert all(isinstance(r, BeaconReturn) for r in rets)
    assert all(r.t == 4.2 for r in rets)


def test_beacons_at_max_range_boundary_excluded():
    observer = Agent("alpha", 0, 0, 0)
    just_over = Agent("bravo", BEACON_MAX_RANGE_M + 0.01, 0.0, 0)
    rets = range_beacons(observer, [just_over], random.Random(0), t=0.0)
    assert rets == []
