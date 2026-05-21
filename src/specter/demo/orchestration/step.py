"""Single-tick advance + per-topic publishers + cooperative-SLAM merge."""

from __future__ import annotations

from specter.messages import (
    KIND_FRAGMENT,
    KIND_OBSERVATION,
    KIND_POSE,
    KIND_REPUTATION,
    Observation,
    PoseReport,
    ReputationGossip,
    encode,
)
from specter.secure_bus import envelope_to_wire
from specter.sim.runner import Tick
from specter.slam import detect_loop_closure, encode_fragment

from .attacks import apply_attack
from .state import (
    LIE_OFFSET,
    LOOP_CLOSURE_FLASH_FRAMES,
    MERGE_INTERVAL_TICKS,
    SYBIL_LIE_RADIUS_M,
    SwarmState,
)

# ── Tour script: (tick_offset, narration, attack_kind|None, target|None) ──
# Plays out canonical attacks one at a time with per-step narration. Drives
# the demo's G key; observers see cause-and-effect without keystroke fatigue.
TOUR_SCRIPT: list[tuple[int, str, str | None, str | None]] = [
    (0,    "TOUR — honest swarm running. Every envelope signs and is accepted.", None, None),
    (90,   "X — swap alpha's keypair. Every emit now fails bad_signature.", "swap_key", None),
    (240,  "L — bravo pose-lies (claim drifts +3,+3m). Trust-layer no-op under range-only voting; merger flags fragment.", "pose_lie", None),
    (390,  "R — revoke charlie's pubkey. Envelopes rejected key_revoked.", "revoke", None),
    (540,  "T — rotate delta's key. Old envelopes → key_revoked_post_rotation.", "rotate", None),
    (690,  "Y — mint a sybil corroborating bravo. Beta-trust holds the line.", "sybil", None),
    (810,  "A — require attestation. Sybil flips to unattested_key.", "toggle_attestation", None),
    (930,  "K — toggle +6s clock skew. clock_skew_future fires.", "skew", None),
    (1080, "TOUR COMPLETE. Press G to restart. V cycles each viewer's private opinion.", None, None),
]
TOUR_TOAST_TICKS = 240  # ~4–5s @ 50fps


def step(state: SwarmState, *, emit_lidar: bool = True, emit_gossip: bool = True) -> Tick:
    """Advance one sim tick: physics + SLAM update + (lidar publishes) +
    (gossip publishes) + cooperative-SLAM merge for the viewer.

    The emit flags drive cadence-mode dispatch (IMU 200 Hz every tick;
    lidar/pose/obs/fragment 10 Hz on lidar ticks; gossip 1 Hz on gossip
    ticks). Sync mode passes True for both.
    """
    state.last_tick = state.sim.tick()
    state.tick_count += 1
    ts = int(state.sim.t * 1e9)
    last_tick = state.last_tick

    for a in last_tick.agents:
        scans = list(last_tick.scans[a.id]) if emit_lidar else []
        state.slam[a.id].update(scans, last_tick.imu[a.id])

    if emit_lidar:
        _publish_pose(state, ts)
        _publish_observations(state, ts)
        _publish_sybils(state, ts)
        _publish_fragments(state, ts)

    if emit_gossip:
        _publish_gossip(state, ts)
        _record_rep_traces(state, ts)

    if state.tick_count % MERGE_INTERVAL_TICKS == 0:
        merged_bytes, occ_votes, _free_votes = state.mergers[state.viewer_id].merge_with_votes(
            list(state.fragment_buffers[state.viewer_id])
        )
        state.merged_grids[state.viewer_id] = merged_bytes
        state.merged_votes_for_viewer = occ_votes
        state.last_merge_tick = state.tick_count
        viewer_pose = state.slam[state.viewer_id].pose()
        viewer_scans = list(last_tick.scans[state.viewer_id])
        if merged_bytes and detect_loop_closure(viewer_scans, viewer_pose, merged_bytes):
            state.loop_closure_flash[state.viewer_id] = LOOP_CLOSURE_FLASH_FRAMES

    _tick_tour(state)

    return last_tick


def start_tour(state: SwarmState) -> None:
    """Begin the scripted tour at the current tick — restartable at any time."""
    state.tour_active = True
    state.tour_start_tick = state.tick_count
    state.tour_step_idx = 0
    state.tour_toast = ""
    state.tour_toast_until_tick = 0


def _tick_tour(state: SwarmState) -> None:
    if not state.tour_active:
        return
    rel = state.tick_count - state.tour_start_tick
    while state.tour_step_idx < len(TOUR_SCRIPT):
        step_tick, narration, kind, target = TOUR_SCRIPT[state.tour_step_idx]
        if rel < step_tick:
            break
        state.tour_toast = narration
        state.tour_toast_until_tick = state.tick_count + TOUR_TOAST_TICKS
        if kind:
            apply_attack(state, kind, target=target)
        state.tour_step_idx += 1
    if state.tour_step_idx >= len(TOUR_SCRIPT) and state.tick_count > state.tour_toast_until_tick:
        state.tour_active = False
        state.tour_toast = ""


def _publish_pose(state: SwarmState, ts: int) -> None:
    for a in state.last_tick.agents:  # type: ignore[union-attr]
        ident = state.identities[a.id]
        p = state.slam[a.id].pose()
        x, y = p.x, p.y
        if a.id in state.liars:
            x, y = x + LIE_OFFSET[0], y + LIE_OFFSET[1]
        seal_ts = ts + state.clock_skew_offsets.get(a.id, 0)
        pose = PoseReport(a.id, x, y, p.theta, seal_ts)
        env = ident.seal(KIND_POSE, encode(pose), timestamp_ns=seal_ts)
        state.bus.publish("pose", envelope_to_wire(env))


def _publish_observations(state: SwarmState, ts: int) -> None:
    """Beacon returns ship as (range_m, bearing_rad) — the frame-invariant
    scalars from the radio. The trust evaluator votes on range only; bearing
    is preserved for visualization and future range-and-bearing fusion. The
    world-frame projection that previously contaminated cohort voting with
    each observer's private SLAM drift is gone (ADR 0015)."""
    for a in state.last_tick.agents:  # type: ignore[union-attr]
        ident = state.identities[a.id]
        seal_ts = ts + state.clock_skew_offsets.get(a.id, 0)
        for beacon in state.last_tick.beacons[a.id]:  # type: ignore[union-attr]
            obs = Observation(
                a.id, beacon.subject_id, beacon.range_m, beacon.bearing_rad, seal_ts
            )
            env = ident.seal(KIND_OBSERVATION, encode(obs), timestamp_ns=seal_ts)
            state.bus.publish("observation", envelope_to_wire(env))


def _publish_sybils(state: SwarmState, ts: int) -> None:
    if not state.sybils:
        return
    for sybil_id, sybil_ident in state.sybils.items():
        target = state.sybil_targets[sybil_id]
        target_agent = next(
            (a for a in state.last_tick.agents if a.id == target), None  # type: ignore[union-attr]
        )
        if target_agent is None:
            continue
        fake_x = target_agent.x + state.rng.uniform(-SYBIL_LIE_RADIUS_M, SYBIL_LIE_RADIUS_M)
        fake_y = target_agent.y + state.rng.uniform(-SYBIL_LIE_RADIUS_M, SYBIL_LIE_RADIUS_M)
        state.sybil_last_pose[sybil_id] = (fake_x, fake_y)
        fake_pose = PoseReport(sybil_id, fake_x, fake_y, 0.0, ts)
        env = sybil_ident.seal(KIND_POSE, encode(fake_pose), timestamp_ns=ts)
        state.bus.publish("pose", envelope_to_wire(env))
        # Cabal-internal range to the target: 0.5 m at bearing 0 in sybil's frame.
        # The V2 self-anchored beacon defense filters this out before voting —
        # honest peers never personally beacon a sybil, so cabal-internal
        # corroboration carries zero weight in their cohorts.
        fake_obs = Observation(sybil_id, target, 0.5, 0.0, ts)
        env = sybil_ident.seal(KIND_OBSERVATION, encode(fake_obs), timestamp_ns=ts)
        state.bus.publish("observation", envelope_to_wire(env))


def _publish_fragments(state: SwarmState, ts: int) -> None:
    for a in state.last_tick.agents:  # type: ignore[union-attr]
        ident = state.identities[a.id]
        p = state.slam[a.id].pose()
        fragment = encode_fragment(a.id, p, list(state.last_tick.scans[a.id]))  # type: ignore[union-attr]
        seal_ts = ts + state.clock_skew_offsets.get(a.id, 0)
        env = ident.seal(KIND_FRAGMENT, fragment, timestamp_ns=seal_ts)
        state.bus.publish("fragment", envelope_to_wire(env))


def _publish_gossip(state: SwarmState, ts: int) -> None:
    for a in state.last_tick.agents:  # type: ignore[union-attr]
        snap = state.agent_evaluators[a.id].gossip_snapshot()
        if not snap:
            continue
        seal_ts = ts + state.clock_skew_offsets.get(a.id, 0)
        gossip = ReputationGossip(a.id, snap, seal_ts)
        env = state.identities[a.id].seal(KIND_REPUTATION, encode(gossip), timestamp_ns=seal_ts)
        state.bus.publish("reputation", envelope_to_wire(env))


def _record_rep_traces(state: SwarmState, ts: int) -> None:
    for viewer in state.agent_ids:
        snap = state.agent_evaluators[viewer].gossip_snapshot()
        for peer_id, ab in snap.items():
            state.rep_traces[viewer].record(peer_id, ab[0], ab[1], ts)
