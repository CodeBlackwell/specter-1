"""Read-only frame view consumed by renderers (pygame, matplotlib)."""

from __future__ import annotations

import math

from .state import RenderSnapshot, SwarmState


def snapshot(state: SwarmState) -> RenderSnapshot:
    """Read-only view of the current frame for renderers (pygame demo,
    matplotlib notebooks). No state mutation."""
    if state.last_tick is None:
        return RenderSnapshot(
            tick_count=state.tick_count,
            sim_t=state.sim.t,
            world_width=state.sim.world.width,
            world_height=state.sim.world.height,
            agents=(),
            walls=tuple(state.sim.world.walls),
            scans={},
            slam_poses={},
            slam_drift={},
            bad_agents=frozenset(),
            lying_agents=frozenset(),
            viewer_id=state.viewer_id,
            viewer_reputation={},
            viewer_presence={},
            viewer_alpha_beta={},
            merged_grid_bytes=state.merged_grids.get(state.viewer_id),
            loop_closure_active=False,
            last_merge_tick=state.last_merge_tick,
            bus_label=state.bus_label,
            attestation_required=state.attestation_required,
            sybil_claim_pose=dict(state.sybil_last_pose),
            sybil_targets=dict(state.sybil_targets),
            last_reject_tick=dict(state.last_reject_tick),
            merged_votes=state.merged_votes_for_viewer,
            tour_active=state.tour_active,
            tour_toast=(state.tour_toast
                        if state.tick_count <= state.tour_toast_until_tick else ""),
        )
    last_tick = state.last_tick
    slam_poses = {a.id: state.slam[a.id].pose() for a in last_tick.agents}
    slam_drift = {
        a.id: math.hypot(slam_poses[a.id].x - a.x, slam_poses[a.id].y - a.y)
        for a in last_tick.agents
    }
    viewer_evaluator = state.agent_evaluators[state.viewer_id]
    viewer_reputation = {a.id: viewer_evaluator.reputation(a.id) for a in last_tick.agents}
    now_ns = int(state.sim.t * 1e9)
    viewer_presence = {
        a.id: viewer_evaluator._has_presence(a.id, now_ns) for a in last_tick.agents
    }
    viewer_alpha_beta = {
        a.id: (viewer_evaluator._peers[a.id].alpha, viewer_evaluator._peers[a.id].beta)
        if a.id in viewer_evaluator._peers
        else (1.0, 1.0)
        for a in last_tick.agents
    }
    return RenderSnapshot(
        tick_count=state.tick_count,
        sim_t=state.sim.t,
        world_width=state.sim.world.width,
        world_height=state.sim.world.height,
        agents=last_tick.agents,
        walls=tuple(state.sim.world.walls),
        scans={a.id: tuple(last_tick.scans[a.id]) for a in last_tick.agents},
        slam_poses=slam_poses,
        slam_drift=slam_drift,
        bad_agents=frozenset(state.compromised),
        lying_agents=frozenset(state.liars),
        viewer_id=state.viewer_id,
        viewer_reputation=viewer_reputation,
        viewer_presence=viewer_presence,
        viewer_alpha_beta=viewer_alpha_beta,
        merged_grid_bytes=state.merged_grids.get(state.viewer_id),
        loop_closure_active=state.loop_closure_flash.get(state.viewer_id, 0) > 0,
        last_merge_tick=state.last_merge_tick,
        bus_label=state.bus_label,
        attestation_required=state.attestation_required,
        sybil_claim_pose=dict(state.sybil_last_pose),
        sybil_targets=dict(state.sybil_targets),
        last_reject_tick=dict(state.last_reject_tick),
        merged_votes=state.merged_votes_for_viewer,
        tour_active=state.tour_active,
        tour_toast=(state.tour_toast
                    if state.tick_count <= state.tour_toast_until_tick else ""),
    )
