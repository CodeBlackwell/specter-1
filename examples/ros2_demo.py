"""SROS2 transport smoke demo: run a subset of the attack battery over real DDS.

Wave-2 exit gate (US-043). Re-runs the four representative attack scenarios
(``single_pose_liar``, ``replay_storm``, ``sybil_flood (4:3)``,
``sybil_flood_mutual (4:3)``) over ``Sros2Bus`` and prints a side-by-side
comparison vs the ``InProcessBus`` baseline. Detection should hold within
a 2× latency band (allowance for real DDS round-trip).

SROS2 setup procedure
=====================

The bus uses `make_secure_node` which configures rclpy for SROS2 signed-
node DDS when given a keystore path. To reproduce on a real ROS2 host:

1. Install ROS2 Humble or later, then ``source /opt/ros/humble/setup.bash``.
2. Install the Python bindings: ``pip install rclpy`` (system-level —
   uv venvs do not see ROS2 bindings).
3. Generate a keystore::

       ros2 security create_keystore /tmp/specter_ks

4. Per-node enclave (one per process)::

       ros2 security create_enclave /tmp/specter_ks /specter_demo

5. Set environment::

       export ROS_SECURITY_KEYSTORE=/tmp/specter_ks
       export ROS_SECURITY_ENABLE=true
       export ROS_SECURITY_STRATEGY=Enforce

6. ``python examples/ros2_demo.py`` — runs the demo and prints the
   comparison table. Without rclpy installed the demo prints these
   instructions and exits 0.

Dual-layer signing rationale: see ADR 0011. Short version — SROS2
authenticates *node identity at the DDS layer*; envelope signing
authenticates the *agent identity within the application*. Different
trust roots, different compromise modes; both layers are required.
"""

from __future__ import annotations

import sys
import tempfile
import time

from specter.transport.sros2_marshal import RCLPY_AVAILABLE


SCENARIOS = ("single_pose_liar", "replay_storm", "sybil_flood", "sybil_flood_mutual")


def _build_scenarios() -> dict[str, object]:
    from tests.eval import scenarios as sc

    return {
        "single_pose_liar": sc.single_pose_liar(),
        "replay_storm": sc.replay_storm(),
        "sybil_flood": sc.sybil_flood(n_sybils=4),
        "sybil_flood_mutual": sc.sybil_flood_mutual(n_sybils=4),
    }


def _baseline_results() -> dict[str, object]:
    from tests.eval.runner import run_scenario

    out = {}
    for name, scenario in _build_scenarios().items():
        out[name] = run_scenario(scenario)
    return out


def _run_under_sros2() -> dict[str, object]:
    """Run scenarios over `Sros2Bus`. Caller must verify rclpy is available."""
    import rclpy  # type: ignore[import-not-found]

    from specter.transport.sros2_bus import Sros2Bus
    from specter.transport.sros2_marshal import make_secure_node
    from tests.eval import runner

    keystore = tempfile.mkdtemp(prefix="specter_ks_")
    node = make_secure_node("specter_demo", keystore)

    class _SyncSros2Bus(Sros2Bus):
        """Spin the node after each publish so subscribers get the message
        before the next publish — mirrors `InProcessBus` synchronous semantics
        for the smoke test. Real deployments rely on the executor."""

        def __init__(self, n: object) -> None:
            super().__init__(n)
            self._spin_node = n

        def publish(self, topic: str, payload: bytes) -> None:
            super().publish(topic, payload)
            rclpy.spin_once(self._spin_node, timeout_sec=0.0)

    factory = lambda: _SyncSros2Bus(node)  # noqa: E731
    original = runner.InProcessBus
    runner.InProcessBus = factory  # type: ignore[misc]
    try:
        out = {}
        for name, scenario in _build_scenarios().items():
            out[name] = runner.run_scenario(scenario)
        return out
    finally:
        runner.InProcessBus = original  # type: ignore[misc]
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


def _print_table(baseline: dict[str, object], lossy: dict[str, object]) -> None:
    print(f"{'scenario':<22} {'attacker':<12} {'baseline tick':>14} {'sros2 tick':>12}")
    print("-" * 64)
    for name in SCENARIOS:
        b = baseline[name]
        s = lossy[name]
        for attacker in b.scenario.attackers:  # type: ignore[attr-defined]
            b_tick = b.detection_ticks.get(attacker)  # type: ignore[attr-defined]
            s_tick = s.detection_ticks.get(attacker)  # type: ignore[attr-defined]
            print(f"{name:<22} {attacker:<12} {str(b_tick):>14} {str(s_tick):>12}")


def main() -> int:
    if not RCLPY_AVAILABLE:
        print("rclpy is not installed in this environment.")
        print("See `examples/ros2_demo.py` module docstring for setup.")
        print("This demo is a no-op without rclpy; exiting cleanly.")
        return 0

    t0 = time.perf_counter()
    print("running InProcessBus baseline...")
    baseline = _baseline_results()
    t_base = time.perf_counter() - t0

    t1 = time.perf_counter()
    print(f"running Sros2Bus pass... (baseline took {t_base:.1f}s)")
    sros2 = _run_under_sros2()
    t_sros2 = time.perf_counter() - t1

    print(f"\n=== SROS2 vs InProcessBus (baseline {t_base:.1f}s, sros2 {t_sros2:.1f}s) ===\n")
    _print_table(baseline, sros2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
