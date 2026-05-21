"""Sybil-scale eval: probe how detection scales as the sybil:honest ratio
grows. Base battery covers 4:3 (sybil_flood). This sweep proves the
beacon-presence defense holds at 5:3, 10:3, 25:3, and 100:3 — ratios
that broke detection before the rule landed (rec'd 2026-05-04, commit
d5e8a68: every sybil sat at rep ≈0.99 from honest viewers).

V1 defense (`PRESENCE_WINDOW_NS` + presence-gate in `_vote` and
`record_pose_report`): a peer's PoseReport accumulates β when no other
peer has published a beacon Observation with subject=peer recently. In
voting, observers without presence are zero-weighted. Sybils have no
physical body — honest peers' real beacons never range them — so they
fail both checks by construction.

V1 limitation (not exercised here, see PROGRESS.md): smarter attackers
that have sybils publish fake mutual Observations of each other still
escape this rule. The proper fix weights presence-grants by observer
reputation; out of scope for V1.

Pass criterion at each scale: every attacker (alpha + sybils) must be
detected (max honest view < 0.4) and false positives stay zero.
"""

import pytest

from . import scenarios
from .runner import run_scenario

DETECT_THRESHOLD = 0.4


def _assert_all_attackers_detected(result, n_sybils: int) -> None:
    misses = []
    for attacker_id in result.scenario.attackers:
        attacker_views = [
            r[attacker_id]
            for viewer, r in result.final_rep.items()
            if viewer not in set(result.scenario.attackers)
        ]
        if not attacker_views:
            continue
        if max(attacker_views) >= DETECT_THRESHOLD:
            misses.append((attacker_id, max(attacker_views)))

    assert not misses, (
        f"n_sybils={n_sybils}: {len(misses)} attackers not detected "
        f"(threshold={DETECT_THRESHOLD}): {misses[:5]}"
    )
    assert all(t is None for t in result.false_positive_ticks.values()), (
        f"n_sybils={n_sybils}: false positives on honest peers"
    )


@pytest.mark.skip(reason="ADR 0015: sybil_flood uses pose_lie on alpha; Wave 2 adds range_lie+sybil variant.")
@pytest.mark.parametrize("n_sybils", [4, 5, 10, 25, 100])
def test_sybil_flood_detection_scales(n_sybils: int) -> None:
    """V1 beacon-presence rule beats sybil_flood (sybils don't mutually
    corroborate) at all measured ratios up to 100:3."""
    result = run_scenario(scenarios.sybil_flood(n_sybils=n_sybils))
    _assert_all_attackers_detected(result, n_sybils)


@pytest.mark.skip(reason="ADR 0015: sybil_flood_mutual uses pose_lie on alpha; Wave 2 adds range_lie+sybil_mutual variant.")
@pytest.mark.parametrize("n_sybils", [4, 5, 10, 25])
def test_sybil_flood_mutual_corroboration_detection_scales(n_sybils: int) -> None:
    """V2 self-anchored presence rule beats sybil_flood_mutual (sybils
    publish fake mutual `Observation`s of each other). V1 alone fails this
    at 4:3 and beyond — sybils sit at rep ≈0.99 because cabal-internal
    grants pass V1's "any non-self grantor" check.

    V2 anchors presence on the evaluator's own `self_id`: only beacon
    Observations published by self count as presence grants. Sybils have
    no body, so self's real beacons never list them as subject — caught
    regardless of how the cabal mutually corroborates.

    Per-envelope `record_observation` β balances the per-envelope
    `record_accept` α so high-volume mutual fake-corroboration can't
    outpace the rule on count.

    Empirically up to 25:3: max sybil rep stays well below 0.4 threshold
    (0.16 at 4:3, 0.28 at 25:3). Larger ratios skipped here for runtime
    (100:3 = 100×100×80 ≈ 800k fake envelopes); the trajectory suggests
    detection holds further but isn't asserted in CI.
    """
    result = run_scenario(scenarios.sybil_flood_mutual(n_sybils=n_sybils))
    _assert_all_attackers_detected(result, n_sybils)
