"""Per-peer Beta(α, β) reputation. ADR 0002 (Beta core) + ADR 0015 (range-only
voting).

The evaluator votes on **range only** — the single frame-invariant scalar
emitted by a beacon. Observer SLAM poses do not enter the trust path.

Two tiers compose:

- **Tier 1** (this module, Wave 1) — pairwise reciprocal-range agreement.
  For each cohort `(subject, ts)`, every observer's reported range to the
  subject is checked against the subject's own reported range to that
  observer. Mismatch beyond `RANGE_RECIPROCAL_K_SIGMA · σ` charges β to both
  sides of the disagreement (decay machinery converges on the consistent
  liar over multiple ticks).

- **Tier 2** (added Wave 2) — eigenvalue-residual classical MDS on the cohort
  distance matrix when `k ≥ MIN_K_FOR_TIER2`. Catches symmetric collusion
  (Tier 1 evading) by detecting non-2D-embeddability of the joint geometry.

V2 self-anchored beacon defense composes orthogonally — sybils have no body,
so honest peers' `_has_presence` filter zeroes their weight before either
tier fires.
"""

import math
from dataclasses import dataclass

import numpy as np

from ..interfaces import Telemetry
from ..interfaces import TrustEvaluator as TrustEvaluatorABC
from ..messages import Observation, PoseReport, ReputationGossip
from ..secure_bus import Envelope, VerificationError
from . import mds

PRIOR_ALPHA = 1.0
PRIOR_BETA = 1.0

# Tier 1: reciprocal-range voting thresholds.
SIGMA_BEACON_RANGE_M = 0.10           # DWM1000 range stddev (ADR 0005)
SIGMA_NLOS_RANGE_M = 0.07             # NLOS multipath envelope (sqrt(0.02·0.5²))
RANGE_RECIPROCAL_K_SIGMA = 3.0        # ~99.7% honest noise within this
# Combined two-direction noise: independent observer + subject + NLOS terms.
# At k=3, threshold floor ≈ 0.48m — close to legacy GEOMETRIC_THRESHOLD_M=0.5m.

# β charge split when reciprocal disagrees but no third party disambiguates.
TIER1_DISAGREE_BETA = 0.5             # 0.5 each side → 1.0 total per disagreement

# Per-observer weight floor. A compromised observer (heavy β load) should not
# be allowed to keep blaming others. Default permits an unproven peer
# (score=0.5) to participate but excludes peers driven well below the prior.
MIN_OBSERVER_WEIGHT = 0.1
# Tier 1 runs at any k≥1 with a reciprocal pair; Tier 2 needs k≥3 for 2D MDS.
MIN_K_FOR_TIER2 = 3
# Tier 2 MDS thresholds — empirically calibrated (ADR 0015 verification run).
# Honest swarms produce embeddability < 0.05; colluder-pair attacks elevate above.
MDS_EMBEDDABILITY_TAU = 0.05
# Edge residual threshold for lying-edge attribution. Honest beacon noise
# produces edge residuals < ~3σ ≈ 0.3m; colluder-pair bias of 3m yields edge
# residuals ≈ bias/2 ≈ 1.5m on the lying edge and smaller spillage on others.
MDS_LYING_EDGE_M = 0.8
# Per-cohort β cap from MDS (bounds single-cohort damage; decay accumulates
# across ticks to converge on consistent outliers).
MDS_BETA_CAP = 1.0

WINDOW_NS = 1_000_000_000
DECAY_HALF_LIFE_NS = 10_000_000_000
GOSSIP_DISCOUNT = 0.1
ACCEPT_ALPHA = 0.1  # weight of "valid signature" α relative to behavioral α (1.0 from voting)
PRESENCE_WINDOW_NS = 2_000_000_000  # 2s — peer's beacon-corroboration must be fresher than this
PRESENCE_BETA = 1.0  # β per uncorroborated PoseReport (proof-of-physical-presence rule)
OBSERVATION_PRESENCE_BETA = 0.2  # β per Observation of a subject lacking self-presence — V2 anti-mutual-corroboration


@dataclass
class PeerReputation:
    alpha: float = PRIOR_ALPHA
    beta: float = PRIOR_BETA
    last_update_ns: int = 0

    @property
    def score(self) -> float:
        return self.alpha / (self.alpha + self.beta)


@dataclass(frozen=True)
class CohortEvent:
    """Record of one cohort close. Workshop notebooks use these to drive the
    cohort-close timeline visualization (notebook 04). `fired=False` means
    the cohort closed but had insufficient weight to vote (abstain).

    `tier_used` indicates which tier ran:
      - `"t1"` — reciprocal-range only (k<3 or all pairs agreed)
      - `"t2"` — MDS multilateration also fired (added Wave 2)
      - `"skip"` — abstained (insufficient weight or no reciprocal data)

    `median_range_m` is the cohort's median observer range to the subject,
    useful for visualization. `embeddability_score` is the Tier-2 MDS score
    when t2 fired, else None.
    """

    subject_id: str
    timestamp_ns: int
    observer_count: int
    fired: bool
    tier_used: str
    median_range_m: float | None
    embeddability_score: float | None


class BetaTrustEvaluator(TrustEvaluatorABC):
    """Tracks per-peer Beta(α,β) reputation. Generic `observe(peer_id, evidence)`
    satisfies the ABC; `record_accept`/`record_reject` are bus-aware helpers that
    classify VerificationError messages into anomaly categories.

    Geometric cross-validation operates on **range only** (ADR 0015). For each
    cohort `(subject, ts)`, observations of the subject from peers in beacon
    range build the cohort. At cohort close (a later-timestamp envelope arrives
    or `flush()` is called), Tier 1 checks pairwise reciprocal-range agreement
    between each observer and the subject. Disagreement beyond `k·σ` charges β
    to both sides (decay converges on consistent liars across ticks). Wave 2
    adds Tier 2 MDS for k≥3 cohorts to catch symmetric collusion.

    Evidence above the prior decays exponentially with half-life
    `DECAY_HALF_LIFE_NS` so old behavior fades and a peer that stops misbehaving
    rehabilitates over a few half-lives. Time source is the latest envelope
    timestamp seen — logical, not wall-clock — so paused or replayed simulations
    behave deterministically.

    With `self_id` set, the evaluator represents one specific agent's private
    view and integrates gossip from peers, weighting each gossiper's
    contribution by that gossiper's first-hand score (recursion broken at one
    level so a high-rep gossiper carries proportionally more influence).
    `reputation(self_id)` is hard-coded to 1.0.
    """

    def __init__(
        self,
        telemetry: Telemetry | None = None,
        min_observers: int = MIN_K_FOR_TIER2,
        decay_half_life_ns: int = DECAY_HALF_LIFE_NS,
        self_id: str | None = None,
        gossip_discount: float = GOSSIP_DISCOUNT,
        accept_alpha: float = ACCEPT_ALPHA,
        range_reciprocal_k_sigma: float = RANGE_RECIPROCAL_K_SIGMA,
    ) -> None:
        self._peers: dict[str, PeerReputation] = {}
        self._telemetry = telemetry
        self._min_observers = min_observers
        self._half_life_ns = decay_half_life_ns
        self._self_id = self_id
        self._gossip_discount = gossip_discount
        self._accept_alpha = accept_alpha
        self._range_k_sigma = range_reciprocal_k_sigma
        self._gossip_views: dict[str, dict[str, PeerReputation]] = {}
        # Cohort: (subject, ts) → list[(observer, range_m, sigma_r)]
        self._pending: dict[
            tuple[str, int], list[tuple[str, float, float]]
        ] = {}
        self._voted: set[tuple[str, int]] = set()
        # Each reciprocal pair `(frozenset({a, b}), ts)` is judged at most once
        # across the two cohort closures it appears in (subject side + observer
        # side). Without this, every disagreement would fire β twice.
        self._judged_pairs: set[tuple[frozenset[str], int]] = set()
        self._decay_clock_ns = 0
        self._seen_by: dict[str, dict[str, int]] = {}  # subject -> {observer: ts_ns}
        self._cohort_log: list[CohortEvent] = []
        self._charged_no_presence: set[str] = set()  # peers already charged bootstrap β

    def observe(self, peer_id: str, evidence: dict[str, float]) -> None:
        rep = self._peer(peer_id)
        self._decay(rep)
        rep.alpha += evidence.get("alpha", 0.0)
        rep.beta += evidence.get("beta", 0.0)

    def reputation(self, peer_id: str) -> float:
        if peer_id == self._self_id:
            return 1.0
        own = self._peer(peer_id)
        self._decay(own)
        alpha, beta = own.alpha, own.beta
        for gossiper_id, views in self._gossip_views.items():
            view = views.get(peer_id)
            if view is None:
                continue
            self._decay(view)
            weight = self._first_hand_score(gossiper_id) * self._gossip_discount
            alpha += weight * (view.alpha - 1.0)
            beta += weight * (view.beta - 1.0)
        total = alpha + beta
        if total <= 0:
            return 0.5
        return alpha / total

    def _first_hand_score(self, peer_id: str) -> float:
        rep = self._peers.get(peer_id)
        if rep is None:
            return 0.5
        self._decay(rep)
        return rep.score

    def cohort_events(self) -> list[CohortEvent]:
        """All cohort closures observed so far, in chronological order.

        Workshop accessor (notebook 04 cohort-close timeline). Each `_vote`
        call appends one entry — including abstain cases (`fired=False`).
        """
        return list(self._cohort_log)

    def pending_cohorts(
        self,
    ) -> dict[tuple[str, int], list[tuple[str, float]]]:
        """Read-only view of currently-open observation cohorts, keyed by
        `(subject_id, timestamp_ns)`. Each value is the list of
        `(observer_id, range_m)` pairs accumulated so far.

        Workshop accessor (notebook 04 triangulation 2D plot — observer
        positions come from sim/SLAM, range draws the locus circle).
        """
        return {
            key: [(obs_id, range_m) for obs_id, range_m, _sigma in claims]
            for key, claims in self._pending.items()
        }

    def gossip_snapshot(self) -> dict[str, list[float]]:
        snapshot: dict[str, list[float]] = {}
        for peer_id, rep in self._peers.items():
            if peer_id == self._self_id:
                continue
            self._decay(rep)
            snapshot[peer_id] = [rep.alpha, rep.beta]
        return snapshot

    def record_gossip(self, env: Envelope, gossip: ReputationGossip) -> None:
        self._decay_clock_ns = max(self._decay_clock_ns, env.timestamp_ns)
        self._vote_closed_cohorts(env.nonce)
        if gossip.gossiper_id == self._self_id:
            return
        bucket = self._gossip_views.setdefault(gossip.gossiper_id, {})
        for target_id, view in gossip.views.items():
            if target_id == self._self_id:
                continue
            if len(view) != 2:
                continue
            bucket[target_id] = PeerReputation(
                alpha=float(view[0]),
                beta=float(view[1]),
                last_update_ns=self._decay_clock_ns,
            )

    def record_accept(self, env: Envelope) -> None:
        self._decay_clock_ns = max(self._decay_clock_ns, env.timestamp_ns)
        self.observe(env.sender_id, {"alpha": self._accept_alpha})

    def record_reject(self, env: Envelope, error: VerificationError) -> None:
        self._decay_clock_ns = max(self._decay_clock_ns, env.timestamp_ns)
        category = _categorize(str(error))
        self.observe(env.sender_id, {"beta": 1.0})
        if self._telemetry is not None:
            self._telemetry.emit(
                "trust.anomaly",
                sender_id=env.sender_id,
                category=category,
                nonce=env.nonce,
                timestamp_ns=env.timestamp_ns,
                detail=str(error),
            )

    def record_pose_report(self, env: Envelope, pose: PoseReport) -> None:
        """Pose reports drive the V2/V3 presence-bootstrap β charge only.
        Subject self-pose values themselves do **not** enter trust voting
        (ADR 0015) — `pose_lie` without an accompanying `range_lie` is a
        no-op at the trust layer."""
        self._decay_clock_ns = max(self._decay_clock_ns, env.timestamp_ns)
        if self._seen_by and not self._has_presence(pose.agent_id, env.timestamp_ns):
            if pose.agent_id not in self._charged_no_presence:
                # One-shot bootstrap β. Charge once per peer, not every tick.
                self._charged_no_presence.add(pose.agent_id)
                self.observe(pose.agent_id, {"beta": PRESENCE_BETA})
                if self._telemetry is not None:
                    self._telemetry.emit(
                        "trust.anomaly",
                        sender_id=pose.agent_id,
                        category="no_beacon_presence",
                        nonce=env.nonce,
                        timestamp_ns=env.timestamp_ns,
                        detail=f"{pose.agent_id} self-pose with no beacon corroboration",
                    )
        elif self._has_presence(pose.agent_id, env.timestamp_ns):
            self._charged_no_presence.discard(pose.agent_id)
        self._vote_closed_cohorts(env.nonce)

    def record_observation(self, env: Envelope, obs: Observation) -> None:
        """Buffer the observation's `range_m` into the cohort `(subject, ts)`.
        Observer SLAM pose does NOT enter the trust path (ADR 0015).
        """
        self._decay_clock_ns = max(self._decay_clock_ns, env.timestamp_ns)
        self._vote_closed_cohorts(env.nonce)
        self._seen_by.setdefault(obs.subject_id, {})[obs.observer_id] = env.timestamp_ns
        # V2: observer claiming to see a subject without self-anchored presence
        # is reporting a sensor reading of a non-existent entity. Per-envelope β
        # balances per-envelope `record_accept` α so high-volume mutual
        # fake-corroboration can't outpace the presence rule on count.
        if (
            self._self_id is not None
            and self._seen_by  # bootstrap: skip until we've seen any observation
            and obs.subject_id != self._self_id
            and not self._has_presence(obs.subject_id, env.timestamp_ns)
        ):
            self.observe(obs.observer_id, {"beta": OBSERVATION_PRESENCE_BETA})
        sigma_r = _range_sigma(obs.range_m)
        key = (obs.subject_id, obs.timestamp_ns)
        self._pending.setdefault(key, []).append((obs.observer_id, obs.range_m, sigma_r))
        self._prune_old()

    def _has_presence(self, peer_id: str, now_ns: int) -> bool:
        """V3 — sticky self-anchored presence + one-hop transitive presence.

        When `self_id` is set:
          (a) **Sticky existence** (#1): if self has *ever* beaconed `peer_id`,
              presence is True forever. A peer's body either exists or it
              doesn't; intermittent sensor contact does not retract that fact.
              Reputation (separate from presence) still collapses on bad
              signatures, revocation, or range inconsistency.
          (b) **One-hop transitive presence** (#3): if any granter `G` has
              recent beacon evidence (within `PRESENCE_WINDOW_NS`) about
              `peer_id`, AND self has personally beaconed `G` at some point,
              then `peer_id` is presence-eligible. The self-anchor on `G`
              prevents a Sybil cabal from vouching for itself — Sybils have
              no body, so self never beacons any member of the cabal.

        Falls back to V1 (any non-self granter, windowed) when `self_id`
        is None (standalone-evaluator unit tests).
        """
        if peer_id == self._self_id:
            return True
        granters = self._seen_by.get(peer_id, {})
        if self._self_id is not None:
            if self._self_id in granters:
                return True  # sticky existence (#1)
            # One-hop transitive: any self-vouched granter with recent beacon (#3).
            for granter_id, ts in granters.items():
                if granter_id == self._self_id or granter_id == peer_id:
                    continue
                if self._self_id not in self._seen_by.get(granter_id, {}):
                    continue  # granter itself lacks self-anchored existence
                if now_ns - ts < PRESENCE_WINDOW_NS:
                    return True
            return False
        for observer_id, ts in granters.items():
            if observer_id == peer_id:
                continue
            if now_ns - ts < PRESENCE_WINDOW_NS:
                return True
        return False

    def flush(self, nonce: int = 0) -> None:
        """Vote on all open cohorts. Call when no further envelopes will arrive."""
        for key in list(self._pending):
            if key in self._voted:
                continue
            self._vote(nonce, key)
            self._voted.add(key)

    def _peer(self, peer_id: str) -> PeerReputation:
        rep = self._peers.get(peer_id)
        if rep is None:
            rep = PeerReputation(last_update_ns=self._decay_clock_ns)
            self._peers[peer_id] = rep
        return rep

    def _decay(self, rep: PeerReputation) -> None:
        dt = self._decay_clock_ns - rep.last_update_ns
        if dt <= 0:
            return
        factor = 0.5 ** (dt / self._half_life_ns)
        rep.alpha = 1.0 + (rep.alpha - 1.0) * factor
        rep.beta = 1.0 + (rep.beta - 1.0) * factor
        rep.last_update_ns = self._decay_clock_ns

    def _vote_closed_cohorts(self, nonce: int) -> None:
        for key in list(self._pending):
            if key in self._voted:
                continue
            if key[1] >= self._decay_clock_ns:
                continue  # cohort still open at current logical time
            self._vote(nonce, key)
            self._voted.add(key)

    def _vote(self, nonce: int, key: tuple[str, int]) -> None:
        """Cohort close. Run Tier 1 reciprocal-range check on each observer
        that has a reciprocal observation from the subject in the same logical
        tick. Wave 2 adds Tier 2 MDS for k≥MIN_K_FOR_TIER2 cohorts.
        """
        subject_id, ts = key
        claims = self._pending[key]
        weighted = [
            (
                observer_id,
                range_m,
                sigma_r,
                self._first_hand_score(observer_id)
                * (1.0 if self._has_presence(observer_id, ts) else 0.0),
            )
            for observer_id, range_m, sigma_r in claims
        ]
        # Per-observer weight gates judging (presence + first-hand score).
        # No cohort-level total threshold — Tier 1 judges pair-by-pair, and a
        # single honest reciprocal pair is a valid signal in small swarms.
        # A heavily-compromised observer (weight < MIN_OBSERVER_WEIGHT) cannot
        # blame others.
        if not any(w >= MIN_OBSERVER_WEIGHT for *_, w in weighted):
            self._cohort_log.append(
                CohortEvent(
                    subject_id=subject_id,
                    timestamp_ns=ts,
                    observer_count=len(claims),
                    fired=False,
                    tier_used="skip",
                    median_range_m=None,
                    embeddability_score=None,
                )
            )
            return

        # Tier 2 first: if k ≥ MIN_K_FOR_TIER2 and embeddability is bad, the
        # cohort cannot be trusted at the per-pair level either — colluders
        # who pass reciprocal Tier 1 must not also harvest α from their
        # symmetric agreement. Tier 2's outlier set suppresses Tier 1
        # rewards/blame for those peers.
        embeddability = None
        tier_used = "t1"
        outliers: set[str] = set()
        tier2_ran = False
        if len(weighted) >= MIN_K_FOR_TIER2:
            tier2_result, tier2_outliers = self._run_tier2(
                subject_id, ts, weighted, nonce
            )
            if tier2_result is not None:
                tier2_ran = True
                embeddability = tier2_result
                if tier2_result > MDS_EMBEDDABILITY_TAU:
                    tier_used = "t2"
                    outliers = tier2_outliers

        # Tier 1: pairwise reciprocal-range check. Three regimes:
        #   - Tier 2 ran and FOUND outliers → blame only the outliers; Tier 1
        #     skips β (avoid double-blame), still awards α for agreeing pairs.
        #   - Tier 2 ran and found NOTHING but reciprocals disagree → a
        #     single-source attack with geometrically-consistent bias
        #     (range_lie, beacon_spoof, sensor_fuzz). The disagreement count
        #     per peer identifies the source — the liar participates in many
        #     pairs, honest peers in few. Blame the peer with the most
        #     disagreements (or both if tied).
        #   - Tier 2 didn't run (k<3 or incomplete) → fall back to symmetric
        #     Tier 1 blame across each disagreeing pair.
        any_tier1_fired = False
        tier1_disagreements: list[tuple[str, str, float, float]] = []  # (O, S, gap, threshold)
        for observer_id, range_m, sigma_r, weight in weighted:
            if weight < MIN_OBSERVER_WEIGHT:
                continue
            subject_score = self._first_hand_score(subject_id)
            if subject_score < MIN_OBSERVER_WEIGHT:
                continue
            if observer_id in outliers or subject_id in outliers:
                continue  # Tier 2 already flagged this peer in this cohort
            # Each cohort independently judges its pairs. Pairs fire from both
            # cohort directions (subject's view and observer's view); the
            # double-fire is intentional — it gives source-attribution complete
            # visibility of each peer's disagreement participation.
            reciprocal = self._find_reciprocal(observer_id, subject_id, ts)
            if reciprocal is None:
                continue
            recip_range, recip_sigma = reciprocal
            combined_sigma = math.sqrt(sigma_r ** 2 + recip_sigma ** 2)
            gap = abs(range_m - recip_range)
            threshold = self._range_k_sigma * combined_sigma
            if gap <= threshold:
                self.observe(observer_id, {"alpha": 1.0})
                self.observe(subject_id, {"alpha": 1.0})
            else:
                tier1_disagreements.append((observer_id, subject_id, gap, threshold))

        # Apply tier-1 disagreement blame per the three regimes.
        if tier1_disagreements:
            any_tier1_fired = True
            if tier2_ran and not outliers:
                # Tier 2 ran, no geometric outliers, but reciprocals disagree
                # — single-source attack signature. Blame the peer with the
                # most disagreement participations (the liar contributes to
                # many disagreements; honest peers paired with the liar
                # contribute to few).
                participation: dict[str, int] = {}
                for obs_id, subj_id, _, _ in tier1_disagreements:
                    participation[obs_id] = participation.get(obs_id, 0) + 1
                    participation[subj_id] = participation.get(subj_id, 0) + 1
                max_count = max(participation.values())
                sorted_counts = sorted(participation.values(), reverse=True)
                # Only fire β when we have a clear leader: max count ≥ 2 AND
                # ≥ 2× the next peer. Otherwise the evidence is ambiguous —
                # wait for the next cohort. Avoids false positives at the
                # cost of slower detection in noisy single-source attacks.
                dominant_single = (
                    max_count >= 2
                    and (len(sorted_counts) < 2 or max_count >= 2 * sorted_counts[1])
                )
                suspects: set[str] = set()
                if dominant_single:
                    suspects = {p for p, c in participation.items() if c == max_count}
                    suspect = next(iter(suspects))
                    self.observe(suspect, {"beta": TIER1_DISAGREE_BETA * len(tier1_disagreements)})
                if self._telemetry is not None:
                    for obs_id, subj_id, gap, threshold in tier1_disagreements:
                        for sender in (obs_id, subj_id):
                            if sender in suspects:
                                self._telemetry.emit(
                                    "trust.anomaly",
                                    sender_id=sender,
                                    category="range_inconsistency",
                                    nonce=nonce,
                                    timestamp_ns=ts,
                                    detail=(
                                        f"tier1 source-attribution: {obs_id}↔{subj_id} "
                                        f"Δ={gap:.2f}m, threshold={threshold:.2f}m, "
                                        f"suspect={sender}"
                                    ),
                                )
            elif not tier2_ran:
                # Tier 2 didn't run — fall back to symmetric blame.
                for obs_id, subj_id, gap, threshold in tier1_disagreements:
                    self.observe(obs_id, {"beta": TIER1_DISAGREE_BETA})
                    self.observe(subj_id, {"beta": TIER1_DISAGREE_BETA})
                    if self._telemetry is not None:
                        for sender in (obs_id, subj_id):
                            self._telemetry.emit(
                                "trust.anomaly",
                                sender_id=sender,
                                category="range_inconsistency",
                                nonce=nonce,
                                timestamp_ns=ts,
                                detail=(
                                    f"tier1 reciprocal: {obs_id}↔{subj_id} "
                                    f"Δ={gap:.2f}m, threshold={threshold:.2f}m"
                                ),
                            )
            # else: Tier 2 ran and identified specific outliers — already charged.

        # Cohort median range — useful for the workshop timeline visualization.
        ranges = [r for _, r, _, _ in weighted]
        median_range = sorted(ranges)[len(ranges) // 2] if ranges else None

        self._cohort_log.append(
            CohortEvent(
                subject_id=subject_id,
                timestamp_ns=ts,
                observer_count=len(claims),
                fired=True,
                tier_used=tier_used,
                median_range_m=median_range,
                embeddability_score=embeddability,
            )
        )
        _ = any_tier1_fired

    def _run_tier2(
        self,
        subject_id: str,
        ts: int,
        weighted: list[tuple[str, float, float, float]],
        nonce: int,
    ) -> tuple[float | None, set[str]]:
        """Tier 2 MDS multilateration over the cohort. Build a symmetric
        distance matrix indexed `[subject, observer_1, observer_2, ...]` and
        run eigenvalue-residual MDS. If `embeddability_score >
        MDS_EMBEDDABILITY_TAU`, charge fractional β to outlier peers
        (those whose residual share exceeds 1/N — the uniform-noise baseline).

        Returns `(score, outliers_set)`. `score` is None when the matrix is
        incomplete (insufficient cross-observer ranges in the cohort window);
        `outliers_set` is the set of peer_ids whose residual share exceeded
        the uniform-noise baseline and therefore receive β.
        """
        observer_ids = [obs_id for obs_id, _, _, _ in weighted]
        peer_ids = [subject_id] + observer_ids
        n = len(peer_ids)

        # Build symmetric distance matrix.
        D = np.zeros((n, n))
        complete = True
        for i in range(n):
            for j in range(i + 1, n):
                r_ij = self._lookup_range(peer_ids[i], peer_ids[j], ts)
                r_ji = self._lookup_range(peer_ids[j], peer_ids[i], ts)
                if r_ij is None and r_ji is None:
                    complete = False
                    break
                if r_ij is not None and r_ji is not None:
                    avg: float = (r_ij + r_ji) / 2
                elif r_ij is not None:
                    avg = r_ij
                else:
                    assert r_ji is not None
                    avg = r_ji
                D[i, j] = D[j, i] = avg
            if not complete:
                break
        if not complete:
            return None, set()

        score = mds.embeddability_score(D)
        if score <= MDS_EMBEDDABILITY_TAU:
            return score, set()

        # Geometry is non-embeddable. Identify the lying edge via the
        # reconstructed-distance residual matrix. The endpoint peers of the
        # largest-residual edge are the colluder pair (per-point eigenvalue
        # residual mass concentrates on the wrong peers for symmetric
        # colluder-pair attacks — see ADR 0015 verification).
        edge_residuals = mds.lying_edge_residuals(D)
        np.fill_diagonal(edge_residuals, 0.0)
        max_residual = float(edge_residuals.max())
        if max_residual < MDS_LYING_EDGE_M:
            return score, set()

        # Count edges above the lying-edge threshold per peer.
        high_mask = edge_residuals >= MDS_LYING_EDGE_M
        np.fill_diagonal(high_mask, False)
        edge_count_per_peer = high_mask.sum(axis=1)
        sorted_counts = np.sort(edge_count_per_peer)[::-1]
        # Count distinct violating edges (high_mask is symmetric — divide by 2).
        n_lying_edges = int(high_mask.sum() // 2)

        outliers: set[str] = set()
        # Single-source attack signature: one peer in ≥2 lying edges, ≥2× any
        # other peer (range_lie/beacon_spoof/sensor_fuzz). Blame only that peer.
        if sorted_counts[0] >= 2 and (
            len(sorted_counts) < 2 or sorted_counts[0] >= 2 * sorted_counts[1]
        ):
            top_peer = int(edge_count_per_peer.argmax())
            outliers.add(peer_ids[top_peer])
            beta_charge = min(MDS_BETA_CAP, max_residual / 2.0)
            self.observe(peer_ids[top_peer], {"beta": beta_charge})
            if self._telemetry is not None:
                self._telemetry.emit(
                    "trust.anomaly",
                    sender_id=peer_ids[top_peer],
                    category="range_inconsistency",
                    nonce=nonce,
                    timestamp_ns=ts,
                    detail=(
                        f"tier2 single-source: peer {peer_ids[top_peer]} "
                        f"violates {sorted_counts[0]} triangle edges, "
                        f"max_residual={max_residual:.3f}m, embeddability={score:.4f}"
                    ),
                )
            return score, outliers

        # Colluder-pair signature: exactly ONE lying edge with both endpoints
        # exceeding threshold. Blame both endpoints.
        if n_lying_edges == 1:
            flat_idx = int(edge_residuals.argmax())
            i_np, j_np = np.unravel_index(flat_idx, edge_residuals.shape)
            i, j = int(i_np), int(j_np)
            peer_i, peer_j = peer_ids[i], peer_ids[j]
            outliers.add(peer_i)
            outliers.add(peer_j)
            beta_charge = min(MDS_BETA_CAP, max_residual / 2.0)
            for peer_id in (peer_i, peer_j):
                self.observe(peer_id, {"beta": beta_charge})
                if self._telemetry is not None:
                    self._telemetry.emit(
                        "trust.anomaly",
                        sender_id=peer_id,
                        category="range_inconsistency",
                        nonce=nonce,
                        timestamp_ns=ts,
                        detail=(
                            f"tier2 lying-edge {peer_i}↔{peer_j} "
                            f"residual={max_residual:.3f}m, embeddability={score:.4f}"
                        ),
                    )
            return score, outliers

        # Ambiguous: multiple lying edges without a common peer.
        # Don't fire — let multi-tick evidence resolve this.
        return score, set()

    def _lookup_range(self, from_id: str, to_id: str, ts: int) -> float | None:
        """Find `r(from_id → to_id)` in the cohort at `ts`. Returns None if no
        beacon between this pair exists in the buffer."""
        cohort = self._pending.get((to_id, ts))
        if cohort is None:
            return None
        for obs_id, range_m, _ in cohort:
            if obs_id == from_id:
                return range_m
        return None

    def _find_reciprocal(
        self, observer_id: str, subject_id: str, ts: int
    ) -> tuple[float, float] | None:
        """Find subject's reciprocal range to observer in the same cohort tick.

        The reciprocal observation is keyed `(observer_id, ts)` — i.e., when
        the subject was the observer of the original observer. Returns
        `(range_m, sigma_r)` or None if no reciprocal data exists.
        """
        recip_cohort = self._pending.get((observer_id, ts))
        if recip_cohort is None:
            return None
        for r_obs, r_range, r_sigma in recip_cohort:
            if r_obs == subject_id:
                return (r_range, r_sigma)
        return None

    def _prune_old(self) -> None:
        cutoff = self._decay_clock_ns - WINDOW_NS
        if cutoff <= 0:
            return
        self._pending = {k: v for k, v in self._pending.items() if k[1] >= cutoff}
        self._voted = {k for k in self._voted if k[1] >= cutoff}
        self._judged_pairs = {p for p in self._judged_pairs if p[1] >= cutoff}


def _range_sigma(range_m: float) -> float:
    """Per-direction range-noise envelope. Range-independent in the DWM1000
    model (`specter.sim.beacons` BEACON_RANGE_SIGMA=0.10m); NLOS multipath
    contributes a small effective σ on top (2% chance of +0.5m bias).
    `range_m` parameter is reserved for a future range-dependent extension.
    """
    _ = range_m
    return math.sqrt(SIGMA_BEACON_RANGE_M ** 2 + SIGMA_NLOS_RANGE_M ** 2)


def _categorize(message: str) -> str:
    if message.startswith("bad signature"):
        return "bad_signature"
    if message.startswith("replay"):
        return "replay"
    if message.startswith("unknown sender"):
        return "unknown_sender"
    if message.startswith("unsupported version"):
        return "version_mismatch"
    if message.startswith("key_revoked_post_rotation"):
        return "key_revoked_post_rotation"
    if message.startswith("key_revoked"):
        return "key_revoked"
    if message.startswith("unattested_key"):
        return "unattested_key"
    if message.startswith("clock_skew_future"):
        return "clock_skew_future"
    if message.startswith("clock_skew_past"):
        return "clock_skew_past"
    return "unknown"
