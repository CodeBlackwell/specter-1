"""LossyBus: drop / jitter / reorder wrapper over any `MessageBus`.

Models real-radio behavior so the trust engine's resilience to non-ideal
transport is measurable. Determinism comes from a seeded RNG plus a sequence
counter as the heap tiebreaker — same seed and same publish order yields
the same delivery order.

Logical clock advances 1 tick per `publish()` call. `jitter_max_ms` and
`reorder_window_ms` are interpreted in those clock units (ms-equivalent at
1 publish/ms). Reorder is induced by adding a second random delay on top of
jitter: messages published later but with shorter combined delay can pass
earlier ones.

Optional `order_key`: when provided, two messages sharing the same key keep
their publish order at the receiver. Models a real radio's per-flow FIFO
guarantee (e.g. per-sender or per-topic) — jitter still reorders across
flows but never within one. Without an order_key, jitter can reorder any
two messages.
"""

import heapq
import random
from collections.abc import Callable, Hashable

from ..interfaces import MessageBus


class LossyBus(MessageBus):
    def __init__(
        self,
        inner: MessageBus,
        drop_prob: float = 0.0,
        jitter_max_ms: int = 0,
        reorder_window_ms: int = 0,
        rng: random.Random | None = None,
        order_key: Callable[[str, bytes], Hashable] | None = None,
    ) -> None:
        if not 0.0 <= drop_prob <= 1.0:
            raise ValueError(f"drop_prob {drop_prob} not in [0, 1]")
        if jitter_max_ms < 0 or reorder_window_ms < 0:
            raise ValueError("jitter and reorder windows must be non-negative")
        self._inner = inner
        self._drop_prob = drop_prob
        self._jitter_max = jitter_max_ms
        self._reorder_window = reorder_window_ms
        self._rng = rng if rng is not None else random.Random()
        self._order_key = order_key
        self._clock = 0
        self._seq = 0
        # heap entries: (delivery_time, seq, topic, payload)
        self._pending: list[tuple[int, int, str, bytes]] = []
        self._last_delivery_per_key: dict[Hashable, int] = {}

    def publish(self, topic: str, payload: bytes) -> None:
        self._clock += 1
        if self._drop_prob > 0.0 and self._rng.random() < self._drop_prob:
            return
        delay = 0
        if self._jitter_max > 0:
            delay += self._rng.randint(0, self._jitter_max)
        if self._reorder_window > 0:
            delay += self._rng.randint(0, self._reorder_window)
        delivery = self._clock + delay
        if self._order_key is not None:
            key = self._order_key(topic, payload)
            last = self._last_delivery_per_key.get(key, -1)
            if delivery <= last:
                delivery = last + 1
            self._last_delivery_per_key[key] = delivery
        self._seq += 1
        heapq.heappush(self._pending, (delivery, self._seq, topic, payload))
        while self._pending and self._pending[0][0] <= self._clock:
            _, _, t, p = heapq.heappop(self._pending)
            self._inner.publish(t, p)

    def subscribe(self, topic: str, handler: Callable[[bytes], None]) -> None:
        self._inner.subscribe(topic, handler)

    def flush(self) -> None:
        """Deliver all buffered messages in heap order."""
        while self._pending:
            _, _, t, p = heapq.heappop(self._pending)
            self._inner.publish(t, p)
