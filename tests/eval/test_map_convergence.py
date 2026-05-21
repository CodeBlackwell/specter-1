"""End-to-end map-convergence evals for `OccupancyMapMerger`.

US-011: 4 honest peers running `ScanMatchSlam` for 200 ticks; the merged
grid must recover the box-world walls (recall ≥ 90%, precision ≥ 95%).

US-012: 3 honest + 1 liar (offset-2m fake walls). With trust weighting
the merged map still matches honest ground truth (recall ≥ 85%,
precision ≥ 90%); without weighting, the liar materially corrupts the
output (recall < 60% OR precision < 70%) — the contrast is the load-
bearing claim of trust-weighted fusion.
"""

import math

import pytest

from specter.sim.scenario import load_scenario
from specter.sim.sensors import lidar_scan
from specter.sim.world import Wall, World
from specter.slam import OccupancyMapMerger, ScanMatchSlam, encode_fragment
from specter.types import Pose

from tests._helpers import box_walls, decode_grid, scans_against_walls

SCENARIO = "scenarios/four_corners.yaml"
N_TICKS = 200
# 0.2 m/cell × 144-beam lidar fills wall cells densely enough for ≥90% recall
# at a 4-agent cluster. Finer res (0.1) undercounts because beam angular
# spacing exceeds cell angular subtend at typical wall distances; coarser
# (0.4) papers over the precision/recall trade-off the merger is supposed
# to expose.
RES = 0.2
N_BEAMS = 120


def _run_honest(n_ticks: int = N_TICKS) -> tuple[list[bytes], World]:
    sim, _ = load_scenario(SCENARIO)
    slam = {
        a.id: ScanMatchSlam(
            agent_id=a.id,
            init_pose=Pose(x=a.x, y=a.y, theta=a.theta, t=0.0),
            dt=sim.dt,
            init_velocity=(a.vx, a.vy),
        )
        for a in sim.agents
    }
    fragments: list[bytes] = []
    for _ in range(n_ticks):
        tick = sim.tick()
        for a in tick.agents:
            scans = list(lidar_scan(a, sim.world, sim.rng, sim.t, n_beams=N_BEAMS))
            slam[a.id].update(scans, tick.imu[a.id])
            fragments.append(encode_fragment(a.id, slam[a.id].pose(), scans))
    return fragments, sim.world


def _true_wall_cells(world: World, nx: int, ny: int) -> set[tuple[int, int]]:
    """Cells whose interior or boundary intersects a wall segment."""
    cells: set[tuple[int, int]] = set()
    for w in world.walls:
        for cell in _rasterize_segment(w, nx, ny):
            cells.add(cell)
    return cells


def _rasterize_segment(w: Wall, nx: int, ny: int) -> list[tuple[int, int]]:
    """Walk a wall segment in 0.5-cell steps, mark the cells it passes through.

    Bounding the segment endpoints to the grid keeps the raster within
    [0, nx-1] × [0, ny-1] for walls on the grid edge."""
    dx = w.x2 - w.x1
    dy = w.y2 - w.y1
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return []
    steps = max(2, int(length / (RES * 0.5)))
    out: list[tuple[int, int]] = []
    for k in range(steps + 1):
        x = w.x1 + (k / steps) * dx
        y = w.y1 + (k / steps) * dy
        i = max(0, min(nx - 1, int(x / RES)))
        j = max(0, min(ny - 1, int(y / RES)))
        out.append((i, j))
    return out


def _occupied_cells(grid_cells: list[list[int]]) -> set[tuple[int, int]]:
    return {
        (i, j)
        for i, col in enumerate(grid_cells)
        for j, v in enumerate(col)
        if v
    }


def _scoreboard(true_cells: set, merged_cells: set) -> tuple[float, float]:
    if not true_cells:
        return 0.0, 0.0
    tp = len(true_cells & merged_cells)
    recall = tp / len(true_cells)
    precision = tp / len(merged_cells) if merged_cells else 0.0
    return recall, precision


# --- fixtures: cache the simulation runs and the merged grids ---


@pytest.fixture(scope="module")
def honest_run():
    return _run_honest()


@pytest.fixture(scope="module")
def liar_run():
    return _run_with_liar()


@pytest.fixture(scope="module")
def liar_uniform_grid(liar_run):
    fragments, world, _ = liar_run
    merger = OccupancyMapMerger(width_m=world.width, height_m=world.height, resolution_m=RES)
    return decode_grid(merger.merge(fragments)), world


@pytest.fixture(scope="module")
def liar_trusted_grid(liar_run):
    fragments, world, liar_id = liar_run
    merger = OccupancyMapMerger(
        width_m=world.width, height_m=world.height, resolution_m=RES,
        peer_weights={liar_id: 0.1},
    )
    return decode_grid(merger.merge(fragments)), world


# --- US-011 ---


def test_honest_swarm_merged_map_converges_to_box_walls(honest_run):
    fragments, world = honest_run
    merger = OccupancyMapMerger(width_m=world.width, height_m=world.height, resolution_m=RES)
    grid = decode_grid(merger.merge(fragments))
    nx, ny = grid["width"], grid["height"]
    true_cells = _true_wall_cells(world, nx, ny)
    merged_cells = _occupied_cells(grid["cells"])
    recall, precision = _scoreboard(true_cells, merged_cells)
    assert recall >= 0.90, f"recall {recall:.3f} < 0.90 ({len(true_cells)=}, tp={len(true_cells & merged_cells)})"
    assert precision >= 0.95, f"precision {precision:.3f} < 0.95 ({len(merged_cells)=}, fp={len(merged_cells - true_cells)})"


# --- US-012 ---


def _liar_fragments(
    real_world: World,
    n_ticks: int = N_TICKS,
    liar_id: str = "delta",
    multiplier: int = 10,
) -> list[bytes]:
    """Synthetic liar fragments: ray-cast against an offset wall set so
    the liar's reported geometry matches walls at +2m relative to real.

    The liar walks a 4×4 grid of poses across the world, spreading its
    fake-wall votes over many cells (otherwise a single-pose liar plants
    a tight cluster of FPs that uniform merging tolerates above the 70%
    precision floor). `multiplier` models an aggressive attacker that
    floods the bus with repeated copies per tick — the kind of asymmetry
    trust weighting has to compensate for.
    """
    fake_walls = box_walls(0.0, real_world.width, 0.0, real_world.height, 2.0, 2.0)
    poses = [
        Pose(x=2.0 + 1.0 * (k % 4), y=2.0 + 1.0 * ((k // 4) % 4), theta=0.0, t=0.0)
        for k in range(16)
    ]
    fragments: list[bytes] = []
    for tick in range(n_ticks):
        liar_pose = poses[tick % len(poses)]
        scans = scans_against_walls(liar_pose, fake_walls, n_beams=N_BEAMS)
        for _ in range(multiplier):
            fragments.append(encode_fragment(liar_id, liar_pose, scans))
    return fragments


def _run_with_liar(n_ticks: int = N_TICKS) -> tuple[list[bytes], World, str]:
    """Honest 4-agent run, then drop one peer's fragments and substitute
    the liar's offset-walls fragments. Returns (fragments, world, liar_id).
    """
    liar_id = "delta"
    sim, _ = load_scenario(SCENARIO)
    slam = {
        a.id: ScanMatchSlam(
            agent_id=a.id,
            init_pose=Pose(x=a.x, y=a.y, theta=a.theta, t=0.0),
            dt=sim.dt,
            init_velocity=(a.vx, a.vy),
        )
        for a in sim.agents
    }
    fragments: list[bytes] = []
    for _ in range(n_ticks):
        tick = sim.tick()
        for a in tick.agents:
            scans = list(lidar_scan(a, sim.world, sim.rng, sim.t, n_beams=N_BEAMS))
            slam[a.id].update(scans, tick.imu[a.id])
            if a.id == liar_id:
                continue  # honest fragments dropped; replaced by liar's
            fragments.append(encode_fragment(a.id, slam[a.id].pose(), scans))
    fragments.extend(_liar_fragments(sim.world, n_ticks=n_ticks, liar_id=liar_id))
    return fragments, sim.world, liar_id


def test_trust_weighted_merge_resists_low_rep_liar(liar_trusted_grid):
    grid, world = liar_trusted_grid
    nx, ny = grid["width"], grid["height"]
    true_cells = _true_wall_cells(world, nx, ny)
    recall, precision = _scoreboard(true_cells, _occupied_cells(grid["cells"]))
    assert recall >= 0.85, f"trust-weighted recall {recall:.3f} < 0.85"
    assert precision >= 0.90, f"trust-weighted precision {precision:.3f} < 0.90"


def test_uniform_merge_with_liar_materially_degrades(liar_uniform_grid):
    grid, world = liar_uniform_grid
    nx, ny = grid["width"], grid["height"]
    true_cells = _true_wall_cells(world, nx, ny)
    merged_cells = _occupied_cells(grid["cells"])
    recall, precision = _scoreboard(true_cells, merged_cells)
    # Uniform weighting must show the liar materially corrupts the map.
    assert recall < 0.60 or precision < 0.70, (
        f"uniform merge undamaged: recall={recall:.3f} precision={precision:.3f} "
        "— liar should have corrupted at least one metric below threshold"
    )


def test_trust_weighting_strictly_beats_uniform(liar_uniform_grid, liar_trusted_grid):
    u_grid, world = liar_uniform_grid
    t_grid, _ = liar_trusted_grid
    nx, ny = u_grid["width"], u_grid["height"]
    true_cells = _true_wall_cells(world, nx, ny)
    u_recall, u_prec = _scoreboard(true_cells, _occupied_cells(u_grid["cells"]))
    t_recall, t_prec = _scoreboard(true_cells, _occupied_cells(t_grid["cells"]))
    assert t_prec >= u_prec, f"trust precision {t_prec:.3f} < uniform {u_prec:.3f}"
    assert t_recall + t_prec > u_recall + u_prec, (
        f"trust merge no better than uniform: trust=({t_recall:.3f},{t_prec:.3f}) "
        f"uniform=({u_recall:.3f},{u_prec:.3f})"
    )


