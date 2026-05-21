"""Trust-weighted occupancy-grid map merger.

Fuses per-peer `map_fragment()` outputs into a single occupancy grid. Each
fragment is decoded, scans are ray-cast from the fragment's reported pose,
and cells along each ray accumulate weighted free-votes (cells traversed)
and occupied-votes (endpoint cell). A cell is marked occupied iff its
occupied-vote weight exceeds its free-vote weight.

Trust integration: ``peer_weights[agent_id]`` scales every vote from that
peer. A liar with low rep contributes proportionally less; honest peers'
geometry survives. ADR 0010 records the voting choice.

Fragment payload (extends ``ScanMatchSlam.map_fragment`` with pose):

    {"agent_id": str,
     "t": float,
     "pose": {"x": float, "y": float, "theta": float},
     "scans": [{"angle": float, "distance": float, "t": float}, ...]}

Pose is required; fragments without it are skipped. ``encode_fragment``
helps callers build a merger-compatible payload from a SLAM ``pose()`` +
``map_fragment()``.
"""

import json
import math
from collections.abc import Mapping

from ..interfaces import LocalSlam, MapMerger
from ..types import Pose, RangeMeasurement

# ADR 0022 §6 — singleton-cell defenses mirror the pose-graph treatment.
# Constants live in pose_graph.py; re-imported here to keep them in one place.
from .pose_graph import SINGLETON_INFO_SCALE, T_CORROBORATE, T_FADE


class OccupancyMapMerger(MapMerger):
    def __init__(
        self,
        width_m: float,
        height_m: float,
        resolution_m: float = 0.1,
        peer_weights: Mapping[str, float] | None = None,
    ) -> None:
        self._width_m = width_m
        self._height_m = height_m
        self._res = resolution_m
        self._nx = max(1, int(math.ceil(width_m / resolution_m)))
        self._ny = max(1, int(math.ceil(height_m / resolution_m)))
        self._weights: dict[str, float] = dict(peer_weights or {})
        # ADR 0022 §6 — per-cell persistent state for singleton defenses.
        # Accumulated across merge() calls so a cell only one peer ever
        # reports stays flagged singleton in subsequent merges. Off-by-
        # default: legacy callers pay zero state cost and get byte-exact
        # behavior unchanged.
        self._cell_reporters: dict[tuple[int, int], set[str]] = {}
        self._cell_first_seen: dict[tuple[int, int], int] = {}
        self._current_tick: int | None = None
        self._singleton_cap_enabled: bool = False
        self._singleton_fade_enabled: bool = False

    # ---- ADR 0022 §6 enable / state ---------------------------------------

    def set_current_tick(self, tick: int) -> None:
        """Set the simulation tick the merger treats as "now" for
        stale-singleton fade. Deterministic — no wall-clock dependence."""
        self._current_tick = tick

    def enable_singleton_cap(self, enable: bool = True) -> None:
        """Enable the singleton confidence cap on cells whose accumulated
        reporter set has cardinality 1 (ADR 0022 §6). Off by default."""
        self._singleton_cap_enabled = enable

    def enable_singleton_fade(self, enable: bool = True) -> None:
        """Enable stale-singleton fade: a cell whose first-seen tick is
        more than T_CORROBORATE behind the current tick decays linearly
        toward zero over T_FADE more ticks. Requires the cap to be on."""
        self._singleton_fade_enabled = enable

    def cell_reporters(self) -> dict[tuple[int, int], set[str]]:
        """Copy of the per-cell reporter set, for inspection/debugging."""
        return {k: set(v) for k, v in self._cell_reporters.items()}

    def merge(self, fragments: list[bytes], *, tick: int | None = None) -> bytes:
        if tick is not None:
            self._current_tick = tick
        occ, free = self._compute_votes(fragments)
        self._apply_singleton_scale(occ, free)
        return self._encode_binary(occ, free)

    def merge_with_votes(
        self, fragments: list[bytes], *, tick: int | None = None
    ) -> tuple[bytes, list[list[float]], list[list[float]]]:
        """Like `merge()` but also returns the underlying free-vote and
        occupied-vote weight grids used to compute the binary decision.

        Workshop accessor (notebook 07 three-panel heatmap). Returns
        `(binary_bytes, occ_grid, free_grid)` where the grids are
        `[width][height]` lists of accumulated weights.
        """
        if tick is not None:
            self._current_tick = tick
        occ, free = self._compute_votes(fragments)
        self._apply_singleton_scale(occ, free)
        return self._encode_binary(occ, free), occ, free

    def _compute_votes(
        self, fragments: list[bytes]
    ) -> tuple[list[list[float]], list[list[float]]]:
        occ = [[0.0] * self._ny for _ in range(self._nx)]
        free = [[0.0] * self._ny for _ in range(self._nx)]
        track = self._singleton_cap_enabled  # only pay the bookkeeping cost when needed
        for raw in fragments:
            payload = json.loads(raw)
            pose = payload.get("pose")
            if pose is None:
                continue  # merger needs pose to ray-cast; skip silently
            agent_id = payload["agent_id"]
            weight = self._weights.get(agent_id, 1.0)
            if weight <= 0.0:
                continue
            px = float(pose["x"])
            py = float(pose["y"])
            ptheta = float(pose["theta"])
            for s in payload.get("scans", ()):
                d = float(s["distance"])
                if not math.isfinite(d):
                    continue
                wa = ptheta + float(s["angle"])
                ex = px + d * math.cos(wa)
                ey = py + d * math.sin(wa)
                self._cast(px, py, ex, ey, weight, occ, free, agent_id, track)
        return occ, free

    def _apply_singleton_scale(
        self, occ: list[list[float]], free: list[list[float]]
    ) -> None:
        """ADR 0022 §6 — scale singleton cells' accumulated votes by the
        cap × fade composition. Only cells in `_cell_reporters` with
        cardinality 1 are affected; multi-reporter cells pass through."""
        if not self._singleton_cap_enabled:
            return
        for (i, j), reporters in self._cell_reporters.items():
            if len(reporters) != 1:
                continue
            scale = SINGLETON_INFO_SCALE
            if self._singleton_fade_enabled and self._current_tick is not None:
                first = self._cell_first_seen.get((i, j))
                if first is not None:
                    delta = self._current_tick - first
                    if delta > T_CORROBORATE:
                        fade = max(0.0, 1.0 - (delta - T_CORROBORATE) / T_FADE)
                        scale *= fade
            occ[i][j] *= scale
            free[i][j] *= scale

    def _encode_binary(
        self, occ: list[list[float]], free: list[list[float]]
    ) -> bytes:
        cells = [
            [1 if occ[i][j] > free[i][j] else 0 for j in range(self._ny)]
            for i in range(self._nx)
        ]
        out = {
            "width": self._nx,
            "height": self._ny,
            "resolution": self._res,
            "cells": cells,
        }
        return json.dumps(out, separators=(",", ":")).encode()

    def _cast(
        self,
        sx: float,
        sy: float,
        ex: float,
        ey: float,
        w: float,
        occ: list[list[float]],
        free: list[list[float]],
        agent_id: str,
        track: bool,
    ) -> None:
        end_i = max(0, min(self._nx - 1, int(ex / self._res)))
        end_j = max(0, min(self._ny - 1, int(ey / self._res)))
        dist = math.hypot(ex - sx, ey - sy)
        if dist >= 1e-9:
            steps = max(2, int(dist / (self._res * 0.5)))
            dx = (ex - sx) / steps
            dy = (ey - sy) / steps
            seen: set[tuple[int, int]] = set()
            for k in range(steps):
                x = sx + k * dx
                y = sy + k * dy
                i = int(x / self._res)
                j = int(y / self._res)
                if not (0 <= i < self._nx and 0 <= j < self._ny):
                    continue
                if (i, j) == (end_i, end_j) or (i, j) in seen:
                    continue
                free[i][j] += w
                seen.add((i, j))
                if track:
                    self._touch_cell(i, j, agent_id)
        occ[end_i][end_j] += w
        if track:
            self._touch_cell(end_i, end_j, agent_id)

    def _touch_cell(self, i: int, j: int, agent_id: str) -> None:
        key = (i, j)
        reporters = self._cell_reporters.get(key)
        if reporters is None:
            self._cell_reporters[key] = {agent_id}
            if self._current_tick is not None:
                self._cell_first_seen[key] = self._current_tick
        else:
            reporters.add(agent_id)


def encode_fragment(
    agent_id: str,
    pose: Pose,
    scans: list[RangeMeasurement],
    t: float | None = None,
) -> bytes:
    """Build a merger-compatible fragment with pose embedded.

    The locked ``LocalSlam.map_fragment()`` interface omits pose; the merger
    needs it to ray-cast scans into world coordinates. Callers wire pose +
    scans here at fragment-publish time.
    """
    payload = {
        "agent_id": agent_id,
        "t": pose.t if t is None else t,
        "pose": {"x": pose.x, "y": pose.y, "theta": pose.theta},
        "scans": [
            {"angle": m.angle, "distance": m.distance, "t": m.t} for m in scans
        ],
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


def fragment_from_slam(slam: LocalSlam, scans: list[RangeMeasurement]) -> bytes:
    """Convenience: build a fragment from a `LocalSlam.pose()` + the scans
    it just consumed. Avoids re-decoding `slam.map_fragment()` JSON only to
    re-encode it with pose attached."""
    return encode_fragment(_slam_agent_id(slam), slam.pose(), scans)


def _slam_agent_id(slam: LocalSlam) -> str:
    """Read the agent_id from a SLAM instance via its map_fragment payload.

    The ABC doesn't expose `agent_id`; both shipped implementations encode
    it in `map_fragment()`. One JSON parse per call — cheap relative to a
    full ray-cast pass.
    """
    return str(json.loads(slam.map_fragment())["agent_id"])
