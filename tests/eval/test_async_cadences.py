"""Async sensor-cadence dispatch tests (US-021)."""

from specter.sim.scenario import load_scenario
from specter.sim.runner import Tick
from specter.transport.cadences import (
    DEFAULT_RATES,
    Cadence,
    cadence_dispatch,
)


def _fresh_sim():
    sim, _ = load_scenario("scenarios/four_corners.yaml")
    return sim


def test_cadence_dispatch_fires_at_target_rates_within_tolerance():
    sim = _fresh_sim()
    counts = {"lidar": 0, "imu": 0, "beacons": 0}

    def make_cb(name: str):
        def _cb(_tick: Tick) -> None:
            counts[name] += 1
        return _cb

    callbacks = {
        "lidar": Cadence(make_cb("lidar"), DEFAULT_RATES["lidar"]),
        "imu": Cadence(make_cb("imu"), DEFAULT_RATES["imu"]),
        "beacons": Cadence(make_cb("beacons"), DEFAULT_RATES["beacons"]),
    }
    n_ticks = 200
    cadence_dispatch(sim, callbacks, n_ticks)

    expected = {"lidar": 100, "imu": 200, "beacons": 100}
    for name, exp in expected.items():
        tol = max(1, int(0.05 * exp))
        assert abs(counts[name] - exp) <= tol, (
            f"{name}: fired {counts[name]} times, expected ≈ {exp} (±{tol})"
        )


def test_within_tick_callback_order_is_deterministic():
    sim = _fresh_sim()
    fired_order: list[str] = []

    def make_cb(name: str):
        def _cb(_tick: Tick) -> None:
            fired_order.append(name)
        return _cb

    # Stride 1 for all so every tick fires every callback in insertion order.
    callbacks = {
        "lidar": Cadence(make_cb("lidar"), 1),
        "imu": Cadence(make_cb("imu"), 1),
        "beacons": Cadence(make_cb("beacons"), 1),
    }
    cadence_dispatch(sim, callbacks, 5)
    assert fired_order == ["lidar", "imu", "beacons"] * 5


def test_per_callback_stride_is_configurable():
    sim = _fresh_sim()
    counts = {"slow": 0, "fast": 0}

    def make_cb(name: str):
        def _cb(_tick: Tick) -> None:
            counts[name] += 1
        return _cb

    callbacks = {
        "slow": Cadence(make_cb("slow"), 5),  # every 5 ticks
        "fast": Cadence(make_cb("fast"), 1),
    }
    cadence_dispatch(sim, callbacks, 50)
    assert counts["slow"] == 10
    assert counts["fast"] == 50


def test_simulation_tick_unchanged_by_cadence_wrapper():
    """Sanity: dispatch wraps but does not modify sim.tick()."""
    sim = _fresh_sim()
    initial_t = sim.t
    cadence_dispatch(sim, {"imu": Cadence(lambda _t: None, 1)}, 10)
    expected_t = initial_t + 10 * sim.dt
    assert abs(sim.t - expected_t) < 1e-9
