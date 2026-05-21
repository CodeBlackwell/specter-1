"""Red-team evaluation harness.

A `Scenario` is a YAML world plus a list of scheduled `AttackEvent`s.
Attack kinds:
  swap_key         — rotate keypair without telling the roster (cryptographic)
  pose_lie         — self-report position offset by LIE_OFFSET (Byzantine)
  drift_pose       — gradually drift self-report at DRIFT_RATE per tick
  sensor_fuzz      — emit beacon observations with noisy range/bearing
  replay_storm     — re-publish a captured envelope every tick
  odometry_corrupt — inject constant omega bias into IMU before SLAM consumes
                     it; SLAM theta drifts, observations rotate around the
                     attacker, honest peers detect via geometric voting
  beacon_spoof     — apply a constant +SPOOF_OFFSET range bias to all of the
                     attacker's beacon observations; voted as outlier observer
  range_lie        — attacker inflates outgoing beacon range_m by
                     RANGE_LIE_BIAS_M. Tier 1 reciprocal disagreement fires.
                     (Wave 2 attack — ADR 0015.)
  colluder_pair    — two attackers A and B symmetrically inflate their mutual
                     A↔B range. Tier 1 reciprocal agrees (both lie equally);
                     Tier 2 MDS multilateration catches the geometry
                     inconsistency. `agent_id` field encodes the pair as "a:b".
                     (Wave 2 attack — ADR 0015.)
  heal             — clear all attack flags for the agent

`run_scenario` builds one trust evaluator and one dead-reckoning SLAM per
agent on a shared signed bus. Each tick the SLAM consumes the sim's noisy
sensor stream (lidar + IMU) and produces an estimated pose; observations are
sourced from the per-agent UWB-style beacon sensor (body-frame range/bearing,
rotated into world frame using the *observer's SLAM theta* — what a real
robot would do). Attacks compose on top of the SLAM-estimated pose, not
ground truth.

Returns metrics:

  detection_ticks[attacker]: first tick when honest viewers' median
                             reputation of that attacker dropped below
                             `detection_threshold`. None = undetected.
  false_positive_ticks[honest_id]: same metric for honest peers — should
                                   stay None for a well-behaved engine.
  final_rep[viewer][peer]: final reputation matrix.
"""

import math
import random
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from statistics import median

from specter.crypto import Keypair
from specter.messages import (
    KIND_CONTACT_REPORT,
    KIND_OBSERVATION,
    KIND_POSE,
    KIND_REPUTATION,
    ContactReport,
    Observation,
    PoseReport,
    ReputationGossip,
    decode,
    encode,
)
from specter.secure_bus import (
    Identity,
    InProcessBus,
    ReplayWindow,
    Roster,
    VerificationError,
    envelope_from_wire,
    envelope_to_wire,
    open_envelope,
)
from specter.sim.scenario import load_scenario
from specter.sim.world import Item
from specter.slam import ScanMatchSlam
from specter.telemetry import ReputationTrace
from specter.trust import BetaTrustEvaluator
from specter.types import IMUSample, Pose

LIE_OFFSET = (3.0, 3.0)
DRIFT_RATE = (0.05, 0.05)  # m/tick added to drifter's self-pose
FUZZ_RANGE_SIGMA = 5.0  # std-dev on beacon range_m under sensor_fuzz
FUZZ_BEARING_SIGMA = 1.0  # std-dev on beacon bearing_rad under sensor_fuzz (~57°)
ODOM_CORRUPT_OMEGA = 2.0  # rad/s injected into IMU under odometry_corrupt
# 2.0 rad/s is a severe hardware-fault signature; at tight peer-cluster spacing
# (~1m) this rotates the attacker's beacon-derived observations through the 0.5m
# geometric threshold within ~5 ticks, then β accumulates fast enough to drop
# rep below 0.4 within ~30 ticks. Realistic gyro bias is ~0.01 rad/s; this
# represents a worst-case sensor failure or active attack on the IMU bus.
SPOOF_OFFSET = 3.0  # m added to all of attacker's beacon ranges under beacon_spoof
REPLAY_REPETITIONS = 10  # rejected re-publishes per tick under replay_storm
RANGE_LIE_BIAS_M = 3.0  # m added to all of attacker's outgoing beacon ranges (range_lie)
COLLUDER_PAIR_BIAS_M = 3.0  # m added symmetrically to the colluder pair's mutual range
DEFAULT_DETECTION_THRESHOLD = 0.4
# Per ADR 0019, the trust-weighted COP keeps a contact only if its
# accumulated reporter reputation crosses this threshold. Matches the
# TS rail's `COP_TRUST_THRESHOLD = 0.5` (ui/packages/app/src/sim/contacts.ts).
COP_TRUST_THRESHOLD = 0.5
# Honest peers within this radius emit a ContactReport per visible item
# per tick. Matches the rail's sensor footprint for the COP layer.
DEFAULT_COP_SENSOR_RADIUS_M = 50.0


@dataclass(frozen=True)
class MapAttack:
    """A compromised reporter's map-layer adversary primitive (ADR 0019).
    `phantom_contacts` are injected every tick as if the reporter saw them
    in-place; `suppressed_item_ids` are real items the reporter refuses to
    report (blackout attack). Multiple MapAttack flavors can be active in
    one scenario as long as they target different reporters; composite
    attacks against a single reporter live in one MapAttack with both
    fields populated."""

    reporter_id: str
    phantom_contacts: tuple[Item, ...] = ()  # ground-truth shape for the lie
    suppressed_item_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class CopEntry:
    """One surviving entry in the trust-weighted Common Operating Picture.
    Position is the centroid across reporters; `weight` is the average
    reputation of distinct reporters at end-of-run."""

    contact_id: str
    kind: str
    x: float
    y: float
    weight: float
    reporters: tuple[str, ...]


@dataclass(frozen=True)
class AttackEvent:
    tick: int
    kind: str  # see module docstring
    agent_id: str
    # Optional disarm tick — when set, the runner schedules an automatic
    # rollback of this attack's state at `tick=end_tick`. Mirrors the TS
    # `Attacker.endTick` semantics: window is `[tick, end_tick)`. `swap_key`
    # cannot be auto-disarmed (the original keypair is overwritten); the
    # runner raises if end_tick is set for that kind.
    end_tick: int | None = None


@dataclass(frozen=True)
class SybilSpec:
    """A forged identity controlled by an attacker. Stationary at (x, y);
    each tick publishes a self-pose plus an observation of `target` placed
    at `target`'s lying pose (LIE_OFFSET from real). Sybils have keypairs
    and roster entries but no evaluators — they never receive envelopes."""

    id: str
    x: float
    y: float
    target: str


@dataclass(frozen=True)
class Scenario:
    name: str
    yaml_path: str
    n_ticks: int
    attacks: tuple[AttackEvent, ...] = ()
    attackers: tuple[str, ...] = ()  # ground-truth bad peers (incl. sybils)
    sybils: tuple[SybilSpec, ...] = ()
    sybil_mutual_corroboration: bool = False  # sybils publish fake observations of each other
    detection_threshold: float = DEFAULT_DETECTION_THRESHOLD
    # Per-link delivery predicate for partition scenarios. Returns True
    # if `receiver` ingests observations from `sender`; False drops them.
    # None (default) = ungated. Gossip + pose bypass per ADR 0015.
    link_predicate: Callable[[str, str], bool] | None = None
    # Map-layer Common Operating Picture (ADR 0019). Items are the
    # ground-truth reportable contacts in the world; honest peers within
    # `cop_sensor_radius_m` emit a ContactReport per item per tick.
    # MapAttacks per reporter inject phantoms or suppress real items.
    # Empty `items` = no COP machinery (zero overhead for non-map scenarios).
    items: tuple[Item, ...] = ()
    map_attacks: tuple[MapAttack, ...] = ()
    cop_sensor_radius_m: float = DEFAULT_COP_SENSOR_RADIUS_M
    # External entities with valid keypairs but NOT in the signed roster.
    # Each emits one Observation envelope per tick (sender_id = its id,
    # subject_id = the first real agent) signed by its own key. Receivers
    # raise VerificationError("unknown_sender") in `open_envelope` because
    # the roster has no key for the sender; the trust evaluator records
    # the rejection via `record_reject` without moving any reputation.
    # Matches the TS rail's `forged_envelope` semantics.
    foreign_emitters: tuple[str, ...] = ()


@dataclass
class EvaluationResult:
    scenario: Scenario
    final_rep: dict[str, dict[str, float]] = field(default_factory=dict)
    detection_ticks: dict[str, int | None] = field(default_factory=dict)
    false_positive_ticks: dict[str, int | None] = field(default_factory=dict)
    cop: dict[str, CopEntry] = field(default_factory=dict)
    contact_log: list[ContactReport] = field(default_factory=list)

    def attacker_view(self, attacker: str) -> list[float]:
        """Reputations of `attacker` from each honest viewer's perspective."""
        honest = [v for v in self.final_rep if v not in self.scenario.attackers]
        return [self.final_rep[v][attacker] for v in honest]


def run_scenario(
    scenario: Scenario,
    *,
    traces: dict[str, ReputationTrace] | None = None,
) -> EvaluationResult:
    """Run `scenario` end-to-end. When `traces` is supplied, each entry
    `traces[viewer_id]` receives `(peer_id, alpha, beta, ts_ns)` records
    every tick, capturing the per-viewer reputation trajectory used by the
    workshop's small-multiples grid (notebook 08)."""
    sim, _ = load_scenario(scenario.yaml_path)
    agent_ids = [a.id for a in sim.agents]
    attackers = set(scenario.attackers)
    honest = [aid for aid in agent_ids if aid not in attackers]

    identities = {aid: Identity(aid, Keypair.generate()) for aid in agent_ids}
    for sybil in scenario.sybils:
        identities[sybil.id] = Identity(sybil.id, Keypair.generate())
    roster = Roster()
    for ident in identities.values():
        roster.add(ident.agent_id, ident.keypair.public_bytes)

    # Foreign emitters get keypairs but never enter the roster — every
    # envelope they emit fails signature verification at the bus boundary.
    foreign_identities: dict[str, Identity] = {
        fid: Identity(fid, Keypair.generate()) for fid in scenario.foreign_emitters
    }

    bus = InProcessBus()
    evaluators = {aid: BetaTrustEvaluator(self_id=aid) for aid in agent_ids}
    replays = {aid: ReplayWindow() for aid in agent_ids}
    slam = {
        a.id: ScanMatchSlam(
            agent_id=a.id,
            init_pose=Pose(x=a.x, y=a.y, theta=a.theta, t=0.0),
            dt=sim.dt,
            init_velocity=(a.vx, a.vy),
        )
        for a in sim.agents
    }

    for self_id in agent_ids:
        bus.subscribe("pose", _make_handler(self_id, evaluators, replays, roster))
        bus.subscribe(
            "observation",
            _make_handler(self_id, evaluators, replays, roster, scenario.link_predicate),
        )
        bus.subscribe("reputation", _make_handler(self_id, evaluators, replays, roster))

    # Per ADR 0019: contact reports accumulate into a single log (the bus is
    # broadcast, so every receiver would see the same set; for COP aggregation
    # only the union matters). A single subscriber collects them all here.
    contact_log: list[ContactReport] = []
    cop_replay = ReplayWindow()
    if scenario.items or scenario.map_attacks:
        bus.subscribe(
            "contact",
            _make_contact_collector(contact_log, roster, cop_replay),
        )
    attacks_by_reporter: dict[str, MapAttack] = {a.reporter_id: a for a in scenario.map_attacks}

    attacks_by_tick: dict[int, list[AttackEvent]] = {}
    # Per-tick disarm list: (kind, agent_id). Populated up-front for any
    # AttackEvent with end_tick set; processed BEFORE that tick's arm events
    # so windowed attacks land on the same tick edge as the TS gate.
    disarms_by_tick: dict[int, list[tuple[str, str]]] = {}
    for ev in scenario.attacks:
        attacks_by_tick.setdefault(ev.tick, []).append(ev)
        if ev.end_tick is not None:
            if ev.kind == "swap_key":
                raise ValueError("end_tick is not supported for swap_key (keypair is overwritten)")
            if ev.end_tick <= ev.tick:
                raise ValueError(
                    f"AttackEvent end_tick ({ev.end_tick}) must be > tick ({ev.tick})"
                )
            disarms_by_tick.setdefault(ev.end_tick, []).append((ev.kind, ev.agent_id))

    liars: set[str] = set()
    drifters: dict[str, int] = {}  # agent_id → tick at which drift started
    fuzzers: set[str] = set()
    replayers: set[str] = set()
    range_liars: set[str] = set()  # add RANGE_LIE_BIAS_M to all outgoing ranges
    # frozenset({a, b}) → bias_m; both peers inflate their A↔B range symmetrically
    colluder_pairs: dict[frozenset[str], float] = {}
    odom_corrupted: set[str] = set()
    spoofers: set[str] = set()
    replay_seed: dict[str, bytes] = {}
    rng = random.Random(0)
    detection_ticks: dict[str, int | None] = {a: None for a in attackers}
    false_positive_ticks: dict[str, int | None] = {h: None for h in honest}

    def _disarm(kind: str, agent_id: str) -> None:
        if kind == "pose_lie":
            liars.discard(agent_id)
        elif kind == "drift_pose":
            drifters.pop(agent_id, None)
        elif kind == "sensor_fuzz":
            fuzzers.discard(agent_id)
        elif kind == "replay_storm":
            replayers.discard(agent_id)
        elif kind == "odometry_corrupt":
            odom_corrupted.discard(agent_id)
        elif kind == "beacon_spoof":
            spoofers.discard(agent_id)
        elif kind == "range_lie":
            range_liars.discard(agent_id)
        elif kind == "colluder_pair":
            a, b = agent_id.split(":")
            colluder_pairs.pop(frozenset({a, b}), None)
        else:
            raise ValueError(f"cannot auto-disarm attack kind {kind!r}")

    for tick in range(1, scenario.n_ticks + 1):
        # Process scheduled disarms FIRST so windowed attacks see [start, end).
        for kind, agent_id in disarms_by_tick.get(tick, ()):
            _disarm(kind, agent_id)
        for ev in attacks_by_tick.get(tick, ()):
            if ev.kind == "swap_key":
                identities[ev.agent_id].keypair = Keypair.generate()
            elif ev.kind == "pose_lie":
                liars.add(ev.agent_id)
            elif ev.kind == "drift_pose":
                drifters[ev.agent_id] = tick
            elif ev.kind == "sensor_fuzz":
                fuzzers.add(ev.agent_id)
            elif ev.kind == "replay_storm":
                replayers.add(ev.agent_id)
            elif ev.kind == "odometry_corrupt":
                odom_corrupted.add(ev.agent_id)
            elif ev.kind == "beacon_spoof":
                spoofers.add(ev.agent_id)
            elif ev.kind == "range_lie":
                range_liars.add(ev.agent_id)
            elif ev.kind == "colluder_pair":
                # agent_id encodes the pair as "a:b" (e.g. "alpha:bravo")
                a, b = ev.agent_id.split(":")
                colluder_pairs[frozenset({a, b})] = COLLUDER_PAIR_BIAS_M
            elif ev.kind == "heal":
                liars.discard(ev.agent_id)
                drifters.pop(ev.agent_id, None)
                fuzzers.discard(ev.agent_id)
                replayers.discard(ev.agent_id)
                odom_corrupted.discard(ev.agent_id)
                spoofers.discard(ev.agent_id)
                range_liars.discard(ev.agent_id)
                # Heal a colluder pair: remove any pair involving this peer.
                for key in [k for k in colluder_pairs if ev.agent_id in k]:
                    colluder_pairs.pop(key)
            else:
                raise ValueError(f"unknown attack kind {ev.kind!r}")

        sim_tick = sim.tick()
        ts = int(sim.t * 1e9)

        for a in sim_tick.agents:
            imu = sim_tick.imu[a.id]
            if a.id in odom_corrupted:
                imu = IMUSample(
                    ax=imu.ax, ay=imu.ay, omega=imu.omega + ODOM_CORRUPT_OMEGA, t=imu.t
                )
            slam[a.id].update(list(sim_tick.scans[a.id]), imu)

        for a in sim_tick.agents:
            ident = identities[a.id]
            slam_pose = slam[a.id].pose()
            x, y, theta = slam_pose.x, slam_pose.y, slam_pose.theta
            if a.id in liars:
                x, y = x + LIE_OFFSET[0], y + LIE_OFFSET[1]
            if a.id in drifters:
                elapsed = tick - drifters[a.id]
                x += DRIFT_RATE[0] * elapsed
                y += DRIFT_RATE[1] * elapsed
            pose = PoseReport(a.id, x, y, theta, ts)
            env = ident.seal(KIND_POSE, encode(pose), timestamp_ns=ts)
            wire = envelope_to_wire(env)
            bus.publish("pose", wire)
            replay_seed.setdefault(a.id, wire)  # capture first envelope for replay storms

        for a in sim_tick.agents:
            ident = identities[a.id]
            for beacon in sim_tick.beacons[a.id]:
                range_m = beacon.range_m
                bearing_rad = beacon.bearing_rad
                if a.id in fuzzers:
                    range_m += rng.gauss(0, FUZZ_RANGE_SIGMA)
                    bearing_rad += rng.gauss(0, FUZZ_BEARING_SIGMA)
                if a.id in spoofers:
                    range_m += SPOOF_OFFSET
                if a.id in range_liars:
                    # range_lie attack: inflate the outgoing range scalar so the
                    # reciprocal disagrees by Tier-1-detectable margin.
                    range_m += RANGE_LIE_BIAS_M
                # colluder_pair: A and B both inflate the A↔B range symmetrically
                # by COLLUDER_PAIR_BIAS_M. Tier 1 reciprocal still agrees
                # (both lie by the same amount); Tier 2 MDS detects the
                # multilateration inconsistency against honest peers' geometry.
                pair_key = frozenset({a.id, beacon.subject_id})
                if pair_key in colluder_pairs:
                    range_m += colluder_pairs[pair_key]
                obs = Observation(a.id, beacon.subject_id, range_m, bearing_rad, ts)
                env = ident.seal(KIND_OBSERVATION, encode(obs), timestamp_ns=ts)
                bus.publish("observation", envelope_to_wire(env))

        for attacker_id in replayers:
            wire = replay_seed.get(attacker_id)
            if wire is None:
                continue
            for _ in range(REPLAY_REPETITIONS):
                bus.publish("pose", wire)

        for sybil in scenario.sybils:
            target_pose = slam.get(sybil.target)
            if target_pose is None:
                continue
            target_slam = target_pose.pose()
            sybil_ident = identities[sybil.id]
            pose = PoseReport(sybil.id, sybil.x, sybil.y, 0.0, ts)
            env = sybil_ident.seal(KIND_POSE, encode(pose), timestamp_ns=ts)
            bus.publish("pose", envelope_to_wire(env))
            target_lying_x = target_slam.x + LIE_OFFSET[0]
            target_lying_y = target_slam.y + LIE_OFFSET[1]
            dx = target_lying_x - sybil.x
            dy = target_lying_y - sybil.y
            obs = Observation(
                sybil.id, sybil.target,
                math.hypot(dx, dy), math.atan2(dy, dx), ts,
            )
            env = sybil_ident.seal(KIND_OBSERVATION, encode(obs), timestamp_ns=ts)
            bus.publish("observation", envelope_to_wire(env))
            if scenario.sybil_mutual_corroboration:
                # Each sybil publishes fake beacon observations of every other
                # sybil at their claimed cabal-internal positions. V2
                # self-anchored beacon defense filters this out — honest peers
                # never beacon a sybil with their own sensor, so cabal-internal
                # corroboration carries zero weight in their cohorts.
                for peer in scenario.sybils:
                    if peer.id == sybil.id:
                        continue
                    pdx = peer.x - sybil.x
                    pdy = peer.y - sybil.y
                    rel_obs = Observation(
                        sybil.id, peer.id,
                        math.hypot(pdx, pdy), math.atan2(pdy, pdx), ts,
                    )
                    env = sybil_ident.seal(KIND_OBSERVATION, encode(rel_obs), timestamp_ns=ts)
                    bus.publish("observation", envelope_to_wire(env))

        for a in sim_tick.agents:
            snapshot = evaluators[a.id].gossip_snapshot()
            if not snapshot:
                continue
            gossip = ReputationGossip(a.id, snapshot, ts)
            env = identities[a.id].seal(KIND_REPUTATION, encode(gossip), timestamp_ns=ts)
            bus.publish("reputation", envelope_to_wire(env))

        # Foreign emitters publish Observation envelopes that fail
        # roster lookup → VerificationError("unknown_sender") at every
        # receiver. The wire layer drops the envelope before the trust
        # evaluator sees its payload. Matches rail L01's `forged_envelope`.
        if foreign_identities and agent_ids:
            target_id = agent_ids[0]
            for fid, fident in foreign_identities.items():
                fake_obs = Observation(
                    observer_id=fid,
                    subject_id=target_id,
                    range_m=10.0,
                    bearing_rad=0.0,
                    timestamp_ns=ts,
                )
                env = fident.seal(KIND_OBSERVATION, encode(fake_obs), timestamp_ns=ts)
                bus.publish("observation", envelope_to_wire(env))

        # Per ADR 0019: per-tick contact emission. Honest peers within
        # sensor radius report each visible item; MapAttack rewrites the
        # honest set per reporter (drops `suppressed_item_ids`, appends
        # `phantom_contacts`). Zero overhead when neither items nor
        # map_attacks are configured.
        if scenario.items or scenario.map_attacks:
            for a in sim_tick.agents:
                ident = identities[a.id]
                attack = attacks_by_reporter.get(a.id)
                suppressed = set(attack.suppressed_item_ids) if attack else set()
                # Honest reporting: items in sensor radius, not suppressed.
                for item in scenario.items:
                    if item.id in suppressed:
                        continue
                    dx, dy = item.x - a.x, item.y - a.y
                    if math.hypot(dx, dy) > scenario.cop_sensor_radius_m:
                        continue
                    cr = ContactReport(a.id, item.id, item.kind, item.x, item.y, ts)
                    env = ident.seal(KIND_CONTACT_REPORT, encode(cr), timestamp_ns=ts)
                    bus.publish("contact", envelope_to_wire(env))
                # Phantom injection: emitted regardless of geometry.
                if attack:
                    for phantom in attack.phantom_contacts:
                        cr = ContactReport(
                            a.id, phantom.id, phantom.kind, phantom.x, phantom.y, ts,
                        )
                        env = ident.seal(KIND_CONTACT_REPORT, encode(cr), timestamp_ns=ts)
                        bus.publish("contact", envelope_to_wire(env))

        if traces is not None:
            for viewer_id in agent_ids:
                trace = traces.get(viewer_id)
                if trace is None:
                    continue
                snap = evaluators[viewer_id].gossip_snapshot()
                for peer_id, ab in snap.items():
                    trace.record(peer_id, ab[0], ab[1], ts)

        thr = scenario.detection_threshold
        for attacker in attackers:
            if detection_ticks[attacker] is not None:
                continue
            if _honest_median(evaluators, honest, attacker) < thr:
                detection_ticks[attacker] = tick
        for h in honest:
            if false_positive_ticks[h] is not None:
                continue
            if _honest_median(evaluators, [v for v in honest if v != h], h) < thr:
                false_positive_ticks[h] = tick

    for evaluator in evaluators.values():
        evaluator.flush()

    all_peers = agent_ids + [s.id for s in scenario.sybils]
    final_rep = {
        viewer: {peer: evaluators[viewer].reputation(peer) for peer in all_peers}
        for viewer in agent_ids
    }
    # Average reputation across honest viewers — the operator's effective
    # weight per reporter, used to filter the COP per ADR 0019.
    avg_rep_by_peer: dict[str, float] = {}
    if honest:
        for peer in all_peers:
            views = [evaluators[v].reputation(peer) for v in honest]
            avg_rep_by_peer[peer] = sum(views) / len(views)
    cop = build_cop(contact_log, avg_rep_by_peer)
    return EvaluationResult(
        scenario=scenario,
        final_rep=final_rep,
        detection_ticks=detection_ticks,
        false_positive_ticks=false_positive_ticks,
        cop=cop,
        contact_log=contact_log,
    )


def _make_contact_collector(
    contact_log: list[ContactReport],
    roster: Roster,
    replay: ReplayWindow,
):
    """Single-subscriber contact collector for the eval runner's broadcast
    bus. Verifies each envelope, parses the ContactReport payload, appends
    to the shared log. Per ADR 0019 the COP is aggregated end-of-run from
    this log, so we don't maintain per-receiver views — only the union of
    accepted contacts matters."""

    def on_envelope(wire: bytes) -> None:
        env = envelope_from_wire(wire)
        try:
            payload = open_envelope(env, roster, replay)
            cr = decode(env.kind, payload)
            contact_log.append(cr)
        except VerificationError:
            pass  # rejection counts as drop; COP aggregation ignores it

    return on_envelope


def build_cop(
    contact_log: list[ContactReport],
    reputations: dict[str, float],
    threshold: float = COP_TRUST_THRESHOLD,
) -> dict[str, CopEntry]:
    """Trust-weighted Common Operating Picture aggregation (ADR 0019).
    Group contact reports by `contact_id`, average reporter reputations
    across the *distinct* set of reporters, keep entries where the
    average reputation ≥ threshold. Position is the mean across all
    reports of that contact_id (rejects geometric jitter).

    Conceptually mirrors the TS rail's `copView()` in
    `ui/packages/app/src/sim/contacts.ts`; different storage layer but
    identical filter logic."""
    if not contact_log:
        return {}
    by_contact: dict[str, list[ContactReport]] = {}
    for cr in contact_log:
        by_contact.setdefault(cr.contact_id, []).append(cr)
    cop: dict[str, CopEntry] = {}
    for cid, reports in by_contact.items():
        reporter_ids = sorted({r.reporter_id for r in reports})
        weights = [reputations.get(rid, 0.5) for rid in reporter_ids]
        avg_weight = sum(weights) / len(weights) if weights else 0.0
        if avg_weight < threshold:
            continue
        cop[cid] = CopEntry(
            contact_id=cid,
            kind=reports[0].kind,
            x=sum(r.x for r in reports) / len(reports),
            y=sum(r.y for r in reports) / len(reports),
            weight=avg_weight,
            reporters=tuple(reporter_ids),
        )
    return cop


def _make_handler(
    self_id: str,
    evaluators: dict[str, BetaTrustEvaluator],
    replays: dict[str, ReplayWindow],
    roster: Roster,
    link_predicate: Callable[[str, str], bool] | None = None,
):
    """Build the per-agent envelope receiver.

    `link_predicate(sender_id, receiver_id) -> bool` gates whether the
    receiver ingests **observations** from this sender. None = ungated
    (default behavior). Pose reports and gossip rounds intentionally
    bypass the predicate — gossip is modeled as eventually-consistent
    multi-hop, and pose-layer claims are out of the trust path per
    ADR 0015. Matches the TS rail's `ScenarioSpec.linkPredicate`
    semantics for partition scenarios.
    """
    evaluator = evaluators[self_id]
    replay = replays[self_id]

    def on_envelope(wire: bytes) -> None:
        env = envelope_from_wire(wire)
        try:
            payload = open_envelope(env, roster, replay)
            if (
                link_predicate is not None
                and env.kind == KIND_OBSERVATION
                and not link_predicate(env.sender_id, self_id)
            ):
                return
            evaluator.record_accept(env)
            if env.kind == KIND_POSE:
                evaluator.record_pose_report(env, decode(env.kind, payload))
            elif env.kind == KIND_OBSERVATION:
                evaluator.record_observation(env, decode(env.kind, payload))
            elif env.kind == KIND_REPUTATION:
                evaluator.record_gossip(env, decode(env.kind, payload))
        except VerificationError as e:
            evaluator.record_reject(env, e)

    return on_envelope


def _honest_median(
    evaluators: dict[str, BetaTrustEvaluator], viewers: Iterable[str], peer: str
) -> float:
    scores = [evaluators[v].reputation(peer) for v in viewers]
    if not scores:
        return 0.5
    return median(scores)
