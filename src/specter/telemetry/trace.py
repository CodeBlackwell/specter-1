"""Per-peer α/β trajectory recorder.

Foundation slice ships only the data structure. Call `record()` from your
own eval helper or wrapping code — the evaluator itself is unchanged.
"""

from collections import deque

DEFAULT_RING_SIZE = 10_000


class ReputationTrace:
    """Bounded per-peer ring buffer of (t_ns, alpha, beta) tuples."""

    def __init__(self, max_per_peer: int = DEFAULT_RING_SIZE) -> None:
        self._max = max_per_peer
        self._series: dict[str, deque[tuple[int, float, float]]] = {}

    def record(self, peer_id: str, alpha: float, beta: float, t_ns: int) -> None:
        buf = self._series.get(peer_id)
        if buf is None:
            buf = deque(maxlen=self._max)
            self._series[peer_id] = buf
        buf.append((t_ns, alpha, beta))

    def series(self, peer_id: str) -> list[tuple[int, float, float]]:
        return list(self._series.get(peer_id, ()))

    def peers(self) -> list[str]:
        return list(self._series.keys())
