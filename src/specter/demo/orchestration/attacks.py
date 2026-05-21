"""Byzantine attack injection (compromise, lie, revoke, rotate, sybil, skew, ...)."""

from __future__ import annotations

import os
import time
from pathlib import Path

from specter.crypto import Keypair
from specter.identity import KeyRotationAnnouncement, apply_rotation, sign_rotation
from specter.secure_bus import Identity
from specter.telemetry import JsonlTelemetrySink

from .state import SKEW_OFFSET_NS, SwarmState


def apply_attack(
    state: SwarmState,
    kind: str,
    *,
    target: str | None = None,
    jsonl_path: Path | None = None,
) -> tuple[bool, str]:
    """Mutate `state` to inject a Byzantine attack of `kind` against `target`
    (or auto-select). Returns `(applied, agent_id_or_label)`. `kind` ∈
    {"swap_key", "pose_lie", "heal", "revoke", "rotate", "sybil",
     "toggle_attestation", "skew", "toggle_jsonl"}.

    Mirrors the demo's keybind semantics exactly so the headless smoke and
    notebook orchestration produce identical state transitions.
    """
    sim = state.sim
    ts_ns = int(sim.t * 1e9)
    if kind == "swap_key":
        for a in sim.agents:
            if target is not None and a.id != target:
                continue
            if a.id not in state.compromised:
                state.compromised.add(a.id)
                state.identities[a.id].keypair = Keypair.generate()
                state.log.append(("compro", a.id, 0))
                return True, a.id
        return False, ""
    if kind == "pose_lie":
        for a in sim.agents:
            if target is not None and a.id != target:
                continue
            if a.id not in state.liars and a.id not in state.compromised:
                state.liars.add(a.id)
                state.log.append(("lie", a.id, 0))
                return True, a.id
        return False, ""
    if kind == "heal":
        if state.liars:
            agent_id = target if target in state.liars else next(iter(state.liars))
            state.liars.discard(agent_id)
            state.log.append(("heal", agent_id, 0))
            return True, agent_id
        return False, ""
    if kind == "revoke":
        revoked_pubs = {b for b in state.revocation._revoked}  # noqa: SLF001
        for a in sim.agents:
            if target is not None and a.id != target:
                continue
            pub_b = state.identities[a.id].keypair.public_bytes
            if pub_b not in revoked_pubs:
                state.revocation.revoke(pub_b, ts_ns)
                state.log.append(("revoke", a.id, 0))
                return True, a.id
        return False, ""
    if kind == "rotate":
        for a in sim.agents:
            if target is not None and a.id != target:
                continue
            ident = state.identities[a.id]
            new_kp = Keypair.generate()
            ann = KeyRotationAnnouncement(
                agent_id=a.id,
                old_pubkey=ident.keypair.public_bytes,
                new_pubkey=new_kp.public_bytes,
                effective_t_ns=ts_ns,
            )
            sign_rotation(ann, ident.keypair)
            apply_rotation(state.roster, ann, t_ns=ts_ns)
            state.attestation._allowlist.add(new_kp.public_bytes)  # noqa: SLF001
            state.identities[a.id] = Identity(a.id, new_kp)
            state.log.append(("rotate", a.id, 0))
            return True, a.id
        return False, ""
    if kind == "sybil":
        sybil_id = f"sybil_{len(state.sybils)}"
        sybil_kp = Keypair.generate()
        state.sybils[sybil_id] = Identity(sybil_id, sybil_kp)
        state.roster.add_peer(sybil_id, sybil_kp.public_bytes, ts_ns)
        chosen_target = target or next(iter(state.liars), state.agent_ids[0])
        state.sybil_targets[sybil_id] = chosen_target
        state.log.append(("sybil", sybil_id, 0))
        return True, sybil_id
    if kind == "toggle_attestation":
        state.attestation_required = not state.attestation_required
        label = "ON" if state.attestation_required else "OFF"
        state.log.append(("attest", label, 0))
        return True, label
    if kind == "skew":
        for a in sim.agents:
            if target is not None and a.id != target:
                continue
            if a.id not in state.clock_skew_offsets:
                state.clock_skew_offsets[a.id] = SKEW_OFFSET_NS
                state.log.append(("skew", a.id, 0))
                return True, a.id
        if state.clock_skew_offsets:
            agent_id = next(iter(state.clock_skew_offsets))
            del state.clock_skew_offsets[agent_id]
            state.log.append(("unskew", agent_id, 0))
            return True, agent_id
        return False, ""
    if kind == "toggle_jsonl":
        if state.telemetry.jsonl is None:
            path = jsonl_path or Path(
                f"/tmp/specter-demo-{os.getpid()}-{int(time.time())}.jsonl"
            )
            state.telemetry.jsonl = JsonlTelemetrySink(path)
            state.log.append(("rec", "jsonl", 0))
            return True, str(path)
        state.telemetry.jsonl = None
        state.log.append(("rec-stop", "jsonl", 0))
        return True, ""
    raise ValueError(f"unknown attack kind: {kind}")
