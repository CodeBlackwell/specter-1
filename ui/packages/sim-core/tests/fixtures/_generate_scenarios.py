"""Generate per-scenario parity fixtures for the TS battery (ADR 0014 audit
surface + SYSTEM_ASSESSMENT.md §9 rec 5).

Run from repo root:
  uv run python ui/packages/sim-core/tests/fixtures/_generate_scenarios.py

Emits `scenarios.parity.json` next to this file. The TS test
(`tests/runSecureScenario.parity.test.ts`) asserts the same outcomes on the
TS implementation.

Parity contract for adversarial scenarios:
  - Integer-exact match on per-tick reject counts by category.
  - Reputation-trajectory match to 6 decimals on deterministic scenarios
    (no sensor noise, fixed beacon ranges, fixed timestamps).

Full-noise scenarios are NOT parity-tested at this level — the sim-core
math layer already has byte-exact parity fixtures (parity.json). This file
gates the envelope round-trip + COP filter + reject categorization paths.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

from specter.crypto import Keypair
from specter.secure_bus import (
    Envelope,
    Identity,
    ReplayWindow,
    Roster,
    VerificationError,
    envelope_to_wire,
    open_envelope,
)
from specter.trust.evaluator import BetaTrustEvaluator

OUT = Path(__file__).with_name("scenarios.parity.json")

KIND_OBS = "observation"
KIND_POSE = "pose_report"
KIND_CONTACT = "contact_report"

REPLAY_REPETITIONS = 10


def _categorize(message: str) -> str:
    if message.startswith("bad signature"):
        return "bad_signature"
    if message.startswith("replay"):
        return "replay"
    if message.startswith("unknown sender"):
        return "unknown_sender"
    if message.startswith("unsupported version"):
        return "version_mismatch"
    return "unknown"


@dataclass
class TickResult:
    accepts: int
    rejects: int
    rejects_by_category: dict[str, int]
    reputations: dict[str, float]


def _round_rep(rep: float, decimals: int = 6) -> float:
    return round(rep, decimals)


def _make_world(n_peers: int) -> tuple[list[str], dict[str, Identity], Roster, ReplayWindow, BetaTrustEvaluator]:
    agent_ids = [f"a{i}" for i in range(n_peers)]
    identities: dict[str, Identity] = {aid: Identity(aid, Keypair.generate()) for aid in agent_ids}
    roster = Roster()
    for aid, ident in identities.items():
        roster.add(aid, ident.keypair.public_bytes)
    replay = ReplayWindow()
    evaluator = BetaTrustEvaluator()
    return agent_ids, identities, roster, replay, evaluator


def _try_open(env: Envelope, roster: Roster, replay: ReplayWindow, evaluator: BetaTrustEvaluator) -> tuple[bool, str]:
    try:
        open_envelope(env, roster, replay)
        evaluator.record_accept(env)
        return True, ""
    except VerificationError as e:
        evaluator.record_reject(env, e)
        return False, _categorize(str(e))


def _final_reps(evaluator: BetaTrustEvaluator, agent_ids: list[str]) -> dict[str, float]:
    return {aid: _round_rep(evaluator.reputation(aid)) for aid in agent_ids}


def scenario_honest_baseline() -> dict:
    """Two peers exchange clean pose envelopes for 5 ticks; no rejects."""
    agent_ids, identities, roster, replay, evaluator = _make_world(2)
    ticks: list[TickResult] = []
    for t in range(1, 6):
        ts = t * 1_000_000_000  # 1s per tick
        accepts = 0
        rejects = 0
        rejects_by_category: dict[str, int] = {}
        for aid in agent_ids:
            payload = json.dumps(
                {"agent_id": aid, "x": 0.0, "y": 0.0, "theta": 0.0, "timestamp_ns": ts},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            env = identities[aid].seal(KIND_POSE, payload, timestamp_ns=ts)
            ok, cat = _try_open(env, roster, replay, evaluator)
            if ok:
                accepts += 1
            else:
                rejects += 1
                rejects_by_category[cat] = rejects_by_category.get(cat, 0) + 1
        ticks.append(
            TickResult(
                accepts=accepts,
                rejects=rejects,
                rejects_by_category=rejects_by_category,
                reputations={a: _round_rep(evaluator.reputation(a)) for a in agent_ids},
            )
        )
    return {
        "name": "honest_baseline",
        "n_peers": 2,
        "ticks": [asdict(t) for t in ticks],
        "final_reputations": _final_reps(evaluator, agent_ids),
    }


def scenario_swap_key() -> dict:
    """Two peers; a0 rotates its keypair at tick 3 without updating the roster.
    From tick 3 onward, every a0 envelope rejects with bad_signature."""
    agent_ids, identities, roster, replay, evaluator = _make_world(2)
    ticks: list[TickResult] = []
    for t in range(1, 8):
        ts = t * 1_000_000_000
        if t == 3:
            # Rotate a0's keypair silently — roster NOT updated.
            identities["a0"].keypair = Keypair.generate()
        accepts = 0
        rejects = 0
        rejects_by_category: dict[str, int] = {}
        for aid in agent_ids:
            payload = json.dumps(
                {"agent_id": aid, "x": 0.0, "y": 0.0, "theta": 0.0, "timestamp_ns": ts},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            env = identities[aid].seal(KIND_POSE, payload, timestamp_ns=ts)
            ok, cat = _try_open(env, roster, replay, evaluator)
            if ok:
                accepts += 1
            else:
                rejects += 1
                rejects_by_category[cat] = rejects_by_category.get(cat, 0) + 1
        ticks.append(
            TickResult(
                accepts=accepts,
                rejects=rejects,
                rejects_by_category=rejects_by_category,
                reputations={a: _round_rep(evaluator.reputation(a)) for a in agent_ids},
            )
        )
    return {
        "name": "swap_key",
        "n_peers": 2,
        "swap_key_tick": 3,
        "ticks": [asdict(t) for t in ticks],
        "final_reputations": _final_reps(evaluator, agent_ids),
    }


def scenario_replay_storm() -> dict:
    """Two peers; a0 captures its first envelope and re-publishes 10× per tick
    starting tick 2. Each replay fails the replay-window check."""
    agent_ids, identities, roster, replay, evaluator = _make_world(2)
    ticks: list[TickResult] = []
    captured_wire: bytes | None = None
    for t in range(1, 5):
        ts = t * 1_000_000_000
        accepts = 0
        rejects = 0
        rejects_by_category: dict[str, int] = {}
        # Honest emission first
        for aid in agent_ids:
            payload = json.dumps(
                {"agent_id": aid, "x": 0.0, "y": 0.0, "theta": 0.0, "timestamp_ns": ts},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            env = identities[aid].seal(KIND_POSE, payload, timestamp_ns=ts)
            if aid == "a0" and captured_wire is None:
                captured_wire = envelope_to_wire(env)
            ok, cat = _try_open(env, roster, replay, evaluator)
            if ok:
                accepts += 1
            else:
                rejects += 1
                rejects_by_category[cat] = rejects_by_category.get(cat, 0) + 1
        # Replay storm activates at tick 2
        if t >= 2 and captured_wire is not None:
            from specter.secure_bus import envelope_from_wire

            for _ in range(REPLAY_REPETITIONS):
                env = envelope_from_wire(captured_wire)
                ok, cat = _try_open(env, roster, replay, evaluator)
                if ok:
                    accepts += 1
                else:
                    rejects += 1
                    rejects_by_category[cat] = rejects_by_category.get(cat, 0) + 1
        ticks.append(
            TickResult(
                accepts=accepts,
                rejects=rejects,
                rejects_by_category=rejects_by_category,
                reputations={a: _round_rep(evaluator.reputation(a)) for a in agent_ids},
            )
        )
    return {
        "name": "replay_storm",
        "n_peers": 2,
        "replay_start_tick": 2,
        "replay_repetitions": REPLAY_REPETITIONS,
        "ticks": [asdict(t) for t in ticks],
        "final_reputations": _final_reps(evaluator, agent_ids),
    }


def scenario_forged_emitter() -> dict:
    """Two roster peers plus one off-roster intruder. Intruder seals a valid
    signature on its own keypair, but the roster doesn't know it — every
    intruder envelope rejects with unknown_sender."""
    agent_ids, identities, roster, replay, evaluator = _make_world(2)
    intruder = Identity("intruder", Keypair.generate())  # NOT added to roster
    ticks: list[TickResult] = []
    for t in range(1, 5):
        ts = t * 1_000_000_000
        accepts = 0
        rejects = 0
        rejects_by_category: dict[str, int] = {}
        # Honest peers
        for aid in agent_ids:
            payload = json.dumps(
                {"agent_id": aid, "x": 0.0, "y": 0.0, "theta": 0.0, "timestamp_ns": ts},
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            env = identities[aid].seal(KIND_POSE, payload, timestamp_ns=ts)
            ok, cat = _try_open(env, roster, replay, evaluator)
            if ok:
                accepts += 1
            else:
                rejects += 1
                rejects_by_category[cat] = rejects_by_category.get(cat, 0) + 1
        # Intruder
        payload = json.dumps(
            {"agent_id": "intruder", "x": 9.9, "y": 9.9, "theta": 0.0, "timestamp_ns": ts},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        env = intruder.seal(KIND_POSE, payload, timestamp_ns=ts)
        ok, cat = _try_open(env, roster, replay, evaluator)
        if ok:
            accepts += 1
        else:
            rejects += 1
            rejects_by_category[cat] = rejects_by_category.get(cat, 0) + 1
        ticks.append(
            TickResult(
                accepts=accepts,
                rejects=rejects,
                rejects_by_category=rejects_by_category,
                reputations={
                    **{a: _round_rep(evaluator.reputation(a)) for a in agent_ids},
                    "intruder": _round_rep(evaluator.reputation("intruder")),
                },
            )
        )
    return {
        "name": "forged_emitter",
        "n_peers": 2,
        "foreign_emitter": "intruder",
        "ticks": [asdict(t) for t in ticks],
        "final_reputations": {
            **_final_reps(evaluator, agent_ids),
            "intruder": _round_rep(evaluator.reputation("intruder")),
        },
    }


def scenario_cop_phantom_static() -> dict:
    """Deterministic COP scenario: 3 honest peers within sensor radius of one
    real item; 1 attacker (a3) injects a phantom contact every tick. With
    a3's rep starting at 0.5 (no Tier 1 fire because the scenario isn't
    range-driven), the phantom's avg_weight is just the attacker's rep.
    The fixture is the COP after N ticks of contact-report ingestion at
    fixed reputation, asserting `phantom` survives only when attacker rep
    is above threshold."""
    import sys

    from specter.sim.world import Item

    sys.path.insert(0, str(Path(__file__).resolve().parents[5]))
    from tests.eval.runner import build_cop  # noqa: E402

    real = Item("uxo-real", "uxo", 0.0, 0.0)
    phantom = Item("phantom-1", "uxo", 5.0, 5.0)
    peers = ["alpha", "bravo", "charlie", "delta"]  # delta = attacker

    # Synthesize 3 ticks of honest reports for the real item + phantom from delta.
    contact_log = []
    for t in range(1, 4):
        ts = t * 1_000_000_000
        for peer in peers:
            if peer == "delta":
                continue
            from specter.messages import ContactReport
            contact_log.append(
                ContactReport(
                    reporter_id=peer,
                    contact_id=real.id,
                    kind=real.kind,
                    x=real.x,
                    y=real.y,
                    timestamp_ns=ts,
                )
            )
        # delta injects the phantom each tick
        contact_log.append(
            ContactReport(
                reporter_id="delta",
                contact_id=phantom.id,
                kind=phantom.kind,
                x=phantom.x,
                y=phantom.y,
                timestamp_ns=ts,
            )
        )

    # Case A: delta rep = 0.9 → phantom in COP
    reps_high = {"alpha": 0.9, "bravo": 0.9, "charlie": 0.9, "delta": 0.9}
    cop_high = build_cop(contact_log, reps_high, threshold=0.5)
    # Case B: delta rep = 0.1 → phantom filtered out
    reps_low = {"alpha": 0.9, "bravo": 0.9, "charlie": 0.9, "delta": 0.1}
    cop_low = build_cop(contact_log, reps_low, threshold=0.5)

    def cop_to_dict(cop):
        return {
            cid: {
                "contact_id": e.contact_id,
                "kind": e.kind,
                "x": _round_rep(e.x),
                "y": _round_rep(e.y),
                "weight": _round_rep(e.weight),
                "reporters": list(e.reporters),
            }
            for cid, e in cop.items()
        }

    return {
        "name": "cop_phantom_static",
        "real_item": {"id": real.id, "kind": real.kind, "x": real.x, "y": real.y},
        "phantom_item": {"id": phantom.id, "kind": phantom.kind, "x": phantom.x, "y": phantom.y},
        "peers": peers,
        "case_high_rep": {"reputations": reps_high, "cop": cop_to_dict(cop_high)},
        "case_low_rep": {"reputations": reps_low, "cop": cop_to_dict(cop_low)},
    }


def main() -> None:
    fixtures: dict[str, object] = {
        "version": 1,
        "format": "scenarios-parity-v1",
        "note": (
            "Integer-exact per-tick reject counts by category; reputation "
            "curves to 6 decimals on deterministic scenarios. COP filter "
            "exact-float on synthetic contact logs."
        ),
        "scenarios": {
            "honest_baseline": scenario_honest_baseline(),
            "swap_key": scenario_swap_key(),
            "replay_storm": scenario_replay_storm(),
            "forged_emitter": scenario_forged_emitter(),
            "cop_phantom_static": scenario_cop_phantom_static(),
        },
    }
    OUT.write_text(json.dumps(fixtures, indent=2))
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
