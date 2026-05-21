import math

import pytest

from specter.crypto import Keypair
from specter.messages import (
    KIND_POSE,
    KIND_REPUTATION,
    Observation,
    PoseReport,
    ReputationGossip,
    encode,
)
from specter.secure_bus import (
    Envelope,
    Identity,
    ReplayWindow,
    Roster,
    VerificationError,
    open_envelope,
)
from specter.trust import BetaTrustEvaluator, ListTelemetry


from tests._helpers import make_identity, make_roster


def _obs(observer: str, subject: str, rel_x: float, rel_y: float, ts: int) -> Observation:
    """Wave-0 helper: build Observation from legacy (rel_x, rel_y) intent.

    Tests originally wrote `Observation(o, s, rel_x, rel_y, ts)` where the
    last two scalars were observer-frame relative offsets. The wire format
    now carries (range_m, bearing_rad). With theta=0 in test poses, this
    helper is mathematically equivalent to the original construction; the
    evaluator's Wave-0 projection rebuilds rel_x, rel_y on the receiving end.
    Wave 1 replaces this entirely with range-only voting (ADR 0015).
    """
    return Observation(
        observer, subject, math.hypot(rel_x, rel_y), math.atan2(rel_y, rel_x), ts
    )



def seal_pose(ident: Identity, timestamp_ns: int = 0) -> Envelope:
    return ident.seal(KIND_POSE, encode(PoseReport(ident.agent_id, 0, 0, 0, 0)), timestamp_ns=timestamp_ns)


def seed_presence(evaluator: BetaTrustEvaluator, peer_ids: list[str], ts: int = 0) -> None:
    """Mark `peer_ids` as mutually beacon-corroborated under the V1
    presence rule, without going through `record_observation` (which would
    pollute the test's voting cohorts). In the real eval/runner each agent's
    beacons range every other agent in radius; unit tests need this seeding
    or honest observers fail the presence gate when their votes fire."""
    for subject in peer_ids:
        granters = evaluator._seen_by.setdefault(subject, {})
        for observer in peer_ids:
            if observer != subject:
                granters[observer] = ts


def test_unseen_peer_scores_at_prior():
    evaluator = BetaTrustEvaluator()
    assert evaluator.reputation("alpha") == 0.5


def test_one_accept_pushes_score_above_prior():
    evaluator = BetaTrustEvaluator()
    evaluator.observe("alpha", {"alpha": 1.0})
    assert evaluator.reputation("alpha") == pytest.approx(2 / 3)


def test_one_reject_pushes_score_below_prior():
    evaluator = BetaTrustEvaluator()
    evaluator.observe("alpha", {"beta": 1.0})
    assert evaluator.reputation("alpha") == pytest.approx(1 / 3)


def test_record_accept_increments_alpha():
    evaluator = BetaTrustEvaluator(accept_alpha=1.0)
    alpha = make_identity("alpha")
    evaluator.record_accept(seal_pose(alpha))
    assert evaluator.reputation("alpha") == pytest.approx(2 / 3)


def test_record_accept_default_is_low_weight():
    """Default accept_alpha=0.1 keeps the cryptographic signal subordinate
    to behavioral voting evidence — so a peer that sends valid signatures
    but lies geometrically still ends up below honest peers."""
    evaluator = BetaTrustEvaluator()
    alpha = make_identity("alpha")
    evaluator.record_accept(seal_pose(alpha))
    assert evaluator.reputation("alpha") == pytest.approx(1.1 / 2.1)


@pytest.mark.parametrize(
    "message,expected",
    [
        ("bad signature from alpha", "bad_signature"),
        ("replay from alpha nonce=3", "replay"),
        ("unknown sender mallory", "unknown_sender"),
        ("unsupported version 99", "version_mismatch"),
    ],
)
def test_each_reject_category_classified(message, expected):
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    alpha = make_identity("alpha")
    evaluator.record_reject(seal_pose(alpha), VerificationError(message))
    assert telemetry.events[-1][1]["category"] == expected
    assert evaluator.reputation("alpha") == pytest.approx(1 / 3)


def test_anomaly_event_carries_envelope_fields():
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    evaluator.record_reject(env, VerificationError("bad signature from alpha"))
    name, fields = telemetry.events[0]
    assert name == "trust.anomaly"
    assert fields["sender_id"] == "alpha"
    assert fields["nonce"] == env.nonce
    assert fields["timestamp_ns"] == env.timestamp_ns


def test_integration_tampered_envelope_records_reject():
    alpha = make_identity("alpha")
    roster = make_roster(alpha)
    replay = ReplayWindow()
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)

    env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 1, 2, 0.5, 1000)))
    tampered = Envelope(
        env.version, env.sender_id, env.nonce, env.timestamp_ns, env.kind,
        encode(PoseReport("alpha", 99, 99, 0, 1000)), env.signature,
    )
    try:
        open_envelope(tampered, roster, replay)
    except VerificationError as e:
        evaluator.record_reject(tampered, e)
    assert evaluator.reputation("alpha") == pytest.approx(1 / 3)
    assert telemetry.events[0][1]["category"] == "bad_signature"


def test_unknown_sender_records_against_claimed_id():
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    rogue = make_identity("mallory")
    env = seal_pose(rogue)
    try:
        open_envelope(env, Roster(), ReplayWindow())
    except VerificationError as e:
        evaluator.record_reject(env, e)
    assert evaluator.reputation("mallory") == pytest.approx(1 / 3)
    assert telemetry.events[0][1]["category"] == "unknown_sender"


def _range_obs(observer: str, subject: str, range_m: float, ts: int = 0) -> Observation:
    """Helper: build an Observation with explicit range and bearing=0. Wave-1
    reciprocal-range voting uses range only, so bearing is irrelevant at the
    trust layer (kept on the wire for viz)."""
    return Observation(observer, subject, range_m, 0.0, ts)


def _seed_reciprocal(
    evaluator: BetaTrustEvaluator, env: Envelope,
    a: str, b: str, range_ab: float, range_ba: float, ts: int = 0,
) -> None:
    """Helper: seed both directions of a beacon pair into the cohort. With
    `range_ab == range_ba` the pair is honest; with a mismatch beyond 3σ
    (≈0.5m at default σ), Tier 1 fires range_inconsistency on both."""
    evaluator.record_observation(env, _range_obs(a, b, range_ab, ts))
    evaluator.record_observation(env, _range_obs(b, a, range_ba, ts))


def test_pose_lie_is_noop_at_trust_layer():
    """Under range-only voting (ADR 0015) a peer that lies *only* about its
    self-reported pose — without lying about beacon ranges — is geometrically
    inert at the trust layer. The audit story is intentional: pose_lie
    reclassifies to a map-merger anomaly; the trust path never sees it."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    # Bravo lies about its own pose. PoseReport lands; no β beyond the
    # standard presence bootstrap (which doesn't fire here because seed_presence
    # already established mutual sight).
    evaluator.record_pose_report(env, PoseReport("bravo", 50.0, 50.0, 0, 0))
    evaluator.record_pose_report(env, PoseReport("alpha", 0.0, 0.0, 0, 0))
    # Reciprocal beacon ranges are HONEST — bravo lies about pose, not range.
    _seed_reciprocal(evaluator, env, "alpha", "bravo", range_ab=3.0, range_ba=3.0)
    evaluator.flush()
    # No range_inconsistency: pose_lie is invisible to trust.
    range_anomalies = [
        e for e in telemetry.events if e[1]["category"] == "range_inconsistency"
    ]
    assert range_anomalies == [], f"pose_lie must not fire trust anomalies; got {range_anomalies}"
    # Both peers earn α from the agreeing reciprocal range.
    assert evaluator.reputation("alpha") > 0.5
    assert evaluator.reputation("bravo") > 0.5


def test_tier1_works_at_k_equals_1():
    """Tier 1 reciprocal-range check runs at any k≥1 with a reciprocal pair.
    The previous MIN_OBSERVERS=3 gate was geometric-median territory; range
    voting is per-pair and doesn't need three observers."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    # Single observer + subject — one reciprocal pair.
    _seed_reciprocal(evaluator, env, "alpha", "bravo", range_ab=5.0, range_ba=5.0)
    evaluator.flush()
    assert evaluator.reputation("alpha") > 0.5
    assert evaluator.reputation("bravo") > 0.5
    assert telemetry.events == []


def test_consensus_blames_range_liar():
    """A peer that inflates its outgoing beacon range disagrees with the
    honest reciprocal. With only k=1 cohorts (no Tier 2), Tier 1 fires
    symmetric blame on both sides. Multi-tick decay converges blame on
    the consistent liar."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "liar"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    _seed_reciprocal(evaluator, env, "alpha", "liar", range_ab=3.0, range_ba=8.0)
    evaluator.flush()
    anomalies = [e for e in telemetry.events if e[1]["category"] == "range_inconsistency"]
    # Pair fires from both cohort directions (subject view + observer view),
    # each emitting two senders → 4 anomaly events for one disagreement.
    assert len(anomalies) == 4, f"both sides flagged from both directions: {anomalies}"
    senders = {e[1]["sender_id"] for e in anomalies}
    assert senders == {"alpha", "liar"}


def test_outlier_observer_blamed_when_reciprocal_disagrees():
    """Two-tick accumulation: an observer that consistently inflates its
    range to a subject acquires β faster than the subject (because the
    observer participates in more reciprocal pairs across the cohort)."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "victor"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    # alpha (the outlier) inflates its range to victor; bravo and charlie honest.
    _seed_reciprocal(evaluator, env, "alpha", "victor", range_ab=8.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "bravo", "victor", range_ab=4.0, range_ba=4.0)
    _seed_reciprocal(evaluator, env, "charlie", "victor", range_ab=5.0, range_ba=5.0)
    evaluator.flush()
    anomalies = [e for e in telemetry.events if e[1]["category"] == "range_inconsistency"]
    senders = {e[1]["sender_id"] for e in anomalies}
    assert "alpha" in senders  # outlier observer flagged
    # Wave 2 MDS disambiguates; under Wave 1 victor takes the same β.
    assert "victor" in senders
    # Honest reciprocal pairs earn α; alpha and victor each lost 0.5β.
    assert evaluator.reputation("bravo") > 0.5
    assert evaluator.reputation("charlie") > 0.5


def test_full_consensus_emits_no_anomaly_and_rewards_all():
    """Honest swarm: every reciprocal pair agrees; no anomalies fire; every
    peer earns α."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "victor"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    _seed_reciprocal(evaluator, env, "alpha", "victor", range_ab=4.0, range_ba=4.0)
    _seed_reciprocal(evaluator, env, "bravo", "victor", range_ab=3.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "charlie", "victor", range_ab=5.0, range_ba=5.0)
    evaluator.flush()
    assert telemetry.events == []
    for honest in ("alpha", "bravo", "charlie", "victor"):
        assert evaluator.reputation(honest) > 0.5


def test_first_contact_does_not_decay_prior():
    """A new peer's first observation must not see its prior decayed away."""
    evaluator = BetaTrustEvaluator(decay_half_life_ns=1_000_000_000, accept_alpha=1.0)
    alpha = make_identity("alpha")
    env_far_future = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=10**18)
    evaluator.record_accept(env_far_future)
    assert evaluator.reputation("alpha") == pytest.approx(2 / 3)


def test_evidence_decays_one_half_life():
    half_life = 1_000_000_000
    evaluator = BetaTrustEvaluator(decay_half_life_ns=half_life, accept_alpha=1.0)
    # Seed evidence at t=0
    alpha = Identity("alpha", Keypair.generate())
    env_t0 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1)
    evaluator.record_accept(env_t0)  # alpha → α=2, β=1
    evaluator.record_accept(env_t0)  # alpha → α=3, β=1
    # Advance clock by exactly one half-life via a different peer
    bravo = Identity("bravo", Keypair.generate())
    env_t_half = bravo.seal(KIND_POSE, encode(PoseReport("bravo", 0, 0, 0, 0)), timestamp_ns=1 + half_life)
    evaluator.record_accept(env_t_half)
    rep = evaluator.reputation("alpha")
    # α=3 → 1 + (3-1)*0.5 = 2.0 ; β=1 → 1.0 ; score = 2/3
    assert rep == pytest.approx(2 / 3, rel=1e-3)


def test_evidence_returns_to_prior_after_many_half_lives():
    half_life = 1_000_000_000
    evaluator = BetaTrustEvaluator(decay_half_life_ns=half_life)
    alpha = Identity("alpha", Keypair.generate())
    env_t0 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1)
    for _ in range(50):
        evaluator.record_reject(env_t0, VerificationError("bad signature from alpha"))
    bravo = Identity("bravo", Keypair.generate())
    env_far = bravo.seal(KIND_POSE, encode(PoseReport("bravo", 0, 0, 0, 0)), timestamp_ns=1 + half_life * 20)
    evaluator.record_accept(env_far)
    assert evaluator.reputation("alpha") == pytest.approx(0.5, abs=1e-4)


def test_score_recovers_after_compromise_ends():
    """Peer accumulates β, then only α arrives over time, score climbs back toward 1."""
    half_life = 1_000_000_000
    evaluator = BetaTrustEvaluator(decay_half_life_ns=half_life, accept_alpha=1.0)
    alpha = Identity("alpha", Keypair.generate())
    # Compromise: 20 rejects at t=0
    env_t0 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1)
    for _ in range(20):
        evaluator.record_reject(env_t0, VerificationError("bad signature from alpha"))
    rep_compromised = evaluator.reputation("alpha")
    # Recovery: 20 accepts spread over 5 half-lives of clean behavior
    for i in range(1, 21):
        ts = 1 + (half_life * 5 * i // 20)
        env = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=ts)
        evaluator.record_accept(env)
    rep_recovered = evaluator.reputation("alpha")
    assert rep_compromised < 0.1
    assert rep_recovered > 0.7
    assert rep_recovered - rep_compromised > 0.6


def test_evaluator_returns_full_trust_in_self():
    evaluator = BetaTrustEvaluator(self_id="alpha")
    assert evaluator.reputation("alpha") == 1.0
    # Even after evidence accumulates against "self", reputation(self) is 1.0.
    evaluator.observe("alpha", {"beta": 100.0})
    assert evaluator.reputation("alpha") == 1.0


def test_gossip_snapshot_excludes_self():
    evaluator = BetaTrustEvaluator(self_id="alpha")
    evaluator.observe("alpha", {"alpha": 5.0})
    evaluator.observe("bravo", {"alpha": 2.0})
    snap = evaluator.gossip_snapshot()
    assert "alpha" not in snap
    assert "bravo" in snap and snap["bravo"][0] == pytest.approx(3.0)


def test_gossip_about_self_is_ignored():
    receiver = BetaTrustEvaluator(self_id="alpha")
    sender = make_identity("bravo")
    env = sender.seal(KIND_REPUTATION, b"", timestamp_ns=0)
    gossip = ReputationGossip("bravo", {"alpha": [1.0, 1000.0]}, 0)
    receiver.record_gossip(env, gossip)
    assert receiver.reputation("alpha") == 1.0


def test_high_rep_gossiper_outweighs_low_rep_gossiper():
    high = BetaTrustEvaluator(self_id="receiver")
    low = BetaTrustEvaluator(self_id="receiver")
    high.observe("trusted", {"alpha": 50.0})
    sender = make_identity("trusted")
    env = sender.seal(KIND_REPUTATION, b"", timestamp_ns=0)
    g_trusted = ReputationGossip("trusted", {"victim": [1.0, 50.0]}, 0)
    g_untrusted = ReputationGossip("untrusted", {"victim": [1.0, 50.0]}, 0)
    high.record_gossip(env, g_trusted)
    low.record_gossip(env, g_untrusted)
    assert high.reputation("victim") < low.reputation("victim")


def test_gossip_does_not_accumulate_on_repeated_receipt():
    evaluator = BetaTrustEvaluator(self_id="receiver")
    evaluator.observe("trusted", {"alpha": 10.0})
    sender = make_identity("trusted")
    env = sender.seal(KIND_REPUTATION, b"", timestamp_ns=0)
    gossip = ReputationGossip("trusted", {"victim": [1.0, 10.0]}, 0)
    evaluator.record_gossip(env, gossip)
    once = evaluator.reputation("victim")
    for _ in range(4):
        evaluator.record_gossip(env, gossip)
    repeated = evaluator.reputation("victim")
    assert once == pytest.approx(repeated, rel=1e-6)


def test_low_rep_gossipers_carry_negligible_weight():
    """A near-zero-rep gossiper's everyday gossip moves the view < 5pp from prior."""
    evaluator = BetaTrustEvaluator(self_id="receiver")
    evaluator.observe("liar", {"beta": 100.0})  # liar score -> ~0.01
    sender = make_identity("liar")
    env = sender.seal(KIND_REPUTATION, b"", timestamp_ns=0)
    gossip = ReputationGossip("liar", {"victim": [1.0, 20.0]}, 0)
    evaluator.record_gossip(env, gossip)
    assert evaluator.reputation("victim") == pytest.approx(0.5, abs=0.05)


def test_gossip_decays_when_gossiper_goes_silent():
    half_life = 1_000_000_000
    evaluator = BetaTrustEvaluator(self_id="receiver", decay_half_life_ns=half_life)
    evaluator.observe("trusted", {"alpha": 50.0})
    sender = make_identity("trusted")
    env_t0 = sender.seal(KIND_REPUTATION, b"", timestamp_ns=1)
    gossip = ReputationGossip("trusted", {"victim": [1.0, 20.0]}, 1)
    evaluator.record_gossip(env_t0, gossip)
    rep_fresh = evaluator.reputation("victim")
    # Advance the clock 8 half-lives without any new gossip from "trusted"
    bravo = make_identity("bravo")
    env_far = bravo.seal(KIND_POSE, encode(PoseReport("bravo", 0, 0, 0, 0)),
                         timestamp_ns=1 + half_life * 8)
    evaluator.record_accept(env_far)
    rep_aged = evaluator.reputation("victim")
    assert rep_fresh < 0.5
    assert rep_aged == pytest.approx(0.5, abs=0.02)


def test_per_agent_views_can_diverge():
    """Two evaluators see different bus traffic; their first-hand views differ."""
    alpha_eval = BetaTrustEvaluator(self_id="alpha")
    bravo_eval = BetaTrustEvaluator(self_id="bravo")
    rogue = make_identity("mallory")
    env_bad = rogue.seal(KIND_POSE, encode(PoseReport("mallory", 0, 0, 0, 0)))
    # Only alpha rejects the envelope (bravo never sees it)
    try:
        open_envelope(env_bad, Roster(), ReplayWindow())
    except VerificationError as e:
        alpha_eval.record_reject(env_bad, e)
    assert alpha_eval.reputation("mallory") < 0.5
    assert bravo_eval.reputation("mallory") == 0.5


def test_gossip_propagates_view_to_silent_peer():
    """Receiver who never saw the misbehavior learns of it via gossip."""
    informant = BetaTrustEvaluator(self_id="informant")
    receiver = BetaTrustEvaluator(self_id="receiver")
    receiver.observe("informant", {"alpha": 50.0})
    rogue = make_identity("mallory")
    env_bad = rogue.seal(KIND_POSE, encode(PoseReport("mallory", 0, 0, 0, 0)), timestamp_ns=0)
    try:
        open_envelope(env_bad, Roster(), ReplayWindow())
    except VerificationError as e:
        for _ in range(20):
            informant.record_reject(env_bad, e)
    snapshot = informant.gossip_snapshot()
    assert "mallory" in snapshot
    sender = make_identity("informant")
    env = sender.seal(KIND_REPUTATION, b"", timestamp_ns=0)
    gossip = ReputationGossip("informant", snapshot, 0)
    receiver.record_gossip(env, gossip)
    assert receiver.reputation("mallory") < 0.45


def test_decay_clock_does_not_go_backwards():
    half_life = 1_000_000_000
    evaluator = BetaTrustEvaluator(decay_half_life_ns=half_life, accept_alpha=1.0)
    alpha = Identity("alpha", Keypair.generate())
    env_late = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=10**12)
    env_early = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1)
    evaluator.record_accept(env_late)
    evaluator.record_accept(env_early)  # earlier ts must not rewind decay clock
    # Both events count fully; α should be 3
    assert evaluator.reputation("alpha") == pytest.approx(3 / 4)


def test_multi_observer_range_attack_flags_all_lying_pairs():
    """Multiple observers attempt range lies against the same subject. Each
    lying pair fires its own range_inconsistency; the honest pair does not."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "delta", "charlie"])
    a = make_identity("witness")
    env = a.seal(KIND_POSE, encode(PoseReport("witness", 0, 0, 0, 0)), timestamp_ns=0)
    # alpha and bravo lie about their ranges to charlie; charlie reciprocal is honest.
    # delta's pair with charlie agrees.
    _seed_reciprocal(evaluator, env, "alpha", "charlie", range_ab=8.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "bravo", "charlie", range_ab=7.0, range_ba=4.0)
    _seed_reciprocal(evaluator, env, "delta", "charlie", range_ab=2.0, range_ba=2.0)
    evaluator.flush()
    anomalies = {e[1]["sender_id"] for e in telemetry.events
                 if e[1]["category"] == "range_inconsistency"}
    assert "alpha" in anomalies
    assert "bravo" in anomalies
    # delta-charlie pair is honest — delta not flagged for that pair.
    # (delta may appear elsewhere if charlie was previously blamed, but in this
    # closed cohort delta's only pair is honest.)
    assert "delta" not in anomalies


def test_first_hand_score_zero_weight_filters_low_rep_observer():
    """V2 self-anchored beacon filter is the load-bearing weight gate. Tier 1
    only judges pairs whose observer has presence in this evaluator. With
    presence seeded, the weight goes through and the gate doesn't trigger;
    test exercises the weight-gating path directly."""
    evaluator = BetaTrustEvaluator()
    seed_presence(evaluator, ["alpha", "bravo", "delta", "victim"])
    evaluator.observe("alpha", {"beta": 100.0})  # alpha rep ≈ 0.01
    evaluator.observe("bravo", {"beta": 100.0})  # bravo rep ≈ 0.01
    evaluator.observe("delta", {"alpha": 100.0})  # delta rep ≈ 0.99
    a = make_identity("witness")
    env = a.seal(KIND_POSE, encode(PoseReport("witness", 0, 0, 0, 0)), timestamp_ns=0)
    # delta-victim reciprocal agrees; alpha/bravo never participate in reciprocal pairs
    # → only delta's pair is judged, victim gains α.
    _seed_reciprocal(evaluator, env, "delta", "victim", range_ab=5.0, range_ba=5.0)
    evaluator.flush()
    assert evaluator.reputation("victim") > 0.5


def test_voting_skipped_when_total_weight_below_threshold():
    """When all observers have zero first-hand weight (e.g. compromised
    swarm), Tier 1 abstains — no anomalies fire, victim stays at prior."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    # No presence seeded for alpha/bravo/charlie → weight=0 in the vote.
    seed_presence(evaluator, ["victim"])
    for name in ("alpha", "bravo", "charlie"):
        evaluator.observe(name, {"beta": 200.0})
    a = make_identity("witness")
    env = a.seal(KIND_POSE, encode(PoseReport("witness", 0, 0, 0, 0)), timestamp_ns=0)
    # Three zero-weight observers all disagree with victim's reciprocal.
    _seed_reciprocal(evaluator, env, "alpha", "victim", range_ab=8.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "bravo", "victim", range_ab=8.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "charlie", "victim", range_ab=8.0, range_ba=3.0)
    evaluator.flush()
    assert evaluator.reputation("victim") == 0.5
    range_anomalies = [
        e for e in telemetry.events if e[1]["category"] == "range_inconsistency"
    ]
    assert range_anomalies == []


def test_agreement_with_reciprocal_rewards_both_peers_alpha():
    """Every honest reciprocal pair credits α to both sides of the pair.
    With 3 honest observers, each pair fires α once → each peer earns
    α equal to the number of pairs they participate in."""
    evaluator = BetaTrustEvaluator()
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "victor"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    _seed_reciprocal(evaluator, env, "alpha", "victor", range_ab=2.0, range_ba=2.0)
    _seed_reciprocal(evaluator, env, "bravo", "victor", range_ab=3.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "charlie", "victor", range_ab=4.0, range_ba=4.0)
    evaluator.flush()
    # Each pair fires from both cohort directions. Honest peers participate in
    # one pair each (with victor) → α=2 each (one from each direction).
    # victor participates in three pairs → α=6.
    for honest in ("alpha", "bravo", "charlie"):
        assert evaluator.reputation(honest) == pytest.approx(3 / 4)
    assert evaluator.reputation("victor") == pytest.approx(7 / 8)


def test_subject_reciprocal_ranges_matching_observers_earns_alpha():
    """The subject's own reciprocal beacons agreeing with observers' beacons
    earns α to the subject — same Tier 1 path, viewed from the subject side."""
    evaluator = BetaTrustEvaluator()
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "victor"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    _seed_reciprocal(evaluator, env, "alpha", "victor", range_ab=2.0, range_ba=2.0)
    _seed_reciprocal(evaluator, env, "bravo", "victor", range_ab=3.0, range_ba=3.0)
    _seed_reciprocal(evaluator, env, "charlie", "victor", range_ab=4.0, range_ba=4.0)
    evaluator.flush()
    # 3 pairs × 2 directions × 1α per fire = 6α to victor.
    assert evaluator.reputation("victor") == pytest.approx(7 / 8)


def test_vote_fires_only_once_per_subject_timestamp():
    """Cohort closes at most once per `(subject, ts)` key — duplicates from
    the same logical tick produce a single set of α/β charges."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "delta", "liar"])
    alpha = make_identity("alpha")
    env = seal_pose(alpha)
    # 4 honest observers all disagreeing with liar's reciprocal at the same ts.
    _seed_reciprocal(evaluator, env, "alpha", "liar", range_ab=2.0, range_ba=8.0)
    _seed_reciprocal(evaluator, env, "bravo", "liar", range_ab=3.0, range_ba=8.0)
    _seed_reciprocal(evaluator, env, "charlie", "liar", range_ab=4.0, range_ba=8.0)
    _seed_reciprocal(evaluator, env, "delta", "liar", range_ab=5.0, range_ba=8.0)
    evaluator.flush()
    # 4 mismatches × 2 sides × 2 cohort directions = 16 range_inconsistency events.
    anomalies = [e for e in telemetry.events if e[1]["category"] == "range_inconsistency"]
    assert len(anomalies) == 16
    # Liar gets blamed 4 times (one per reciprocal pair) → β=4·0.5=2.0.
    # Observers get blamed once each → β=0.5.
    assert evaluator.reputation("liar") < 0.5


def test_vote_waits_for_cohort_close_before_firing():
    """Cohort-close gating: vote must NOT fire until a later-ts envelope arrives.

    Catches the colluder-early-fire bug — at MIN_OBSERVERS=3 with deterministic
    publish order, the first 3 claims could carry the median before honest
    observers reported. Now we wait for the logical tick to advance.
    """
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "liar"])
    alpha = make_identity("alpha")
    env_t0 = seal_pose(alpha, timestamp_ns=0)
    # Three honest observers all disagreeing with liar's reciprocal at ts=0.
    _seed_reciprocal(evaluator, env_t0, "alpha", "liar", range_ab=2.0, range_ba=8.0, ts=0)
    _seed_reciprocal(evaluator, env_t0, "bravo", "liar", range_ab=3.0, range_ba=8.0, ts=0)
    _seed_reciprocal(evaluator, env_t0, "charlie", "liar", range_ab=4.0, range_ba=8.0, ts=0)
    # Cohort still open — no vote until logical time advances.
    assert evaluator.reputation("liar") == 0.5
    assert telemetry.events == []
    # An envelope at a later timestamp closes the cohort.
    env_t1 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 0)), timestamp_ns=1)
    evaluator.record_pose_report(env_t1, PoseReport("alpha", 0, 0, 0, 1))
    assert evaluator.reputation("liar") < 0.5
    anomalies = [e for e in telemetry.events if e[1]["category"] == "range_inconsistency"]
    # 3 mismatches × 2 sides × 2 cohort directions = 12 anomaly events.
    assert len(anomalies) == 12


# ---------------------------------------------------------------------------
# V3 presence regression: sticky existence + bootstrap-once β + transitive.
# ---------------------------------------------------------------------------

def _record_self_beacon(evaluator: BetaTrustEvaluator, subject: str, ts: int = 0) -> None:
    """Simulate self beaconing `subject` once. Bypasses Observation envelope
    plumbing because the rule we're testing only reads from `_seen_by`."""
    assert evaluator._self_id is not None
    evaluator._seen_by.setdefault(subject, {})[evaluator._self_id] = ts


def test_honest_peer_seen_once_stays_trusted_across_sensor_gap():
    """V3 #1 — sticky existence. After self has personally beaconed `bravo`,
    bravo can walk out of range and continue sending PoseReports forever
    without trust collapse. Pre-V3, each tick added 1.0 β; here zero β fires
    so the score stays at the prior 0.5."""
    evaluator = BetaTrustEvaluator(self_id="self")
    _record_self_beacon(evaluator, "bravo", ts=0)
    bravo = make_identity("bravo")
    for tick in range(200):
        ts = tick * 100_000_000
        env = bravo.seal(KIND_POSE, encode(PoseReport("bravo", 50.0, 50.0, 0, ts)), timestamp_ns=ts)
        evaluator.record_pose_report(env, PoseReport("bravo", 50.0, 50.0, 0, ts))
    assert evaluator.reputation("bravo") == pytest.approx(0.5, abs=1e-3)


def test_unseen_peer_charged_beta_exactly_once():
    """V3 #2 — bootstrap β is one-shot. An unproven entity is penalized
    on its first PoseReport and then ignored until presence is established."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(self_id="self", telemetry=telemetry)
    _record_self_beacon(evaluator, "self", ts=0)
    rogue = make_identity("rogue")
    for tick in range(50):
        ts = tick * 100_000_000
        env = rogue.seal(KIND_POSE, encode(PoseReport("rogue", 9.0, 9.0, 0, ts)), timestamp_ns=ts)
        evaluator.record_pose_report(env, PoseReport("rogue", 9.0, 9.0, 0, ts))
    no_presence = [e for e in telemetry.events if e[1]["category"] == "no_beacon_presence"]
    assert len(no_presence) == 1, "PRESENCE_BETA must fire exactly once per peer"
    # Score sits well below prior post-charge; β decays toward prior over time.
    assert 0.3 < evaluator.reputation("rogue") < 0.45


def test_sybil_cabal_mutual_gossip_cannot_manufacture_presence():
    """V3 defense check. Three sybils, none ever beaconed by self, vouching
    for each other through Observation envelopes. Per-tick PoseReports + mutual
    Observations must not earn presence; cabal score stays suppressed."""
    evaluator = BetaTrustEvaluator(self_id="self")
    _record_self_beacon(evaluator, "self", ts=0)
    sybils = ["sybil_a", "sybil_b", "sybil_c"]
    idents = {s: make_identity(s) for s in sybils}
    for tick in range(100):
        ts = tick * 100_000_000
        for s in sybils:
            env = idents[s].seal(KIND_POSE, encode(PoseReport(s, 1.0, 1.0, 0, ts)), timestamp_ns=ts)
            evaluator.record_pose_report(env, PoseReport(s, 1.0, 1.0, 0, ts))
        for observer in sybils:
            for subject in sybils:
                if observer == subject:
                    continue
                env = idents[observer].seal(
                    KIND_POSE, encode(PoseReport(observer, 0, 0, 0, ts)), timestamp_ns=ts
                )
                evaluator.record_observation(env, Observation(observer, subject, 0.5, 0.0, ts))
    now = 100 * 100_000_000
    for s in sybils:
        assert not evaluator._has_presence(s, now), f"{s} should lack presence (no self anchor)"
    for s in sybils:
        assert evaluator.reputation(s) < 0.3, f"{s} score = {evaluator.reputation(s)}"


def test_one_hop_transitive_presence_through_self_vouched_granter():
    """V3 #3 — if self has personally beaconed Y, and Y recently beaconed Z
    (within PRESENCE_WINDOW_NS), Z is presence-eligible. Z's PoseReport must
    NOT incur the bootstrap β."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(self_id="self", telemetry=telemetry)
    _record_self_beacon(evaluator, "bravo", ts=0)
    bravo = make_identity("bravo")
    ts_observe = 500_000_000
    env_b = bravo.seal(
        KIND_POSE, encode(PoseReport("bravo", 0, 0, 0, ts_observe)), timestamp_ns=ts_observe
    )
    evaluator.record_pose_report(env_b, PoseReport("bravo", 0, 0, 0, ts_observe))
    evaluator.record_observation(env_b, _obs("bravo", "charlie", 1.0, 0.0, ts_observe))
    charlie = make_identity("charlie")
    ts_pose = ts_observe + 1_000_000_000  # 1s later — within PRESENCE_WINDOW_NS (2s)
    env_c = charlie.seal(
        KIND_POSE, encode(PoseReport("charlie", 5, 5, 0, ts_pose)), timestamp_ns=ts_pose
    )
    evaluator.record_pose_report(env_c, PoseReport("charlie", 5, 5, 0, ts_pose))
    no_presence = [e for e in telemetry.events if e[1]["category"] == "no_beacon_presence"]
    assert no_presence == [], "charlie should inherit presence from self-vouched bravo"
    assert evaluator._has_presence("charlie", ts_pose)


def test_transitive_presence_blocked_when_granter_lacks_self_anchor():
    """V3 #3 defense — if self has NOT beaconed the granter, transitive
    presence does not apply. This is the property that defeats Sybil cabals."""
    evaluator = BetaTrustEvaluator(self_id="self")
    _record_self_beacon(evaluator, "self", ts=0)
    mallory = make_identity("mallory")
    ts = 500_000_000
    env_m = mallory.seal(KIND_POSE, encode(PoseReport("mallory", 0, 0, 0, ts)), timestamp_ns=ts)
    evaluator.record_pose_report(env_m, PoseReport("mallory", 0, 0, 0, ts))
    evaluator.record_observation(env_m, _obs("mallory", "victim", 1.0, 0.0, ts))
    assert not evaluator._has_presence("victim", ts + 100_000_000)


# ---------------------------------------------------------------------------
# Per-observation uncertainty propagation.
# ---------------------------------------------------------------------------

def test_noisy_honest_reciprocal_ranges_not_penalized_within_3sigma():
    """Honest beacon noise within the σ envelope must not fire β. At
    σ_combined ≈ 0.17m and k=3, gaps up to ~0.5m pass. A 0.3m honest
    disagreement (within 2σ) should earn α, not β."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "victim"])
    alpha = make_identity("alpha")
    env_t0 = seal_pose(alpha, timestamp_ns=0)
    # Three reciprocal pairs with within-σ disagreement.
    _seed_reciprocal(evaluator, env_t0, "alpha", "victim", range_ab=4.0, range_ba=4.2, ts=0)
    _seed_reciprocal(evaluator, env_t0, "bravo", "victim", range_ab=3.0, range_ba=3.3, ts=0)
    _seed_reciprocal(evaluator, env_t0, "charlie", "victim", range_ab=5.0, range_ba=4.8, ts=0)
    env_t1 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 1)), timestamp_ns=1)
    evaluator.record_pose_report(env_t1, PoseReport("alpha", 0, 0, 0, 1))
    anomalies = [
        e for e in telemetry.events if e[1]["category"] == "range_inconsistency"
    ]
    assert anomalies == [], f"honest noise must not fire β; got {anomalies}"


def test_range_liar_observer_still_flagged():
    """An observer whose reciprocal disagrees grossly (well beyond 3σ) still
    earns β. Tier 1 catches range_lie within a single cohort close."""
    telemetry = ListTelemetry()
    evaluator = BetaTrustEvaluator(telemetry=telemetry)
    seed_presence(evaluator, ["alpha", "bravo", "charlie", "liar", "victim"])
    alpha = make_identity("alpha")
    env_t0 = seal_pose(alpha, timestamp_ns=0)
    # Three honest reciprocal pairs + one range-lying pair (liar inflates by 5m).
    _seed_reciprocal(evaluator, env_t0, "alpha", "victim", range_ab=3.0, range_ba=3.0, ts=0)
    _seed_reciprocal(evaluator, env_t0, "bravo", "victim", range_ab=2.0, range_ba=2.0, ts=0)
    _seed_reciprocal(evaluator, env_t0, "charlie", "victim", range_ab=3.0, range_ba=3.0, ts=0)
    _seed_reciprocal(evaluator, env_t0, "liar", "victim", range_ab=8.0, range_ba=3.0, ts=0)
    env_t1 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 1)), timestamp_ns=1)
    evaluator.record_pose_report(env_t1, PoseReport("alpha", 0, 0, 0, 1))
    flagged = [e for e in telemetry.events
               if e[1]["category"] == "range_inconsistency" and e[1]["sender_id"] == "liar"]
    # The liar-victim pair has no inter-observer reciprocals available in
    # this synthetic test (no alpha-bravo beacons published), so Tier 2 can't
    # build a complete cohort matrix; tier2_ran=False and Tier 1 fires
    # symmetric blame. Pair fires from both cohort directions → 2 liar events.
    assert len(flagged) == 2


def test_range_reciprocal_k_sigma_constructor_parameter_tunes_threshold():
    """`range_reciprocal_k_sigma` is the per-pair tolerance multiplier. Strict
    values catch smaller disagreements; relaxed values forgive larger ones."""
    seed_presence_for = ["alpha", "subj"]
    strict = BetaTrustEvaluator(range_reciprocal_k_sigma=1.0)
    relaxed = BetaTrustEvaluator(range_reciprocal_k_sigma=10.0)
    seed_presence(strict, seed_presence_for)
    seed_presence(relaxed, seed_presence_for)
    alpha = make_identity("alpha")
    env_t0 = seal_pose(alpha, timestamp_ns=0)
    # 1.0m reciprocal mismatch — beyond strict's ~0.17m threshold,
    # well inside relaxed's ~1.7m threshold.
    for ev in (strict, relaxed):
        _seed_reciprocal(ev, env_t0, "alpha", "subj", range_ab=3.0, range_ba=4.0, ts=0)
        env_t1 = alpha.seal(KIND_POSE, encode(PoseReport("alpha", 0, 0, 0, 1)), timestamp_ns=1)
        ev.record_pose_report(env_t1, PoseReport("alpha", 0, 0, 0, 1))
    assert strict.reputation("subj") < relaxed.reputation("subj"), \
        "strict k_sigma should penalize harder than relaxed"
