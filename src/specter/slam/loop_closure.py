"""Loop closure detection from a merged occupancy map.

A loop-closure event is the signal that an agent's current scan agrees
with a globally-known occupied region — useful as a bound on long-run
drift via global rather than local correction. This module ships only
the *detection* signal; pose correction is a future slice and would
have to round-trip through the SLAM module that owns pose state.

Algorithm: predict scan endpoints from `pose`; for each non-dropout
endpoint, check whether any cell within `threshold_m` of that point is
marked occupied in the merged grid; return True iff at least
`MATCH_FRACTION` of valid endpoints find such a match. A scan with
fewer than `MIN_VALID_BEAMS` non-dropouts returns False (insufficient
evidence — calling it a loop closure on noise would be worse than
missing one).
"""

import json
import math

from ..types import Pose, RangeMeasurement

MIN_VALID_BEAMS = 3
MATCH_FRACTION = 0.5


def detect_loop_closure(
    scan: list[RangeMeasurement],
    pose: Pose,
    merged_map: bytes,
    threshold_m: float = 0.3,
) -> bool:
    valid = [m for m in scan if math.isfinite(m.distance)]
    if len(valid) < MIN_VALID_BEAMS:
        return False
    grid = json.loads(merged_map)
    cells: list[list[int]] = grid["cells"]
    res: float = float(grid["resolution"])
    nx: int = int(grid["width"])
    ny: int = int(grid["height"])
    radius = max(1, int(math.ceil(threshold_m / res)))
    matches = 0
    for m in valid:
        wa = pose.theta + m.angle
        ex = pose.x + m.distance * math.cos(wa)
        ey = pose.y + m.distance * math.sin(wa)
        ei = int(ex / res)
        ej = int(ey / res)
        if _has_occupied_within(cells, ei, ej, radius, nx, ny):
            matches += 1
    return matches / len(valid) >= MATCH_FRACTION


def _has_occupied_within(
    cells: list[list[int]], ci: int, cj: int, radius: int, nx: int, ny: int
) -> bool:
    for di in range(-radius, radius + 1):
        i = ci + di
        if not 0 <= i < nx:
            continue
        for dj in range(-radius, radius + 1):
            j = cj + dj
            if not 0 <= j < ny:
                continue
            if cells[i][j]:
                return True
    return False
