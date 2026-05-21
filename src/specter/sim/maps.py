"""Wave 4 — Map presets + beacon layout factory (Python parity of TS sim-core
`ui/packages/sim-core/src/maps.ts`).

Named arenas with bounds + beacon-placement helpers. Bounds are centered on
(0, 0): `xmin = -width/2`, `xmax = +width/2`, same for y. Constants and step
formulas mirror the TS module byte-for-byte so the Free Play Compose card can
preview the same layout the worker simulates.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

BeaconLayoutName = Literal["perimeter", "corners", "dense", "custom"]


@dataclass(frozen=True)
class MapSize:
    width: float
    height: float


@dataclass(frozen=True)
class MapPreset:
    id: str
    label: str
    size_m: MapSize
    default_beacon_layout: BeaconLayoutName
    default_beacon_count: int


@dataclass(frozen=True)
class MapBounds:
    xmin: float
    ymin: float
    xmax: float
    ymax: float


MAP_PRESETS: tuple[MapPreset, ...] = (
    MapPreset(
        id="WAREHOUSE_40x40",
        label="WAREHOUSE · 40×40m",
        size_m=MapSize(40.0, 40.0),
        default_beacon_layout="perimeter",
        default_beacon_count=4,
    ),
    MapPreset(
        id="WAREHOUSE_60x40",
        label="WAREHOUSE · 60×40m",
        size_m=MapSize(60.0, 40.0),
        default_beacon_layout="perimeter",
        default_beacon_count=6,
    ),
    MapPreset(
        id="OPEN_FIELD_100x100",
        label="OPEN FIELD · 100×100m",
        size_m=MapSize(100.0, 100.0),
        default_beacon_layout="perimeter",
        default_beacon_count=8,
    ),
)


def map_bounds(preset: MapPreset) -> MapBounds:
    half_w = preset.size_m.width / 2.0
    half_h = preset.size_m.height / 2.0
    return MapBounds(xmin=-half_w, ymin=-half_h, xmax=half_w, ymax=half_h)


DENSE_INSET_FRACTION = 0.1


def beacon_layout(
    name: BeaconLayoutName,
    size_m: MapSize,
    count: int,
) -> list[tuple[float, float]]:
    """Beacon coordinates for the given layout, centered on (0, 0).

    - "perimeter" — equally spaced clockwise from top-left, step = 2(w+h)/count
    - "corners"   — always exactly 4 corner points regardless of `count`
    - "dense"     — m×m grid where m = ceil(sqrt(count)), first `count`
                    row-major, inset 10% from edges
    - "custom"    — raises; positions must be supplied externally
    """
    if name == "perimeter":
        return _perimeter(size_m, count)
    if name == "corners":
        return _corners(size_m)
    if name == "dense":
        return _dense(size_m, count)
    if name == "custom":
        raise ValueError("custom layout requires explicit positions")
    raise ValueError(f"unknown beacon layout: {name}")


def _perimeter(size_m: MapSize, count: int) -> list[tuple[float, float]]:
    if count <= 0:
        return []
    w = size_m.width
    h = size_m.height
    half_w = w / 2.0
    half_h = h / 2.0
    perimeter = 2.0 * (w + h)
    step = perimeter / count
    out: list[tuple[float, float]] = []
    for i in range(count):
        d = i * step
        out.append(_perimeter_point(d, w, h, half_w, half_h))
    return out


def _perimeter_point(
    d: float, w: float, h: float, half_w: float, half_h: float
) -> tuple[float, float]:
    if d < w:
        return (-half_w + d, half_h)
    if d < w + h:
        return (half_w, half_h - (d - w))
    if d < 2.0 * w + h:
        return (half_w - (d - w - h), -half_h)
    return (-half_w, -half_h + (d - 2.0 * w - h))


def _corners(size_m: MapSize) -> list[tuple[float, float]]:
    half_w = size_m.width / 2.0
    half_h = size_m.height / 2.0
    return [
        (-half_w, half_h),
        (half_w, half_h),
        (half_w, -half_h),
        (-half_w, -half_h),
    ]


def _dense(size_m: MapSize, count: int) -> list[tuple[float, float]]:
    if count <= 0:
        return []
    m = math.ceil(math.sqrt(count))
    inset_x = size_m.width * DENSE_INSET_FRACTION
    inset_y = size_m.height * DENSE_INSET_FRACTION
    xmin = -size_m.width / 2.0 + inset_x
    xmax = size_m.width / 2.0 - inset_x
    ymin = -size_m.height / 2.0 + inset_y
    ymax = size_m.height / 2.0 - inset_y
    step_x = (xmax - xmin) / (m - 1) if m >= 2 else 0.0
    step_y = (ymax - ymin) / (m - 1) if m >= 2 else 0.0
    out: list[tuple[float, float]] = []
    for i in range(count):
        row = i // m
        col = i % m
        x = xmin + col * step_x if m >= 2 else 0.0
        y = ymin + row * step_y if m >= 2 else 0.0
        out.append((x, y))
    return out
