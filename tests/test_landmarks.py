"""ADR 0016 Wave 0.5 substrate: landmark primitive + LandmarkObservation wire
shape. Verifies the world model + message decoder + grid generator that
the Python and TS sim cores share. Parity fixtures (TS↔Python byte-equal
landmark grids) live in `ui/packages/sim-core/tests/fixtures/_generate.py`
and are exercised by `ui/packages/sim-core/tests/landmarks.parity.test.ts`.
"""

import json
from dataclasses import asdict

from specter.messages import (
    KIND_LANDMARK_OBSERVATION,
    LandmarkObservation,
    decode,
    encode,
)
from specter.sim.world import Landmark, World, box_world


def test_landmark_is_frozen_with_stable_id():
    lm = Landmark(id="lm-03-07", x=15.0, y=35.0)
    assert lm.id == "lm-03-07"
    assert lm.x == 15.0 and lm.y == 35.0


def test_world_defaults_to_no_landmarks_so_existing_callers_unaffected():
    """Additive change: landmarks default to empty tuple; pre-ADR-0016
    callers continue to construct World without naming the field."""
    w = World(walls=(), width=10.0, height=10.0)
    assert w.landmarks == ()


def test_box_world_accepts_landmarks_kwarg():
    landmarks = (Landmark(id="lm-00-00", x=0.0, y=0.0), Landmark(id="lm-01-00", x=5.0, y=0.0))
    w = box_world(20.0, 20.0, landmarks=landmarks)
    assert w.landmarks == landmarks
    assert len(w.walls) == 4  # box bounds, no interior walls passed


def test_landmark_observation_wire_round_trip():
    obs = LandmarkObservation(
        observer_id="alpha",
        landmark_id="lm-03-07",
        range_m=4.27,
        bearing_rad=0.13,
        timestamp_ns=1_700_000_000_000_000_000,
        nlos=False,
    )
    wire = encode(obs)
    # Canonical JSON: sorted keys, no whitespace, byte-for-byte stable.
    assert wire == json.dumps(asdict(obs), sort_keys=True, separators=(",", ":")).encode()
    decoded = decode(KIND_LANDMARK_OBSERVATION, wire)
    assert decoded == obs


def test_landmark_observation_nlos_flag_round_trips():
    obs = LandmarkObservation(
        observer_id="bravo",
        landmark_id="lm-00-00",
        range_m=2.0,
        bearing_rad=0.0,
        timestamp_ns=1_000_000_000,
        nlos=True,
    )
    decoded = decode(KIND_LANDMARK_OBSERVATION, encode(obs))
    assert decoded.nlos is True
