"""Wave 4 of the Free Play Compose-then-Watch redesign: map presets + beacon
layout factory. Mirrors `ui/packages/sim-core/tests/maps.test.ts` so Python
and TS produce numerically identical bounds + beacon coordinates.
"""

import math

import pytest

from specter.sim.maps import (
    DENSE_INSET_FRACTION,
    MAP_PRESETS,
    MapSize,
    beacon_layout,
    map_bounds,
)

TOL = 1e-9


def _within(b, p) -> bool:
    return b.xmin - TOL <= p[0] <= b.xmax + TOL and b.ymin - TOL <= p[1] <= b.ymax + TOL


def test_map_presets_expose_wave_4_ids_in_order():
    assert [p.id for p in MAP_PRESETS] == [
        "WAREHOUSE_40x40",
        "WAREHOUSE_60x40",
        "OPEN_FIELD_100x100",
    ]


@pytest.mark.parametrize("preset", MAP_PRESETS, ids=[p.id for p in MAP_PRESETS])
def test_default_layout_beacons_fall_within_bounds(preset):
    bounds = map_bounds(preset)
    beacons = beacon_layout(preset.default_beacon_layout, preset.size_m, preset.default_beacon_count)
    assert len(beacons) == preset.default_beacon_count
    for b in beacons:
        assert _within(bounds, b)


def test_map_bounds_centered_on_origin():
    for p in MAP_PRESETS:
        b = map_bounds(p)
        assert math.isclose(b.xmin + b.xmax, 0.0, abs_tol=1e-12)
        assert math.isclose(b.ymin + b.ymax, 0.0, abs_tol=1e-12)
        assert math.isclose(b.xmax - b.xmin, p.size_m.width, abs_tol=1e-12)
        assert math.isclose(b.ymax - b.ymin, p.size_m.height, abs_tol=1e-12)


def _perimeter_arc(p, w, h):
    half_w = w / 2.0
    half_h = h / 2.0
    eps = 1e-9
    if abs(p[1] - half_h) < eps and -half_w - eps <= p[0] <= half_w + eps:
        return p[0] - -half_w
    if abs(p[0] - half_w) < eps:
        return w + (half_h - p[1])
    if abs(p[1] - -half_h) < eps:
        return w + h + (half_w - p[0])
    return 2.0 * w + h + (p[1] - -half_h)


def test_perimeter_gaps_equal_within_float_tolerance():
    size = MapSize(60.0, 40.0)
    count = 8
    pts = beacon_layout("perimeter", size, count)
    assert len(pts) == count
    perim = 2.0 * (size.width + size.height)
    arcs = [_perimeter_arc(p, size.width, size.height) for p in pts]
    gaps = []
    for i in range(count):
        nxt = arcs[i + 1] if i + 1 < count else arcs[0] + perim
        gaps.append(nxt - arcs[i])
    expected = perim / count
    for g in gaps:
        assert math.isclose(g, expected, abs_tol=1e-9)


def test_perimeter_count_4_on_square_lands_exactly_on_corners():
    pts = beacon_layout("perimeter", MapSize(40.0, 40.0), 4)
    assert pts == [(-20.0, 20.0), (20.0, 20.0), (20.0, -20.0), (-20.0, -20.0)]


def test_perimeter_starts_at_top_left_corner():
    pts = beacon_layout("perimeter", MapSize(40.0, 40.0), 4)
    assert math.isclose(pts[0][0], -20.0, abs_tol=1e-12)
    assert math.isclose(pts[0][1], 20.0, abs_tol=1e-12)


@pytest.mark.parametrize("count", [1, 4, 9, 99])
def test_corners_returns_four_corners_regardless_of_count(count):
    size = MapSize(60.0, 40.0)
    pts = beacon_layout("corners", size, count)
    assert len(pts) == 4
    expected = {(-30.0, 20.0), (30.0, 20.0), (30.0, -20.0), (-30.0, -20.0)}
    assert set(pts) == expected


def test_dense_count_9_produces_3x3_grid():
    size = MapSize(100.0, 100.0)
    pts = beacon_layout("dense", size, 9)
    assert len(pts) == 9
    # inset 10%: xmin=-40, xmax=40; step over m-1=2 → 40
    inset = size.width * DENSE_INSET_FRACTION
    assert math.isclose(inset, 10.0)
    expected_xs = [-40.0, 0.0, 40.0]
    expected_ys = [-40.0, 0.0, 40.0]
    for row in range(3):
        for col in range(3):
            p = pts[row * 3 + col]
            assert math.isclose(p[0], expected_xs[col], abs_tol=1e-9)
            assert math.isclose(p[1], expected_ys[row], abs_tol=1e-9)


def test_dense_count_5_stays_within_bounds():
    size = MapSize(40.0, 40.0)
    pts = beacon_layout("dense", size, 5)
    assert len(pts) == 5

    class _B:
        xmin, ymin, xmax, ymax = -20.0, -20.0, 20.0, 20.0

    for p in pts:
        assert _within(_B, p)


def test_custom_throws():
    with pytest.raises(ValueError, match="custom layout requires explicit positions"):
        beacon_layout("custom", MapSize(40.0, 40.0), 4)
