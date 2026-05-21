"""Radial-flow scan-match SLAM. Bounds xy drift versus the dead-reckoning
slice-1 estimator.

Theta is still gyro-driven. xy now comes from comparing consecutive lidar
scans: for each beam matched between scans, the range change satisfies
``Δr ≈ -(vx_body cos θ + vy_body sin θ) × dt``. Pooling matched beams via
2×2 least-squares (closed-form normal equations) recovers body-frame
velocity, which is rotated to world frame using current theta and
integrated.

Bounces, speed changes, and any held-velocity-assumption error in the
slice-1 estimator are now self-correcting on the next tick.

ADR 0004 records the dead-reckoning choice; this module is the deferred
upgrade. Limitations:

- Assumes lidar features are static (walls). Other agents in the scan
  would corrupt the velocity estimate; current sim's lidar only sees
  walls (`sim/sensors.py:lidar_scan` ignores agents).
- Beam-jump at corners corrupted by the |Δr| > MAX_RANGE_DELTA_M filter.
- Slow rotation assumption: at omega ≪ 1 rad/s, body-frame beam angles
  point at the same world-frame direction tick-over-tick. Faster
  rotation needs Δθ pre-rotation of the previous scan.
"""

import json
import math
from dataclasses import asdict

from ..interfaces import LocalSlam as LocalSlamABC
from ..types import IMUSample, Pose, RangeMeasurement

MAX_RANGE_DELTA_M = 0.5  # skip beam pairs with implausibly large Δr (corner jumps)


class ScanMatchSlam(LocalSlamABC):
    def __init__(
        self,
        agent_id: str,
        init_pose: Pose,
        dt: float,
        init_velocity: tuple[float, float] = (0.0, 0.0),
        record_pairs: bool = False,
    ) -> None:
        self._agent_id = agent_id
        self._x = init_pose.x
        self._y = init_pose.y
        self._theta = init_pose.theta
        self._t = init_pose.t
        self._dt = dt
        self._init_vx, self._init_vy = init_velocity
        self._latest_scans: list[RangeMeasurement] = []
        self._prev_scan: dict[float, float] | None = None  # angle -> distance
        self._record_pairs = record_pairs
        self._matched_pairs: list[tuple[float, float, float, float]] = []

    def update(self, scans: list[RangeMeasurement], imu: IMUSample) -> None:
        self._theta += imu.omega * self._dt
        valid = [m for m in scans if not math.isinf(m.distance)]
        curr: dict[float, float] = {m.angle: m.distance for m in valid}
        collected: list[tuple[float, float, float, float]] | None = (
            [] if self._record_pairs else None
        )
        if self._prev_scan is None:
            # Bootstrap: integrate init velocity for the first tick (no prior scan to match).
            self._x += self._init_vx * self._dt
            self._y += self._init_vy * self._dt
        else:
            vx_body, vy_body = _estimate_body_velocity(
                self._prev_scan, curr, self._dt, collect=collected,
            )
            cos_t, sin_t = math.cos(self._theta), math.sin(self._theta)
            self._x += (vx_body * cos_t - vy_body * sin_t) * self._dt
            self._y += (vx_body * sin_t + vy_body * cos_t) * self._dt
        if collected is not None:
            self._matched_pairs = collected
        self._t = imu.t
        self._latest_scans = valid
        self._prev_scan = curr

    def pose(self) -> Pose:
        return Pose(x=self._x, y=self._y, theta=self._theta, t=self._t)

    def map_fragment(self) -> bytes:
        payload = {
            "agent_id": self._agent_id,
            "t": self._t,
            "scans": [asdict(m) for m in self._latest_scans],
        }
        return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()

    def matched_pairs(self) -> list[tuple[float, float, float, float]]:
        """Pairs `(angle, prev_r, curr_r, delta_r)` matched between the two
        most recent scans, after the |Δr| > MAX_RANGE_DELTA_M filter is
        applied.

        Workshop accessor (notebook 06 radial-flow diagram). Empty when
        `record_pairs=False` (the default — no per-tick allocation cost) or
        before the second scan is observed.
        """
        return list(self._matched_pairs)


def _estimate_body_velocity(
    prev: dict[float, float],
    curr: dict[float, float],
    dt: float,
    *,
    collect: list[tuple[float, float, float, float]] | None = None,
) -> tuple[float, float]:
    """Closed-form 2×2 LSQ for body-frame [vx, vy] from radial flow.

    When `collect` is supplied, surviving `(angle, prev_r, curr_r, delta_r)`
    pairs are appended to it for the workshop's radial-flow visualization.
    """
    sum_cc = sum_cs = sum_ss = sum_cb = sum_sb = 0.0
    for angle, curr_r in curr.items():
        prev_r = prev.get(angle)
        if prev_r is None:
            continue
        delta_r = curr_r - prev_r
        if abs(delta_r) > MAX_RANGE_DELTA_M:
            continue
        if collect is not None:
            collect.append((angle, prev_r, curr_r, delta_r))
        b_i = -delta_r / dt  # b_i = vx_body cos θ + vy_body sin θ
        cos_t, sin_t = math.cos(angle), math.sin(angle)
        sum_cc += cos_t * cos_t
        sum_cs += cos_t * sin_t
        sum_ss += sin_t * sin_t
        sum_cb += cos_t * b_i
        sum_sb += sin_t * b_i
    det = sum_cc * sum_ss - sum_cs * sum_cs
    if abs(det) < 1e-9:
        return (0.0, 0.0)  # degenerate (e.g., all dropouts) — coast
    vx = (sum_ss * sum_cb - sum_cs * sum_sb) / det
    vy = (sum_cc * sum_sb - sum_cs * sum_cb) / det
    return (vx, vy)
