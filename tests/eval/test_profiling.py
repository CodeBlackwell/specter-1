"""Trust evaluator profiling baseline at N=4, 10, 25 peers.

Profiles **one** agent's evaluator processing incoming traffic from
peers in an all-honest swarm. Each tick the evaluator ingests N pose
reports plus one observation per peer (the peer's primary neighbor),
modelling the airtime-rationed radio budget a Crazyflie operates in.
Cohort voting fires inside `record_observation` and at end-of-run
`flush()`.

The assertion `cost(25) / cost(4) < 100` catches a regression that
makes per-call work super-quadratic in N. Headroom is intentionally
narrow so cohort-voting cost cannot quietly slip above O(N²).

Run:
    uv run pytest -m slow tests/eval/test_profiling.py -v -s

The `-s` flag surfaces the printed summary table; `-m slow` keeps the
benchmark off the default `pytest -q` hot path.
"""

import math
import random
import time

import pytest

from specter.crypto import Keypair
from specter.messages import KIND_OBSERVATION, KIND_POSE, Observation, PoseReport, encode
from specter.secure_bus import Identity
from specter.trust import BetaTrustEvaluator


def _make_agents(n: int) -> list[tuple[str, float, float, float]]:
    """Tight cluster so all peers see each other on beacons."""
    rng = random.Random(0)
    return [
        (f"peer{i:02d}", rng.uniform(0.5, 5.5), rng.uniform(0.5, 5.5), rng.uniform(0, 2 * math.pi))
        for i in range(n)
    ]


def _profile_one_run(n_peers: int, n_ticks: int) -> float:
    """Returns mean per-tick evaluator wall-clock cost in microseconds.

    Models a single agent's evaluator (self_id="peer00") receiving the
    swarm's pose reports + cross-observations each tick.
    """
    agents = _make_agents(n_peers)
    self_id = agents[0][0]
    agent_ids = [aid for aid, _, _, _ in agents]
    identities = {aid: Identity(aid, Keypair.generate()) for aid in agent_ids}
    evaluator = BetaTrustEvaluator(self_id=self_id)

    rng = random.Random(0)
    elapsed_ns = 0
    for tick in range(1, n_ticks + 1):
        ts = tick * 50_000_000

        poses: dict[str, PoseReport] = {}
        for aid, x, y, theta in agents:
            jx = x + rng.gauss(0, 0.01)
            jy = y + rng.gauss(0, 0.01)
            poses[aid] = PoseReport(aid, jx, jy, theta, ts)

        for sender_id in agent_ids:
            env = identities[sender_id].seal(KIND_POSE, encode(poses[sender_id]), timestamp_ns=ts)
            t0 = time.perf_counter_ns()
            evaluator.record_pose_report(env, poses[sender_id])
            elapsed_ns += time.perf_counter_ns() - t0

        for i, (observer_id, ox, oy, _) in enumerate(agents):
            obs_pose = poses[observer_id]
            ident = identities[observer_id]
            subject_id, sx, sy, _ = agents[(i + 1) % n_peers]
            dx = sx - obs_pose.x
            dy = sy - obs_pose.y
            range_m = math.hypot(dx, dy) + rng.gauss(0, 0.05)
            bearing_rad = math.atan2(dy, dx) + rng.gauss(0, 0.01)
            obs = Observation(observer_id, subject_id, range_m, bearing_rad, ts)
            env = ident.seal(KIND_OBSERVATION, encode(obs), timestamp_ns=ts)
            t0 = time.perf_counter_ns()
            evaluator.record_observation(env, obs)
            elapsed_ns += time.perf_counter_ns() - t0

    t0 = time.perf_counter_ns()
    evaluator.flush()
    elapsed_ns += time.perf_counter_ns() - t0

    return elapsed_ns / n_ticks / 1000.0  # μs/tick


@pytest.mark.slow
def test_evaluator_scales_sub_quadratically():
    sizes = [4, 10, 25]
    n_ticks = 80
    results: dict[int, float] = {n: _profile_one_run(n, n_ticks) for n in sizes}

    print(f"\n  Trust evaluator profiling baseline ({n_ticks} ticks/run, single evaluator)")
    print("  " + "-" * 50)
    for n in sizes:
        print(f"  n={n:>2}: avg_us={results[n]:>10,.1f}")
    print("  " + "-" * 50)
    ratio = results[25] / results[4]
    print(f"  cost(25)/cost(4) = {ratio:.1f}x   (sub-quadratic if < 100)")

    assert ratio < 100, (
        f"Evaluator cost scaling regressed past O(N²): cost(25)/cost(4) = {ratio:.1f}"
    )
