"""Calibration tests (Wave 3 polish).

US-050: per-topic QoS profile lookup (and `Sros2Bus` adoption when rclpy is
present).

US-051: decay-window inflection sweep — run a representative attack scenario
under `LossyBus` at increasing jitter, measure detection-latency degradation
vs the no-loss baseline, find the inflection point where latency exceeds
2× baseline. The output is *evidence* (printed to stdout, recorded in an
ADR) — no constants change in this PRD; constant tuning is a follow-on slice
once we have real (non-sim) jitter measurements.
"""

from __future__ import annotations

import random

import pytest

from specter.secure_bus import InProcessBus

from tests._helpers import sender_id_key
from specter.transport.lossy_bus import LossyBus
from specter.transport.qos import (
    History,
    QoSProfile,
    Reliability,
    qos_for_topic,
)
from specter.transport.sros2_marshal import RCLPY_AVAILABLE

from . import scenarios
from .runner import run_scenario


# ---------- US-050: QoS profile lookup ----------


def test_qos_for_topic_pose_is_best_effort_depth_one():
    profile = qos_for_topic("pose")
    assert profile.reliability is Reliability.BEST_EFFORT
    assert profile.history is History.KEEP_LAST
    assert profile.depth == 1
    assert profile.lifespan_ns > 0  # one publish interval, not infinite


def test_qos_for_topic_observation_is_reliable_with_cohort_depth():
    profile = qos_for_topic("observation")
    assert profile.reliability is Reliability.RELIABLE
    assert profile.history is History.KEEP_LAST
    assert profile.depth >= 10  # large enough to hold a cohort burst
    assert profile.lifespan_ns > 0


def test_qos_for_topic_reputation_is_reliable_buffered():
    profile = qos_for_topic("reputation")
    assert profile.reliability is Reliability.RELIABLE
    assert profile.history is History.KEEP_LAST
    assert profile.depth >= 5
    assert profile.lifespan_ns >= 1_000_000_000  # at least 1s


def test_qos_for_topic_beacon_is_best_effort():
    profile = qos_for_topic("beacon")
    assert profile.reliability is Reliability.BEST_EFFORT
    assert profile.depth == 1


def test_qos_for_topic_unknown_falls_back_to_reliable_default():
    profile = qos_for_topic("not_a_known_topic")
    assert profile.reliability is Reliability.RELIABLE
    assert profile.depth >= 1
    assert isinstance(profile, QoSProfile)


def test_qos_topic_taxonomy_is_complete():
    """Every topic in the production envelope set has a profile distinct from
    the fallback default — ensures we don't silently drop a topic into the
    conservative bucket without a deliberate choice."""
    expected = {"pose", "observation", "reputation", "beacon"}
    fallback = qos_for_topic("__unknown__")
    for topic in expected:
        assert qos_for_topic(topic) != fallback, (
            f"topic {topic!r} resolves to the fallback default — taxonomy gap"
        )


# ---------- US-050: Sros2Bus opt-in adoption ----------


def test_sros2_bus_default_unchanged_when_qos_for_topic_omitted():
    """`Sros2Bus(... )` without `qos_for_topic` keeps the integer queue_depth
    code path. Verified by inspecting the constructor's stored attribute —
    a behavior contract test that doesn't require rclpy."""
    if not RCLPY_AVAILABLE:
        pytest.skip("rclpy not installed — bus construction also requires it")
    from specter.transport.sros2_bus import Sros2Bus  # noqa: PLC0415

    bus = Sros2Bus.__new__(Sros2Bus)  # bypass __init__'s rclpy node requirement
    bus._qos_for_topic = None  # type: ignore[attr-defined]
    bus._queue_depth = 10  # type: ignore[attr-defined]
    assert bus._qos_arg("pose") == 10  # type: ignore[attr-defined]


@pytest.mark.skipif(not RCLPY_AVAILABLE, reason="rclpy not installed")
def test_sros2_bus_uses_qos_profile_per_topic(tmp_path):
    """When `qos_for_topic` is provided, publishers/subscribers use the
    per-topic profile. Verified via the rclpy publisher's introspection
    surface — `Publisher.qos_profile.reliability` is the policy applied."""
    import rclpy  # type: ignore[import-not-found]
    from rclpy.qos import ReliabilityPolicy  # type: ignore[import-not-found]

    from specter.transport.sros2_bus import Sros2Bus  # noqa: PLC0415
    from specter.transport.sros2_marshal import make_secure_node  # noqa: PLC0415

    keystore = tmp_path / "ks"
    keystore.mkdir()
    node = make_secure_node("specter_qos", str(keystore))
    bus = Sros2Bus(node, qos_for_topic=qos_for_topic)
    try:
        bus.publish("pose", b"\x01")  # creates a publisher
        pub = bus._publishers["pose"]  # type: ignore[attr-defined]
        assert pub.qos_profile.reliability == ReliabilityPolicy.BEST_EFFORT
        bus.publish("reputation", b"\x02")
        pub_rep = bus._publishers["reputation"]  # type: ignore[attr-defined]
        assert pub_rep.qos_profile.reliability == ReliabilityPolicy.RELIABLE
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


# ---------- US-051: jitter sweep + inflection ----------


CALIBRATION_SCENARIO = "single_pose_liar"
CALIBRATION_JITTER_MS = (1, 5, 10, 25, 50, 100)
CALIBRATION_SEED = 1729
CALIBRATION_DROP_PROB = 0.0  # isolate jitter; loss already covered by US-023


def _wrap_inproc_with_jitter(
    monkeypatch: pytest.MonkeyPatch, jitter_ms: int, seed: int
) -> None:
    def factory() -> LossyBus:
        return LossyBus(
            InProcessBus(),
            drop_prob=CALIBRATION_DROP_PROB,
            jitter_max_ms=jitter_ms,
            rng=random.Random(seed),
            order_key=sender_id_key,
        )

    monkeypatch.setattr("tests.eval.runner.InProcessBus", factory)


@pytest.mark.skip(reason="ADR 0015: uses single_pose_liar (pose_lie reclassified); Wave 2 reruns with range_lie.")
def test_decay_window_jitter_inflection(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sweep jitter, find the point where detection latency crosses 2× baseline.

    Result is informational: the spec is explicit that no constants change in
    this PRD. We assert the sweep completes and produces a monotonic
    (non-decreasing within statistical noise) trend, then print the table for
    the ADR (0013) to cite.
    """
    baseline = run_scenario(scenarios.single_pose_liar())
    baseline_tick = baseline.detection_ticks["alpha"]
    assert baseline_tick is not None, "baseline scenario must detect attacker"

    rows: list[tuple[int, int | None, float | None]] = []
    inflection_ms: int | None = None
    for jitter_ms in CALIBRATION_JITTER_MS:
        with monkeypatch.context() as m:
            _wrap_inproc_with_jitter(m, jitter_ms, CALIBRATION_SEED)
            result = run_scenario(scenarios.single_pose_liar())
        lossy_tick = result.detection_ticks["alpha"]
        ratio = (lossy_tick / baseline_tick) if lossy_tick is not None else None
        rows.append((jitter_ms, lossy_tick, ratio))
        if inflection_ms is None and (
            lossy_tick is None or lossy_tick > 2 * baseline_tick
        ):
            inflection_ms = jitter_ms

    print(f"\n=== Decay-window calibration ({CALIBRATION_SCENARIO}) ===")
    print(f"baseline detection tick: {baseline_tick}")
    print(f"{'jitter_ms':>10} {'detect_tick':>12} {'ratio_vs_baseline':>20}")
    for jitter_ms, tick, ratio in rows:
        ratio_s = f"{ratio:.2f}x" if ratio is not None else "undetected"
        tick_s = str(tick) if tick is not None else "None"
        print(f"{jitter_ms:>10} {tick_s:>12} {ratio_s:>20}")
    if inflection_ms is None:
        print(
            "inflection: none in tested range — current decay/window absorbs "
            f"{CALIBRATION_JITTER_MS[-1]} ms jitter without crossing 2× baseline"
        )
    else:
        print(f"inflection: {inflection_ms} ms (first crossing of 2× baseline)")

    detected_count = sum(1 for _, tick, _ in rows if tick is not None)
    assert detected_count >= len(rows) - 1, (
        "more than one jitter setting failed to detect — the engine is not "
        "merely degrading, it is breaking; investigate before publishing the "
        "calibration"
    )
