"""Bus selection + swarm construction + hardened receive chain."""

from __future__ import annotations

import random
import tempfile
from collections import deque
from typing import Callable

from specter.crypto import Keypair
from specter.identity import MockAttestationProvider, MutableRoster, RevocationList
from specter.interfaces import MessageBus
from specter.messages import (
    KIND_FRAGMENT,
    KIND_OBSERVATION,
    KIND_POSE,
    KIND_REPUTATION,
    decode,
)
from specter.secure_bus import (
    Identity,
    InProcessBus,
    ReplayWindow,
    VerificationError,
    envelope_from_wire,
)
from specter.sim.scenario import load_scenario
from specter.slam import OccupancyMapMerger, ScanMatchSlam
from specter.telemetry import ReputationTrace
from specter.transport.time_sync import DEFAULT_MAX_SKEW_NS, validate_timestamp
from specter.trust import BetaTrustEvaluator, ListTelemetry
from specter.types import Pose

from .state import (
    FRAGMENT_BUFFER_PER_AGENT,
    GRID_RES_M,
    LOG_LINES,
    StreamTelemetry,
    SwarmState,
    pub_bytes,
)


def make_bus(choice: str = "inproc") -> tuple[MessageBus, str]:
    """Construct the message bus per `choice`. Returns `(bus, label)`.

    `inproc` (default): synchronous lossless `InProcessBus`.
    `lossy`: `LossyBus` wrapping inproc (drop=5%, jitter=10ms).
    `sros2`: `Sros2Bus` over real DDS; falls back to inproc cleanly when
             rclpy is missing.
    """
    if choice == "lossy":
        from specter.transport.lossy_bus import LossyBus
        return (
            LossyBus(InProcessBus(), drop_prob=0.05, jitter_max_ms=10),
            "LOSSY drop=5% jitter=10ms",
        )
    if choice == "sros2":
        try:
            from specter.transport.qos import qos_for_topic
            from specter.transport.sros2_bus import Sros2Bus
            from specter.transport.sros2_marshal import make_secure_node
            keystore = tempfile.mkdtemp(prefix="specter_demo_ks_")
            node = make_secure_node("specter_demo", keystore)
            return Sros2Bus(node, qos_for_topic=qos_for_topic), f"SROS2 {keystore}"
        except Exception as e:  # noqa: BLE001 — graceful demo fallback
            print(f"[demo] SROS2 unavailable ({e}); falling back to InProcessBus")
            return InProcessBus(), "INPROC (sros2 fallback)"
    return InProcessBus(), "INPROC"


def build_swarm(
    scenario_path: str,
    bus_choice: str = "inproc",
    *,
    rng_seed: int = 0xBEEF,
) -> SwarmState:
    """Construct a fully wired swarm: sim + identities + roster + revocation
    + attestation + evaluators + replays + SLAM + mergers + bus + telemetry.

    The receive handler chain is the same one `Sros2Bus._apply_filters` runs
    on DDS — implementing it here proves identity hardening is bus-agnostic.
    """
    sim, _ = load_scenario(scenario_path)
    identities = {a.id: Identity(a.id, Keypair.generate()) for a in sim.agents}
    roster = MutableRoster()
    for ident in identities.values():
        roster.add_peer(ident.agent_id, ident.keypair.public_bytes, t_ns=0)
    revocation = RevocationList()
    attestation = MockAttestationProvider(
        allowlist={ident.keypair.public_bytes for ident in identities.values()}
    )

    bus, bus_label = make_bus(bus_choice)
    list_telemetry = ListTelemetry()
    telemetry = StreamTelemetry(list_telemetry)

    primary_id = sim.agents[0].id
    agent_ids = [a.id for a in sim.agents]
    agent_evaluators = {
        a.id: BetaTrustEvaluator(telemetry=telemetry, self_id=a.id) for a in sim.agents
    }
    agent_replays = {a.id: ReplayWindow() for a in sim.agents}
    rep_traces = {a.id: ReputationTrace() for a in sim.agents}
    slam = {
        a.id: ScanMatchSlam(
            agent_id=a.id,
            init_pose=Pose(x=a.x, y=a.y, theta=a.theta, t=0.0),
            dt=sim.dt,
            init_velocity=(a.vx, a.vy),
        )
        for a in sim.agents
    }
    mergers = {
        a.id: OccupancyMapMerger(sim.world.width, sim.world.height, resolution_m=GRID_RES_M)
        for a in sim.agents
    }
    fragment_buffers: dict[str, deque[bytes]] = {
        a.id: deque(maxlen=FRAGMENT_BUFFER_PER_AGENT * len(sim.agents)) for a in sim.agents
    }
    merged_grids: dict[str, bytes | None] = {a.id: None for a in sim.agents}
    loop_closure_flash: dict[str, int] = {a.id: 0 for a in sim.agents}

    state = SwarmState(
        sim=sim,
        bus=bus,
        bus_label=bus_label,
        primary_id=primary_id,
        agent_ids=agent_ids,
        identities=identities,
        roster=roster,
        revocation=revocation,
        attestation=attestation,
        list_telemetry=list_telemetry,
        telemetry=telemetry,
        agent_evaluators=agent_evaluators,
        agent_replays=agent_replays,
        rep_traces=rep_traces,
        slam=slam,
        mergers=mergers,
        fragment_buffers=fragment_buffers,
        merged_grids=merged_grids,
        loop_closure_flash=loop_closure_flash,
        log=deque(maxlen=LOG_LINES),
        rng=random.Random(rng_seed),
        viewer_id=primary_id,
    )

    for self_id in state.agent_evaluators:
        handler = _make_handler(state, self_id)
        bus.subscribe("pose", handler)
        bus.subscribe("observation", handler)
        bus.subscribe("reputation", handler)
        bus.subscribe("fragment", handler)

    return state


def _make_handler(state: SwarmState, self_id: str) -> Callable[[bytes], None]:
    evaluator = state.agent_evaluators[self_id]
    replay = state.agent_replays[self_id]
    is_primary = self_id == state.primary_id

    def on_envelope(wire: bytes) -> None:
        env = envelope_from_wire(wire)
        try:
            validate_timestamp(env.timestamp_ns, int(state.sim.t * 1e9), DEFAULT_MAX_SKEW_NS)
            pub = state.roster.lookup(env.sender_id, env.timestamp_ns)
            if pub is not None:
                pub_b = pub_bytes(pub)
                if state.revocation.is_revoked(pub_b, env.timestamp_ns):
                    raise VerificationError(f"key_revoked: {env.sender_id}")
                if state.attestation_required and not state.attestation.is_attested(pub_b):
                    raise VerificationError(f"unattested_key: {env.sender_id}")
            payload = state.roster.verify_envelope(env, replay)
            evaluator.record_accept(env)
            if env.kind == KIND_POSE:
                evaluator.record_pose_report(env, decode(env.kind, payload))
            elif env.kind == KIND_OBSERVATION:
                evaluator.record_observation(env, decode(env.kind, payload))
            elif env.kind == KIND_REPUTATION:
                evaluator.record_gossip(env, decode(env.kind, payload))
            elif env.kind == KIND_FRAGMENT:
                state.fragment_buffers[self_id].append(payload)
            if is_primary:
                state.log.append(("ok", env.sender_id, env.nonce))
        except VerificationError as e:
            evaluator.record_reject(env, e)
            state.last_reject_tick[env.sender_id] = state.tick_count
            if is_primary:
                msg = str(e)
                category = msg.split(":", 1)[0].split()[0] if msg else "reject"
                state.log.append((f"reject:{category}", env.sender_id, env.nonce))

    return on_envelope
