"""Pre-built attack scenarios for the eval harness.

Each scenario uses scenarios/four_corners.yaml — 4 agents in a tight
cluster so observations fire immediately, keeping detection latency
tests bounded to short runs.
"""

from specter.sim.world import Item

from .runner import AttackEvent, MapAttack, Scenario, SybilSpec

# Ground-truth items used by the COP map-layer scenarios (ADR 0019).
# Placed inside four_corners.yaml's tight peer cluster so all honest
# peers fall within DEFAULT_COP_SENSOR_RADIUS_M.
UXO_BRAVO = Item("uxo-bravo", "uxo", 0.0, 0.0)
FOB_STALWART = Item("fob-stalwart", "fob", 1.0, 1.0)
PHANTOM_UXO_GAMMA = Item("phantom-uxo-1", "uxo", -1.0, -1.0)
PHANTOM_HOSTILE_FOB = Item("phantom-fob-1", "fob", 2.0, 2.0)

YAML = "scenarios/four_corners.yaml"
YAML_SIX = "scenarios/six_corners.yaml"


def honest_swarm() -> Scenario:
    return Scenario(name="honest_swarm", yaml_path=YAML, n_ticks=80)


def single_pose_liar(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    return Scenario(
        name="single_pose_liar",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(attack_tick, "pose_lie", attacker),),
        attackers=(attacker,),
    )


def single_bad_key(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    return Scenario(
        name="single_bad_key",
        yaml_path=YAML,
        n_ticks=40,
        attacks=(AttackEvent(attack_tick, "swap_key", attacker),),
        attackers=(attacker,),
    )


def colluding_pair_pose_liars() -> Scenario:
    """4 honest + 2 colluders: honest majority can outvote the cabal."""
    return Scenario(
        name="colluding_pair_pose_liars",
        yaml_path=YAML_SIX,
        n_ticks=120,
        attacks=(
            AttackEvent(1, "pose_lie", "alpha"),
            AttackEvent(1, "pose_lie", "bravo"),
        ),
        attackers=("alpha", "bravo"),
    )


def sleeper_pose_liar(attacker: str = "alpha", wake_tick: int = 60) -> Scenario:
    return Scenario(
        name="sleeper_pose_liar",
        yaml_path=YAML,
        n_ticks=wake_tick + 80,
        attacks=(AttackEvent(wake_tick, "pose_lie", attacker),),
        attackers=(attacker,),
    )


def liar_then_heals(attacker: str = "alpha") -> Scenario:
    """False-positive recovery on the range layer. Attacker lies (inflates
    outgoing range_m by RANGE_LIE_BIAS_M) for 20 ticks (t=30..50), then
    heals (stops lying). Reputation drops on the lie, then climbs back
    toward the prior as Beta evidence decays with the 10s half-life and
    new honest observations re-accumulate α.

    Pre-ADR-0015 this scenario used pose_lie, which the trust layer
    classifies as a no-op — meaning rep never moved, and the recovery
    test trivially passed. Wave 2 of ADR 0015's promotion swaps to
    range_lie so the dip-then-recover trajectory is actually exercised.

    Matches rail Lesson 02 (`recovery_after_lie`) — same lie window
    (20 ticks), same recovery mechanism (Beta decay), two surfaces.
    """
    return Scenario(
        name="liar_then_heals",
        yaml_path=YAML,
        n_ticks=300,
        attacks=(
            AttackEvent(30, "range_lie", attacker),
            AttackEvent(50, "heal", attacker),
        ),
        attackers=(attacker,),
    )


def replay_storm(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Attacker re-publishes a captured envelope every tick. Replay window
    rejects each → β piles up, attacker's reputation collapses."""
    return Scenario(
        name="replay_storm",
        yaml_path=YAML,
        n_ticks=40,
        attacks=(AttackEvent(attack_tick, "replay_storm", attacker),),
        attackers=(attacker,),
    )


def sensor_fuzz(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Attacker emits observations with gaussian noise — voted as outlier."""
    return Scenario(
        name="sensor_fuzz",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(attack_tick, "sensor_fuzz", attacker),),
        attackers=(attacker,),
    )


def gradient_drift(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Attacker's self-pose drifts slowly. Crosses geometric threshold
    around tick 7-10, then accumulates β as the lie grows."""
    return Scenario(
        name="gradient_drift",
        yaml_path=YAML,
        n_ticks=120,
        attacks=(AttackEvent(attack_tick, "drift_pose", attacker),),
        attackers=(attacker,),
    )


def odometry_corrupt(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Attacker's IMU is corrupted with a constant omega bias. The attacker's
    SLAM honestly integrates the bad gyro, theta drifts, observations rotate
    around the attacker. Honest peers detect via geometric voting."""
    return Scenario(
        name="odometry_corrupt",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(attack_tick, "odometry_corrupt", attacker),),
        attackers=(attacker,),
    )


def beacon_spoof(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Attacker adds a constant range bias to all of its beacon observations.
    Voted as outlier observer; reputation collapses."""
    return Scenario(
        name="beacon_spoof",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(attack_tick, "beacon_spoof", attacker),),
        attackers=(attacker,),
    )


def range_lie(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """ADR 0015 Wave 2 attack. Attacker inflates all outgoing beacon
    `range_m` by `RANGE_LIE_BIAS_M`. The reciprocal from the subject's side
    is honest, so Tier 1 reciprocal-range disagreement fires on every
    pair where the attacker is involved."""
    return Scenario(
        name="range_lie",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(attack_tick, "range_lie", attacker),),
        attackers=(attacker,),
    )


def forged_envelope(intruder: str = "x0") -> Scenario:
    """External adversary `intruder` (not in the signed roster) attempts to
    inject Observation envelopes every tick. Each envelope is signed by a
    real keypair but the receiver's roster has no public key for the sender,
    so `open_envelope` raises VerificationError("unknown_sender") and the
    bus-level handler calls `record_reject` without ever reaching the trust
    evaluator's cohort math. Real agents' reputations stay near the uniform
    prior — the wire layer is the only attack surface for adversaries who
    never joined the swarm, and it's signed.

    Pairs with rail Lesson 01 (`forged_envelope`). ADR 0019 Wave 1 of the
    Coverage Parity PRD closes the last notebook-side gap on this defense.
    """
    return Scenario(
        name="forged_envelope",
        yaml_path=YAML,
        n_ticks=80,
        foreign_emitters=(intruder,),
    )


def cop_phantom(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Compromised drone plants a phantom UXO inside the AO while lying on
    inter-drone range. The trust-weighted COP keeps the phantom while the
    attacker's reputation is high; once Tier 1 reciprocal disagreement
    collapses the attacker's rep below `COP_TRUST_THRESHOLD = 0.5`, the
    COP filter drops the phantom.

    Single-reporter phantom — no honest peer ever reports `phantom-uxo-1`,
    so the COP entry's only weight comes from the attacker. Pairs with
    rail Lesson 08 component scenario `cop_phantom`. ADR 0019.
    """
    return Scenario(
        name="cop_phantom",
        yaml_path=YAML,
        n_ticks=80,
        items=(UXO_BRAVO,),
        attacks=(AttackEvent(attack_tick, "range_lie", attacker),),
        attackers=(attacker,),
        map_attacks=(
            MapAttack(reporter_id=attacker, phantom_contacts=(PHANTOM_UXO_GAMMA,)),
        ),
    )


def cop_suppress(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Compromised drone hides a real UXO from its contact reports
    (blackout attack) while lying on inter-drone range. The remaining
    honest peers within sensor radius still report UXO-β, so the COP
    surfaces it via redundancy — the attacker's blackout fails as long as
    at least one trusted peer can independently observe the contact.

    Pairs with rail Lesson 08 component scenario `cop_suppress`. ADR 0019.
    """
    return Scenario(
        name="cop_suppress",
        yaml_path=YAML,
        n_ticks=80,
        items=(UXO_BRAVO,),
        attacks=(AttackEvent(attack_tick, "range_lie", attacker),),
        attackers=(attacker,),
        map_attacks=(
            MapAttack(reporter_id=attacker, suppressed_item_ids=(UXO_BRAVO.id,)),
        ),
    )


def cop_fob_corrupt(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Compromised drone attempts to corrupt the swarm's spatial anchor:
    hides the real friendly FOB STALWART while broadcasting a phantom
    HOSTILE FOB CLAIM. Once Tier 1 reciprocal disagreement collapses
    rep below `COP_TRUST_THRESHOLD`, the COP filter drops the phantom
    and the real FOB stays surfaced via honest peers.

    Pairs with rail Lesson 08 component scenario `cop_fob_corrupt`. ADR 0019.
    """
    return Scenario(
        name="cop_fob_corrupt",
        yaml_path=YAML,
        n_ticks=80,
        items=(FOB_STALWART,),
        attacks=(AttackEvent(attack_tick, "range_lie", attacker),),
        attackers=(attacker,),
        map_attacks=(
            MapAttack(
                reporter_id=attacker,
                phantom_contacts=(PHANTOM_HOSTILE_FOB,),
                suppressed_item_ids=(FOB_STALWART.id,),
            ),
        ),
    )


def cop_corruption_full(attacker: str = "alpha", attack_tick: int = 1) -> Scenario:
    """Composite map-layer attack: phantom UXO + phantom HOSTILE FOB +
    suppress real UXO-β + suppress real FOB STALWART, all under one
    `range_lie` wrapper. Three flavors of corruption simultaneously
    defeated by the same trust-weighted COP filter.

    Mirrors the TS rail's `cop_corruption_full` composite for L08.
    ADR 0019.
    """
    return Scenario(
        name="cop_corruption_full",
        yaml_path=YAML,
        n_ticks=80,
        items=(UXO_BRAVO, FOB_STALWART),
        attacks=(AttackEvent(attack_tick, "range_lie", attacker),),
        attackers=(attacker,),
        map_attacks=(
            MapAttack(
                reporter_id=attacker,
                phantom_contacts=(PHANTOM_UXO_GAMMA, PHANTOM_HOSTILE_FOB),
                suppressed_item_ids=(UXO_BRAVO.id, FOB_STALWART.id),
            ),
        ),
    )


def partition_gossip(
    attacker: str = "alpha",
    attack_tick: int = 10,
) -> Scenario:
    """Network partition + gossip-bridged reconciliation. The swarm splits
    into two cliques surveying separate halves of the AO: {alpha, bravo}
    and {charlie, delta}. Cross-clique *observations* are dropped (per the
    runner's `link_predicate`), so alpha's lie is directly visible only to
    bravo. The other clique (charlie, delta) sees no observations from or
    about alpha, so their per-peer cohorts never accrue β from direct
    evidence. Reputation gossip continues across cliques (gossip bypasses
    the predicate per ADR 0015 — modeled as eventually-consistent
    multi-hop), so bravo's accumulated β about alpha propagates to the
    other clique discounted by `GOSSIP_DISCOUNT = 0.1`.

    Lesson: direct observation catches the lie inside a clique within a
    few ticks; gossip carries the same finding across the partition more
    slowly (discount-bounded). Both halves converge — there is no central
    authority.

    Pairs with rail Lesson 06 ("When the swarm splits"). Notebook 04
    derives the gossip math; this scenario lets notebook 08's battery
    show the divergence-then-convergence trajectory.
    """
    clique_a = frozenset({attacker, "bravo"})

    def same_clique(observer: str, receiver: str) -> bool:
        return (observer in clique_a) == (receiver in clique_a)

    return Scenario(
        name="partition_gossip",
        yaml_path=YAML,
        n_ticks=300,
        attacks=(AttackEvent(attack_tick, "range_lie", attacker),),
        attackers=(attacker,),
        link_predicate=same_clique,
    )


def late_range_lie(attacker: str = "alpha", wake_tick: int = 60) -> Scenario:
    """Mid-mission Byzantine flip on the range layer. Attacker flies
    honestly through `wake_tick`, then begins inflating every outgoing
    beacon `range_m` by `RANGE_LIE_BIAS_M`. Detection eventually fires,
    but latency scales monotonically with accrued honest history — high
    α at wake_tick means β has to overcome a deeper prior before the
    reputation crosses the detection threshold.

    Measured (n_ticks=500, threshold=0.4): wake_tick=5 → detect+49,
    wake_tick=20 → detect+175, wake_tick=60 → detect+353. Operational
    implication: a drone that flies honestly for an hour buys ~30 s of
    grace ticks when it flips, bounded by the decay half-life pulling
    accrued α back toward the uniform prior.

    Pairs with rail Lesson 05 ("The sleeper agent"). Existing
    `sleeper_pose_liar` covers the pose-layer analogue (declared
    trust-noop per ADR 0015); this scenario closes the range-layer gap.
    """
    return Scenario(
        name="late_range_lie",
        yaml_path=YAML,
        n_ticks=500,
        attacks=(AttackEvent(wake_tick, "range_lie", attacker),),
        attackers=(attacker,),
    )


def colluder_pair(
    a: str = "alpha", b: str = "bravo", attack_tick: int = 1,
) -> Scenario:
    """ADR 0015 Wave 2 attack. Two colluders symmetrically inflate their
    mutual A↔B beacon range. Tier 1 reciprocal sees the symmetric lie as
    agreement and passes; Tier 2 MDS multilateration over honest peers'
    geometry detects the non-2D-embeddability of the joint range matrix.

    Uses `six_corners.yaml` (N=6) — at N=4 the MDS residual mass spreads
    too evenly to localize the lying edge; N≥5 gives the geometric
    redundancy needed for reliable edge-residual blame attribution
    (verified empirically at N=8..20, 9/9 trials)."""
    return Scenario(
        name="colluder_pair",
        yaml_path=YAML_SIX,
        n_ticks=80,
        attacks=(AttackEvent(attack_tick, "colluder_pair", f"{a}:{b}"),),
        attackers=(a, b),
    )


def sybil_flood(attacker: str = "alpha", n_sybils: int = 4) -> Scenario:
    """Attacker pose-lies; N forged identities corroborate the lie. With no
    Sybil-resistant identity layer, the cabal (alpha + sybils) is a structural
    majority — engine cannot reliably distinguish honest from rigged consensus."""
    sybils = tuple(
        SybilSpec(id=f"sybil_{i}", x=6.0 + 0.1 * i, y=6.0 + 0.1 * i, target=attacker)
        for i in range(n_sybils)
    )
    return Scenario(
        name="sybil_flood",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(1, "pose_lie", attacker),),
        attackers=(attacker, *(s.id for s in sybils)),
        sybils=sybils,
    )


def sybil_flood_mutual(attacker: str = "alpha", n_sybils: int = 4) -> Scenario:
    """Upgraded sybil_flood: each sybil also publishes fake beacon Observations
    of every other sybil. This grants reciprocal presence credit within the
    cabal — the V1 beacon-presence rule (which only checked existence of any
    grantor) cannot distinguish this from legitimate mutual beacon-ranging.
    """
    sybils = tuple(
        SybilSpec(id=f"sybil_{i}", x=6.0 + 0.1 * i, y=6.0 + 0.1 * i, target=attacker)
        for i in range(n_sybils)
    )
    return Scenario(
        name="sybil_flood_mutual",
        yaml_path=YAML,
        n_ticks=80,
        attacks=(AttackEvent(1, "pose_lie", attacker),),
        attackers=(attacker, *(s.id for s in sybils)),
        sybils=sybils,
        sybil_mutual_corroboration=True,
    )


def liar_with_end_tick(attacker: str = "alpha") -> Scenario:
    """range_lie windowed via end_tick — same trajectory as `liar_then_heals`
    but expressed declaratively (Wave 1 API). The runner auto-schedules the
    disarm at end_tick, so omitting the explicit `heal` event yields the
    same recovery curve.
    """
    return Scenario(
        name="liar_with_end_tick",
        yaml_path=YAML,
        n_ticks=300,
        attacks=(AttackEvent(30, "range_lie", attacker, end_tick=50),),
        attackers=(attacker,),
    )


def dual_windowed_attacks(a: str = "alpha", b: str = "bravo") -> Scenario:
    """Two attackers with non-overlapping windows on the same run. Validates
    that per-attacker end_tick scheduling composes correctly when multiple
    attackers come and go independently.

    Window A (sensor_fuzz on `a`): ticks 1–30 — fuzz detects within ~10 ticks
    Window B (sensor_fuzz on `b`): ticks 80–110 — clearly after A's window

    Both should be detected within their windows; the run continues to
    n_ticks=300 so both have time to recover after their windows close
    (β decays under honest behavior post-disarm).
    """
    return Scenario(
        name="dual_windowed_attacks",
        yaml_path=YAML,
        n_ticks=300,
        attacks=(
            AttackEvent(1, "sensor_fuzz", a, end_tick=30),
            AttackEvent(80, "sensor_fuzz", b, end_tick=110),
        ),
        attackers=(a, b),
    )
