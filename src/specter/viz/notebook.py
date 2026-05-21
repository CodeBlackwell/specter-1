"""Matplotlib visualization helpers for the workshop notebooks.

Every helper returns a `matplotlib.figure.Figure` so notebooks can call
`plt.show()` (or render under `MPLBACKEND=Agg` in CI). All helpers consume
real library types — `WorldState`/`Tick`, `BetaTrustEvaluator` outputs,
`ReputationTrace`, `OccupancyMapMerger.merge_with_votes` results — so
visualizations stay correct as the library evolves (no inlined math).

Optional dependency: `matplotlib`. Install via the `[workshop]` extra.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FuncAnimation
from matplotlib.figure import Figure
from scipy.stats import beta as scipy_beta  # type: ignore[import-untyped]

from specter.telemetry import ReputationTrace
from specter.trust import CohortEvent
from specter.types import Pose

if TYPE_CHECKING:
    from specter.demo import RenderSnapshot


# ── World rendering ───────────────────────────────────────────────────────


def world_figure(snapshot: RenderSnapshot, *, ax: Any | None = None) -> Figure:
    """Single-frame top-down view: walls + ground-truth agents + SLAM ghosts.

    Pass `ax=` to compose into an existing figure (e.g., subplot grid).
    """
    fig: Figure
    if ax is None:
        fig, ax = plt.subplots(figsize=(6, 6))
    else:
        fig = ax.figure  # type: ignore[assignment]
    for w in snapshot.walls:
        ax.plot([w.x1, w.x2], [w.y1, w.y2], color="#d4d8c8", linewidth=2)
    for agent in snapshot.agents:
        bad = agent.id in snapshot.bad_agents or agent.id in snapshot.lying_agents
        color = "#d4583a" if bad else "#c9a961"
        ax.plot(agent.x, agent.y, "o", color=color, markersize=10)
        ghost = snapshot.slam_poses[agent.id]
        ax.plot(ghost.x, ghost.y, "x", color="#5a5a69", markersize=8)
        ax.annotate(
            f"{agent.id} Δ{snapshot.slam_drift[agent.id]:.2f}m",
            (agent.x, agent.y),
            xytext=(8, 8),
            textcoords="offset points",
            fontsize=8,
        )
    ax.set_xlim(0, snapshot.world_width)
    ax.set_ylim(0, snapshot.world_height)
    ax.set_aspect("equal")
    ax.set_title(f"tick={snapshot.tick_count} t={snapshot.sim_t:.2f}s")
    return fig


def world_animation(
    snapshots: Sequence[RenderSnapshot],
    interval_ms: int = 50,
) -> FuncAnimation:
    """Animation cycling through pre-recorded snapshots. Notebooks call
    `HTML(anim.to_jshtml())` to embed inline.
    """
    if not snapshots:
        raise ValueError("snapshots is empty")
    fig, ax = plt.subplots(figsize=(6, 6))

    def _draw(i: int) -> Any:
        ax.clear()
        world_figure(snapshots[i], ax=ax)
        return ()

    return FuncAnimation(
        fig, _draw, frames=len(snapshots), interval=interval_ms, blit=False,
    )


# ── Trust dynamics ────────────────────────────────────────────────────────


def beta_pdf(alpha: float, beta_param: float, *, points: int = 200) -> Figure:
    """Plot the Beta(α, β) PDF over [0, 1]. Notebook 03 wraps this with
    `ipywidgets.interact(beta_pdf, alpha=..., beta_param=...)` for sliders.
    """
    fig, ax = plt.subplots(figsize=(6, 4))
    x = np.linspace(0.001, 0.999, points)
    y = scipy_beta.pdf(x, alpha, beta_param)
    ax.plot(x, y, color="#c9a961", linewidth=2)
    ax.fill_between(x, y, alpha=0.2, color="#c9a961")
    ax.set_xlabel("reputation = α / (α + β)")
    ax.set_ylabel("density")
    ax.set_title(f"Beta({alpha:.1f}, {beta_param:.1f})")
    ax.set_xlim(0, 1)
    return fig


def decay_trajectory(
    trace: ReputationTrace, peer_id: str, *, half_life_ns: int = 10_000_000_000,
) -> Figure:
    """α(t), β(t), and reputation = α/(α+β) for one peer over time."""
    series = trace.series(peer_id)
    if not series:
        fig, ax = plt.subplots(figsize=(8, 3))
        ax.text(0.5, 0.5, f"no data for {peer_id!r}", ha="center", va="center")
        return fig
    ts = np.array([s[0] / 1e9 for s in series])
    alphas = np.array([s[1] for s in series])
    betas = np.array([s[2] for s in series])
    rep = alphas / (alphas + betas)
    fig, (ax_ab, ax_r) = plt.subplots(2, 1, figsize=(8, 5), sharex=True)
    ax_ab.plot(ts, alphas, label="α", color="#7a9b5e")
    ax_ab.plot(ts, betas, label="β", color="#d4583a")
    ax_ab.set_ylabel("α, β")
    ax_ab.legend(loc="upper left")
    ax_ab.set_title(f"{peer_id} — Beta evidence (half-life {half_life_ns / 1e9:.1f}s)")
    ax_r.plot(ts, rep, color="#c9a961", linewidth=2)
    ax_r.axhline(0.5, color="#5a5a69", linestyle=":", linewidth=1)
    ax_r.axhline(0.4, color="#d4583a", linestyle=":", linewidth=1, label="0.4 detect")
    ax_r.set_ylabel("reputation")
    ax_r.set_xlabel("t (s)")
    ax_r.set_ylim(0, 1)
    ax_r.legend(loc="lower left")
    return fig


def reputation_sparkline(
    trace: ReputationTrace, peers: Sequence[str], *, window_s: float = 10.0,
) -> Figure:
    """Compact sparkline panel: one line per peer, reputation over the
    last `window_s` seconds. Mirrors the demo's `draw_history_overlay`."""
    fig, ax = plt.subplots(figsize=(6, 2))
    palette = ["#7a9b5e", "#c9a961", "#5a8cc8", "#bc78bc", "#d4583a"]
    latest_t = 0.0
    for peer in peers:
        series = trace.series(peer)
        if not series:
            continue
        latest_t = max(latest_t, series[-1][0] / 1e9)
    cutoff = max(0.0, latest_t - window_s)
    for idx, peer in enumerate(peers):
        series = [s for s in trace.series(peer) if s[0] / 1e9 >= cutoff]
        if len(series) < 2:
            continue
        ts = np.array([s[0] / 1e9 for s in series])
        rep = np.array([s[1] / (s[1] + s[2]) for s in series])
        ax.plot(ts, rep, color=palette[idx % len(palette)], linewidth=1, label=peer)
    ax.set_ylim(0, 1)
    ax.set_xlabel("t (s)")
    ax.axhline(0.5, color="#5a5a69", linestyle=":", linewidth=0.5)
    ax.legend(loc="lower left", fontsize=7, ncol=min(3, max(1, len(peers))))
    ax.set_title(f"reputation (last {window_s:.0f}s)")
    return fig


# ── Voting + triangulation ─────────────────────────────────────────────────


def cohort_timeline(events: Sequence[CohortEvent]) -> Figure:
    """One row per `subject_id`; each cohort closure plotted as a tick on a
    time axis. Fired votes are filled markers; abstain are open. Notebook 04
    illustrates the cohort-close gating that fixed the colluder bug."""
    fig, ax = plt.subplots(figsize=(8, max(2, 0.4 * len({e.subject_id for e in events}) + 1)))
    if not events:
        ax.text(0.5, 0.5, "no cohort events", ha="center", va="center")
        return fig
    subjects = sorted({e.subject_id for e in events})
    sub_y = {s: i for i, s in enumerate(subjects)}
    for e in events:
        marker = "o" if e.fired else "o"
        face = "#7a9b5e" if e.fired else "white"
        edge = "#7a9b5e" if e.fired else "#5a5a69"
        ax.scatter(
            e.timestamp_ns / 1e9, sub_y[e.subject_id],
            marker=marker, c=face, edgecolors=edge, s=40, linewidths=1.2,
        )
    ax.set_yticks(list(sub_y.values()))
    ax.set_yticklabels(subjects)
    ax.set_xlabel("t (s)")
    ax.set_title("cohort closures (filled = vote fired, open = abstain)")
    ax.grid(True, axis="x", linestyle=":", alpha=0.3)
    return fig


def triangulation_2d(
    pending: dict[tuple[str, int], list[tuple[str, float]]],
    observer_positions: dict[str, tuple[float, float]] | None = None,
) -> Figure:
    """Plot an open cohort as range-circles around each observer (ADR 0015 —
    range-only voting). The subject lies on the intersection of all observers'
    range circles. `observer_positions` are taken from sim ground-truth or
    each evaluator's local view (passed in by the notebook). When omitted,
    only the cohort summary text is rendered.

    Wave 1 simplification: render circles only if positions supplied;
    otherwise emit a summary plot showing range histogram.
    """
    fig, ax = plt.subplots(figsize=(6, 6))
    if not pending:
        ax.text(0.5, 0.5, "no pending cohorts", ha="center", va="center")
        return fig
    key, claims = next(iter(pending.items()))
    subject_id, ts_ns = key
    if observer_positions is not None:
        for obs_id, range_m in claims:
            pos = observer_positions.get(obs_id)
            if pos is None:
                continue
            ax.plot(*pos, "o", color="#5a8cc8", markersize=8)
            ax.annotate(obs_id, pos, xytext=(6, 6), textcoords="offset points", fontsize=8)
            circle = plt.Circle(pos, range_m, fill=False, color="#5a8cc8", alpha=0.4)
            ax.add_patch(circle)
        ax.set_aspect("equal")
        ax.set_title(
            f"cohort {subject_id} @ t={ts_ns / 1e9:.2f}s — "
            f"{len(claims)} observers' range circles"
        )
    else:
        ranges = [r for _, r in claims]
        ax.bar(range(len(ranges)), ranges, color="#5a8cc8")
        ax.set_xticks(range(len(ranges)))
        ax.set_xticklabels([obs_id for obs_id, _ in claims], rotation=45, ha="right")
        ax.set_ylabel("range (m)")
        ax.set_title(
            f"cohort {subject_id} @ t={ts_ns / 1e9:.2f}s — {len(claims)} observer ranges"
        )
    return fig


# ── SLAM ──────────────────────────────────────────────────────────────────


def slam_trajectory_overlay(
    truth: Sequence[tuple[float, float]],
    dr: Sequence[tuple[float, float]] | None = None,
    scan: Sequence[tuple[float, float]] | None = None,
) -> Figure:
    """Trajectory comparison: truth (solid) + dead-reckoning (dotted) +
    scan-match (dashed). The 12.95m → 0.5m drift bound at 200 ticks for
    bouncing-walls is the headline claim of notebook 06."""
    fig, ax = plt.subplots(figsize=(8, 6))
    if truth:
        tx, ty = zip(*truth, strict=False)
        ax.plot(tx, ty, color="#5a5a69", linewidth=2, label="truth")
    if dr:
        dx, dy = zip(*dr, strict=False)
        ax.plot(dx, dy, color="#d4583a", linestyle=":", linewidth=1.5, label="dead-reckoning")
    if scan:
        sx, sy = zip(*scan, strict=False)
        ax.plot(sx, sy, color="#7a9b5e", linestyle="--", linewidth=1.5, label="scan-match")
    ax.set_aspect("equal")
    ax.set_xlabel("x (m)")
    ax.set_ylabel("y (m)")
    ax.legend(loc="best")
    ax.set_title("SLAM trajectory comparison")
    return fig


def radial_flow_diagram(
    matched_pairs: Sequence[tuple[float, float, float, float]],
    *,
    pose: Pose | None = None,
) -> Figure:
    """Visualize matched beams between two consecutive lidar scans. Each
    matched ray is drawn from origin at `prev_r` (gray) to `curr_r` (green)
    along the same body-frame angle; the Δr arrow shows the radial flow."""
    fig, ax = plt.subplots(figsize=(6, 6))
    if not matched_pairs:
        ax.text(0.5, 0.5, "no matched pairs", ha="center", va="center")
        return fig
    for angle, prev_r, curr_r, _delta_r in matched_pairs:
        cos_a, sin_a = float(np.cos(angle)), float(np.sin(angle))
        ax.plot(
            [prev_r * cos_a, curr_r * cos_a],
            [prev_r * sin_a, curr_r * sin_a],
            color="#c9a961", linewidth=0.5, alpha=0.6,
        )
        ax.plot(prev_r * cos_a, prev_r * sin_a, ".", color="#5a5a69", markersize=3)
        ax.plot(curr_r * cos_a, curr_r * sin_a, ".", color="#7a9b5e", markersize=3)
    ax.plot(0, 0, "o", color="#d4583a", markersize=6, label="agent")
    ax.set_aspect("equal")
    ax.legend(loc="best")
    pose_label = ""
    if pose is not None:
        pose_label = f" @ ({pose.x:.1f}, {pose.y:.1f})"
    ax.set_title(f"radial flow: prev (gray) → curr (green){pose_label}")
    return fig


# ── Map merger ────────────────────────────────────────────────────────────


def merge_three_panel(
    occ: Sequence[Sequence[float]],
    free: Sequence[Sequence[float]],
    binary_grid: Sequence[Sequence[int]],
) -> Figure:
    """Three-panel heatmap: occupied-vote weights / free-vote weights /
    binary `occ > free` decision. Reveals the merger's voting mechanism
    (notebook 07)."""
    occ_arr = np.array(occ).T
    free_arr = np.array(free).T
    bin_arr = np.array(binary_grid).T
    fig, axes = plt.subplots(1, 3, figsize=(15, 5))
    axes[0].imshow(occ_arr, origin="lower", cmap="Reds", aspect="equal")
    axes[0].set_title("occupied votes")
    axes[1].imshow(free_arr, origin="lower", cmap="Greens", aspect="equal")
    axes[1].set_title("free votes")
    axes[2].imshow(bin_arr, origin="lower", cmap="Greys", aspect="equal")
    axes[2].set_title("binary (occ > free)")
    for ax in axes:
        ax.set_xlabel("x cell")
        ax.set_ylabel("y cell")
    return fig


def merge_side_by_side(
    weighted_binary: Sequence[Sequence[int]],
    uniform_binary: Sequence[Sequence[int]],
) -> Figure:
    """Side-by-side: trust-weighted merge (`peer_weights={liar:0.1}`) vs.
    uniform-weight merge under the same adversarial fragments. Notebook 07
    uses this to demonstrate the load-bearing role of the trust scalar."""
    w_arr = np.array(weighted_binary).T
    u_arr = np.array(uniform_binary).T
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    axes[0].imshow(w_arr, origin="lower", cmap="Greens", aspect="equal")
    axes[0].set_title("trust-weighted (peer_weights={liar: 0.1})")
    axes[1].imshow(u_arr, origin="lower", cmap="Reds", aspect="equal")
    axes[1].set_title("uniform weights — precision collapses")
    for ax in axes:
        ax.set_xlabel("x cell")
        ax.set_ylabel("y cell")
    return fig


# ── Battery tour ──────────────────────────────────────────────────────────


def rep_smallmultiples(
    traces_by_scenario: dict[str, dict[str, ReputationTrace]],
    target_peers: dict[str, str],
    *,
    threshold: float = 0.4,
    cols: int = 4,
) -> Figure:
    """Small-multiples grid: rep(t) for each scenario in
    `traces_by_scenario`. `target_peers[scenario]` is the attacker whose
    trajectory should drop below `threshold`; honest peers are shown as a
    light band (mean ± span). Notebook 08 calls this once for the full
    12-scenario tour."""
    scenarios = list(traces_by_scenario.keys())
    n = len(scenarios)
    rows = max(1, (n + cols - 1) // cols)
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 2.2), squeeze=False)
    for idx, scenario_name in enumerate(scenarios):
        ax = axes[idx // cols][idx % cols]
        per_viewer = traces_by_scenario[scenario_name]
        target = target_peers.get(scenario_name)
        # Plot honest peer band: for each peer not the target, the median
        # trajectory across viewers.
        peers = set()
        for tr in per_viewer.values():
            peers.update(tr.peers())
        honest_peers = peers - {target} if target else peers
        for peer in honest_peers:
            samples: list[tuple[float, float]] = []
            for tr in per_viewer.values():
                for t_ns, a, b in tr.series(peer):
                    samples.append((t_ns / 1e9, a / (a + b)))
            if len(samples) < 2:
                continue
            samples.sort()
            ts = [s[0] for s in samples]
            rep = [s[1] for s in samples]
            ax.plot(ts, rep, color="#7a9b5e", alpha=0.15, linewidth=0.8)
        # Plot the attacker prominently.
        if target:
            atk_samples: list[tuple[float, float]] = []
            for tr in per_viewer.values():
                for t_ns, a, b in tr.series(target):
                    atk_samples.append((t_ns / 1e9, a / (a + b)))
            if atk_samples:
                atk_samples.sort()
                ts = [s[0] for s in atk_samples]
                rep = [s[1] for s in atk_samples]
                ax.plot(ts, rep, color="#d4583a", linewidth=1.2, label=f"{target} (attacker)")
        ax.axhline(threshold, color="#5a5a69", linestyle=":", linewidth=0.8)
        ax.set_ylim(0, 1)
        ax.set_title(scenario_name, fontsize=9)
        ax.tick_params(labelsize=7)
    # Hide unused panels
    for k in range(n, rows * cols):
        axes[k // cols][k % cols].axis("off")
    fig.tight_layout()
    return fig
