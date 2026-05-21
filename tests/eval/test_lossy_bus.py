"""LossyBus + time-sync + battery-under-loss tests.

Layers:
  - LossyBus statistical/determinism (US-020)
  - validate_timestamp envelope skew filter (US-022)
  - Existing attack battery wrapped in LossyBus (US-023)
"""

import math
import random

import pytest

from specter.secure_bus import InProcessBus, VerificationError
from specter.transport.lossy_bus import LossyBus
from specter.transport.time_sync import validate_timestamp

from tests._helpers import sender_id_key

from . import scenarios
from .runner import EvaluationResult, run_scenario


def _collector() -> tuple[InProcessBus, list[bytes]]:
    """Inner bus + list that captures payloads delivered to topic 't'."""
    bus = InProcessBus()
    received: list[bytes] = []
    bus.subscribe("t", received.append)
    return bus, received


def test_zero_loss_byte_identical_to_inner():
    inner, got = _collector()
    direct, direct_got = _collector()
    lossy = LossyBus(inner, drop_prob=0.0, jitter_max_ms=0, reorder_window_ms=0)
    payloads = [f"msg-{i}".encode() for i in range(100)]
    for p in payloads:
        lossy.publish("t", p)
        direct.publish("t", p)
    assert got == direct_got == payloads


def test_drop_probability_within_three_sigma():
    inner, got = _collector()
    rng = random.Random(42)
    lossy = LossyBus(inner, drop_prob=0.5, rng=rng)
    n = 1000
    for i in range(n):
        lossy.publish("t", str(i).encode())
    expected = n * 0.5
    sigma = math.sqrt(n * 0.5 * 0.5)
    assert abs(len(got) - expected) <= 3 * sigma, (
        f"received {len(got)} not within 3σ of {expected} (σ={sigma:.1f})"
    )


def test_jitter_causes_out_of_order_delivery():
    inner, got = _collector()
    rng = random.Random(7)
    lossy = LossyBus(inner, jitter_max_ms=10, rng=rng)
    for i in range(200):
        lossy.publish("t", str(i).encode())
    lossy.flush()
    indices = [int(p) for p in got]
    out_of_order = sum(1 for a, b in zip(indices, indices[1:], strict=False) if b < a)
    assert out_of_order > 0, f"jitter produced strictly-monotonic delivery: {indices[:20]}"


def test_seeded_rng_produces_deterministic_delivery_order():
    def run() -> list[bytes]:
        inner, got = _collector()
        lossy = LossyBus(
            inner, drop_prob=0.3, jitter_max_ms=10, reorder_window_ms=5,
            rng=random.Random(123),
        )
        for i in range(500):
            lossy.publish("t", str(i).encode())
        lossy.flush()
        return got

    assert run() == run()


def test_reorder_window_perturbs_delivery():
    inner, got = _collector()
    rng = random.Random(99)
    lossy = LossyBus(inner, reorder_window_ms=5, rng=rng)
    for i in range(200):
        lossy.publish("t", str(i).encode())
    lossy.flush()
    indices = [int(p) for p in got]
    out_of_order = sum(1 for a, b in zip(indices, indices[1:], strict=False) if b < a)
    assert out_of_order > 0


def test_drop_prob_validation():
    with pytest.raises(ValueError):
        LossyBus(InProcessBus(), drop_prob=1.5)
    with pytest.raises(ValueError):
        LossyBus(InProcessBus(), jitter_max_ms=-1)


# ---------- US-022: validate_timestamp ----------


def test_validate_timestamp_within_threshold_passes():
    wall = 1_000_000_000_000
    validate_timestamp(wall, wall)
    validate_timestamp(wall + 1_000_000_000, wall)  # 1s ahead, within 5s
    validate_timestamp(wall - 1_000_000_000, wall)  # 1s behind, within 5s


def test_validate_timestamp_future_skew_rejected():
    wall = 1_000_000_000_000
    with pytest.raises(VerificationError, match="clock_skew_future"):
        validate_timestamp(wall + 6_000_000_000, wall)


def test_validate_timestamp_past_skew_rejected():
    wall = 1_000_000_000_000
    with pytest.raises(VerificationError, match="clock_skew_past"):
        validate_timestamp(wall - 6_000_000_000, wall)


def test_validate_timestamp_threshold_configurable():
    wall = 1_000_000_000_000
    # 2s ahead of wall, with a 1s threshold → reject
    with pytest.raises(VerificationError, match="clock_skew_future"):
        validate_timestamp(wall + 2_000_000_000, wall, max_skew_ns=1_000_000_000)


def test_replay_window_still_works_alongside_skew_filter():
    """Skew filter is an outer rule. Replay-window's strict-monotonic nonce
    check still fires for envelopes inside the skew threshold."""
    from specter.secure_bus import ReplayWindow

    rw = ReplayWindow()
    assert rw.accept("alpha", 1)
    assert not rw.accept("alpha", 1)  # replay rejected
    assert not rw.accept("alpha", 0)  # past nonce rejected

    # And the skew filter passes for the same fresh timestamp
    wall = 1_000_000_000_000
    validate_timestamp(wall, wall)


# ---------- US-023: battery under LossyBus ----------

LOSSY_DROP = 0.05
LOSSY_JITTER = 10
LOSSY_SEED = 42


def _wrap_inproc_with_lossy(monkeypatch: pytest.MonkeyPatch, seed: int) -> None:
    def factory() -> LossyBus:
        return LossyBus(
            InProcessBus(),
            drop_prob=LOSSY_DROP,
            jitter_max_ms=LOSSY_JITTER,
            rng=random.Random(seed),
            order_key=sender_id_key,
        )

    monkeypatch.setattr("tests.eval.runner.InProcessBus", factory)


_SYBIL_10 = ("alpha", *(f"sybil_{i}" for i in range(10)))

_BATTERY_SCENARIOS = [
    # ADR 0015: pose_lie reclassified — pose_lie and sybil_flood (which uses
    # pose_lie on alpha) are trust no-ops under range-only voting. Wave 2 adds
    # range_lie + colluder_pair equivalents with their own lossy-bus parametrizations.
    pytest.param(
        "single_pose_liar", scenarios.single_pose_liar, ("alpha",),
        marks=pytest.mark.skip(reason="ADR 0015: pose_lie reclassified; Wave 2 adds range_lie battery row."),
    ),
    ("replay_storm", scenarios.replay_storm, ("alpha",)),
    pytest.param(
        "sybil_flood", lambda: scenarios.sybil_flood(n_sybils=10), _SYBIL_10,
        marks=pytest.mark.skip(reason="ADR 0015: sybil_flood uses pose_lie; Wave 2 adds range_lie+sybil variant."),
    ),
    pytest.param(
        "sybil_flood_mutual", lambda: scenarios.sybil_flood_mutual(n_sybils=10), _SYBIL_10,
        marks=pytest.mark.skip(reason="ADR 0015: sybil_flood uses pose_lie; Wave 2 adds range_lie+sybil_mutual variant."),
    ),
]


@pytest.mark.parametrize("name,builder,expected_attackers", _BATTERY_SCENARIOS)
def test_battery_under_lossy_bus(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    builder,
    expected_attackers: tuple[str, ...],
) -> None:
    baseline: EvaluationResult = run_scenario(builder())

    _wrap_inproc_with_lossy(monkeypatch, LOSSY_SEED)
    lossy: EvaluationResult = run_scenario(builder())

    rows: list[tuple[str, int | None, int | None]] = []
    failures: list[str] = []
    for attacker in expected_attackers:
        b_tick = baseline.detection_ticks.get(attacker)
        l_tick = lossy.detection_ticks.get(attacker)
        rows.append((attacker, b_tick, l_tick))

        l_views = [r[attacker] for v, r in lossy.final_rep.items() if v not in expected_attackers]
        if not l_views or max(l_views) >= 0.4:
            failures.append(
                f"{name}/{attacker}: max honest view {max(l_views) if l_views else 'n/a':.3f} "
                f"≥ 0.4 — attacker not detected under loss"
            )
        if l_tick is None:
            failures.append(f"{name}/{attacker}: no detection tick under lossy bus")
        elif b_tick is not None and l_tick > 2 * b_tick + 5:
            failures.append(
                f"{name}/{attacker}: lossy detect tick {l_tick} > 2×baseline({b_tick})+5"
            )

    # No honest false positives in steady state. Transient mid-run dips are
    # expected under packet loss (e.g. first-tick presence rule when beacon
    # observations are still arriving) and don't constitute a misclassification
    # — recovery within the run does. Threshold mirrors the attacker bound.
    for honest_id, peers in lossy.final_rep.items():
        if honest_id in expected_attackers:
            continue
        for viewer_id, view in lossy.final_rep.items():
            if viewer_id in expected_attackers or viewer_id == honest_id:
                continue
            if view[honest_id] < 0.4:
                failures.append(
                    f"{name}/{honest_id}: final view from {viewer_id} = "
                    f"{view[honest_id]:.3f} < 0.4 — persistent false positive under lossy bus"
                )

    print(f"\n=== Lossy battery: {name} ===")
    print(f"{'attacker':<12} {'baseline':>10} {'lossy':>10}")
    for attacker, b_tick, l_tick in rows:
        print(f"{attacker:<12} {str(b_tick):>10} {str(l_tick):>10}")

    assert not failures, "\n".join(failures)
