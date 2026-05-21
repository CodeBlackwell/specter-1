"""Unit tests for `OccupancyMapMerger` and `detect_loop_closure`.

Fragments are constructed directly here (no SLAM in the loop) so the
merger and loop-closure logic are tested in isolation from sensor /
SLAM noise. End-to-end coverage lives in
``tests/eval/test_map_convergence.py``.
"""

import json
import math

from specter.slam import OccupancyMapMerger, detect_loop_closure, encode_fragment
from specter.slam.map_merger import fragment_from_slam
from specter.slam.local import DeadReckoningSlam
from specter.sim.world import box_world
from specter.types import IMUSample, Pose, RangeMeasurement

from tests._helpers import box_walls, decode_grid, scans_against_walls


# --- US-010: OccupancyMapMerger ---


def test_merge_four_honest_fragments_recovers_box_walls():
    world = box_world(8.0, 8.0)
    poses = [
        Pose(x=2.0, y=2.0, theta=0.0, t=0.0),
        Pose(x=6.0, y=2.0, theta=0.0, t=0.0),
        Pose(x=2.0, y=6.0, theta=0.0, t=0.0),
        Pose(x=6.0, y=6.0, theta=0.0, t=0.0),
    ]
    fragments = [
        encode_fragment(f"agent_{k}", p, scans_against_walls(p, world.walls))
        for k, p in enumerate(poses)
    ]
    merger = OccupancyMapMerger(width_m=8.0, height_m=8.0, resolution_m=0.2)
    grid = decode_grid(merger.merge(fragments))

    cells = grid["cells"]
    nx, ny = grid["width"], grid["height"]

    # Each wall edge should have at least one occupied cell within ½-cell tolerance
    # of its midpoint at the resolution boundary.
    assert _has_occupied_in_row(cells, nx, j=0)  # bottom wall
    assert _has_occupied_in_row(cells, nx, j=ny - 1)  # top wall
    assert _has_occupied_in_col(cells, ny, i=0)  # left wall
    assert _has_occupied_in_col(cells, ny, i=nx - 1)  # right wall
    # Interior should be mostly free (at least one interior cell off).
    assert cells[nx // 2][ny // 2] == 0


def test_low_rep_liar_does_not_corrupt_merged_map():
    world = box_world(8.0, 8.0)
    honest_poses = {
        "alpha": Pose(x=2.0, y=2.0, theta=0.0, t=0.0),
        "bravo": Pose(x=6.0, y=2.0, theta=0.0, t=0.0),
        "charlie": Pose(x=2.0, y=6.0, theta=0.0, t=0.0),
    }
    fragments = [
        encode_fragment(aid, p, scans_against_walls(p, world.walls))
        for aid, p in honest_poses.items()
    ]
    # Liar at (6, 6) reports walls offset by 2m inward (fake walls at x=2, y=2 lines).
    # The liar repeats its fragment 5x to model an aggressive attacker so the
    # uniform-merge contrast is unambiguous; trust weighting must still suppress it.
    fake_walls = box_walls(0.0, 8.0, 0.0, 8.0, dx=2.0, dy=2.0)
    liar_pose = Pose(x=6.0, y=6.0, theta=0.0, t=0.0)
    liar_scans = scans_against_walls(liar_pose, fake_walls)
    fragments.extend(
        encode_fragment("delta", liar_pose, liar_scans) for _ in range(5)
    )

    weights = {"alpha": 1.0, "bravo": 1.0, "charlie": 1.0, "delta": 0.1}
    merger = OccupancyMapMerger(
        width_m=8.0, height_m=8.0, resolution_m=0.2, peer_weights=weights
    )
    grid = decode_grid(merger.merge(fragments))
    cells = grid["cells"]
    nx, ny = grid["width"], grid["height"]

    # Wall cells preserved
    assert _has_occupied_in_row(cells, nx, j=0)
    assert _has_occupied_in_row(cells, nx, j=ny - 1)
    assert _has_occupied_in_col(cells, ny, i=0)
    assert _has_occupied_in_col(cells, ny, i=nx - 1)
    # Liar's fake-wall lines (x=2 → col 10, y=2 → row 10 at res 0.2) suppressed
    fake_col = int(2.0 / 0.2)
    fake_row = int(2.0 / 0.2)
    assert _occupied_count_in_col(cells, ny, fake_col) <= 2
    assert _occupied_count_in_row(cells, nx, fake_row) <= 2


def test_merge_skips_fragments_without_pose():
    fragments = [
        json.dumps({"agent_id": "alpha", "t": 0.0, "scans": []}).encode(),
    ]
    merger = OccupancyMapMerger(width_m=4.0, height_m=4.0, resolution_m=0.5)
    grid = decode_grid(merger.merge(fragments))
    assert all(c == 0 for col in grid["cells"] for c in col)


def test_merge_grid_dimensions_and_resolution_round_trip():
    merger = OccupancyMapMerger(width_m=5.0, height_m=3.0, resolution_m=0.5)
    grid = decode_grid(merger.merge([]))
    assert grid["resolution"] == 0.5
    assert grid["width"] == 10
    assert grid["height"] == 6


def test_zero_weight_peer_contributes_nothing():
    world = box_world(4.0, 4.0)
    pose = Pose(x=2.0, y=2.0, theta=0.0, t=0.0)
    fragment = encode_fragment("alpha", pose, scans_against_walls(pose, world.walls))
    merger = OccupancyMapMerger(
        width_m=4.0, height_m=4.0, resolution_m=0.2,
        peer_weights={"alpha": 0.0},
    )
    grid = decode_grid(merger.merge([fragment]))
    assert all(c == 0 for col in grid["cells"] for c in col)


def test_fragment_from_slam_round_trips_pose_and_scans():
    init = Pose(x=1.0, y=2.0, theta=0.5, t=0.0)
    slam = DeadReckoningSlam("alpha", init, dt=0.05)
    scans = [RangeMeasurement(angle=0.0, distance=1.5, t=0.0)]
    slam.update(scans, IMUSample(ax=0.0, ay=0.0, omega=0.0, t=0.05))
    fragment = json.loads(fragment_from_slam(slam, scans))
    assert fragment["agent_id"] == "alpha"
    assert fragment["pose"]["x"] == slam.pose().x
    assert fragment["pose"]["y"] == slam.pose().y
    assert fragment["pose"]["theta"] == slam.pose().theta
    assert fragment["scans"][0]["distance"] == 1.5


# --- US-013: detect_loop_closure ---


def _build_known_box_map(width: float = 8.0, res: float = 0.2) -> bytes:
    world = box_world(width, width)
    poses = [
        Pose(x=2.0, y=2.0, theta=0.0, t=0.0),
        Pose(x=6.0, y=2.0, theta=0.0, t=0.0),
        Pose(x=2.0, y=6.0, theta=0.0, t=0.0),
        Pose(x=6.0, y=6.0, theta=0.0, t=0.0),
    ]
    fragments = [
        encode_fragment(f"agent_{k}", p, scans_against_walls(p, world.walls))
        for k, p in enumerate(poses)
    ]
    merger = OccupancyMapMerger(width_m=width, height_m=width, resolution_m=res)
    return merger.merge(fragments)


def test_loop_closure_fires_when_scan_matches_known_map():
    merged = _build_known_box_map()
    pose = Pose(x=4.0, y=4.0, theta=0.0, t=0.0)
    world = box_world(8.0, 8.0)
    scans = scans_against_walls(pose, world.walls)
    assert detect_loop_closure(scans, pose, merged, threshold_m=0.4)


def test_loop_closure_silent_when_pose_offset_from_truth():
    merged = _build_known_box_map()
    true_pose = Pose(x=4.0, y=4.0, theta=0.0, t=0.0)
    world = box_world(8.0, 8.0)
    scans = scans_against_walls(true_pose, world.walls)
    # Predict from a 2m-offset pose using scans from the true pose: endpoints
    # land 2m off the wall, where no occupied cells live.
    offset_pose = Pose(x=true_pose.x + 2.0, y=true_pose.y + 2.0, theta=0.0, t=0.0)
    assert not detect_loop_closure(scans, offset_pose, merged, threshold_m=0.3)


def test_loop_closure_silent_when_scan_is_all_dropouts():
    merged = _build_known_box_map()
    pose = Pose(x=4.0, y=4.0, theta=0.0, t=0.0)
    scans = [
        RangeMeasurement(angle=i * math.pi / 18, distance=math.inf, t=0.0)
        for i in range(36)
    ]
    assert not detect_loop_closure(scans, pose, merged)


# --- helpers ---


def _has_occupied_in_row(cells, nx, j):
    return any(cells[i][j] for i in range(nx))


def _has_occupied_in_col(cells, ny, i):
    return any(cells[i][j] for j in range(ny))


def _occupied_count_in_col(cells, ny, i):
    if not 0 <= i < len(cells):
        return 0
    return sum(cells[i][j] for j in range(ny))


def _occupied_count_in_row(cells, nx, j):
    return sum(cells[i][j] for i in range(nx))
