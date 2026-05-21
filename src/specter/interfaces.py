"""Module ABCs locked at Phase 0. Phase 1+ implementations must conform.

Any cross-module interaction goes through these contracts. ROS2 lifecycle nodes
in Phase 03 wrap them unmodified.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from .types import IMUSample, Pose, RangeMeasurement


class SensorAdapter(ABC):
    @abstractmethod
    def scan(self, t: float) -> list[RangeMeasurement]: ...

    @abstractmethod
    def imu(self, t: float) -> IMUSample: ...


class LocalSlam(ABC):
    @abstractmethod
    def update(self, scans: list[RangeMeasurement], imu: IMUSample) -> None: ...

    @abstractmethod
    def pose(self) -> Pose: ...

    @abstractmethod
    def map_fragment(self) -> bytes: ...


class MessageBus(ABC):
    @abstractmethod
    def publish(self, topic: str, payload: bytes) -> None: ...

    @abstractmethod
    def subscribe(self, topic: str, handler: Callable[[bytes], None]) -> None: ...


class TrustEvaluator(ABC):
    @abstractmethod
    def observe(self, peer_id: str, evidence: dict[str, float]) -> None: ...

    @abstractmethod
    def reputation(self, peer_id: str) -> float: ...


class ConsensusEngine(ABC):
    @abstractmethod
    def propose(self, key: str, value: bytes) -> None: ...

    @abstractmethod
    def committed(self) -> Iterable[tuple[str, bytes]]: ...


class MapMerger(ABC):
    @abstractmethod
    def merge(self, fragments: list[bytes]) -> bytes: ...


@dataclass(frozen=True)
class FactorResidual:
    """A per-factor residual snapshot emitted by `PoseGraphSlam` per ADR 0016 §2
    future-experimentation hooks. The `source_id` is the peer whose observation
    generated the factor (the body whose reputation gates ingestion via §3). A
    Wave 6+ bidirectional-coupling adapter consumes this stream to feed Beta
    evidence back to the trust evaluator; Phase 1 does not."""

    factor_id: str
    source_id: str
    residual_norm: float
    mahalanobis: float
    reputation_at_insertion: float
    iteration: int


class PoseGraphSlam(ABC):
    """Pose-graph SLAM substrate per ADR 0016. Sibling to `LocalSlam` — does NOT
    replace it. `LocalSlam.pose()` (DeadReckoningSlam / ScanMatchSlam) provides
    the streaming odometry that becomes the input to `add_odometry()`. On
    hardware (TurtleBot4 / Crazyflie+UWB per ADR 0006), this ABC is satisfied
    by a thin adapter to Cartographer or the Crazyflie UWB pose graph."""

    @abstractmethod
    def add_odometry(
        self,
        from_pose_id: str,
        to_pose_id: str,
        relative_pose: Pose,
        dt_seconds: float,
        source_id: str,
    ) -> None: ...

    @abstractmethod
    def add_landmark_observation(
        self,
        pose_id: str,
        landmark_id: str,
        range_m: float,
        bearing_rad: float,
        source_id: str,
        nlos: bool = False,
    ) -> None: ...

    @abstractmethod
    def add_inter_robot_observation(
        self,
        observer_pose_id: str,
        observed_pose_id: str,
        range_m: float,
        bearing_rad: float,
        source_id: str,
        nlos: bool = False,
    ) -> None: ...

    @abstractmethod
    def optimize(self) -> None: ...

    @abstractmethod
    def trajectory(self) -> list[tuple[str, Pose]]: ...

    @abstractmethod
    def landmarks(self) -> dict[str, tuple[float, float]]: ...

    @abstractmethod
    def factor_residuals(self) -> list[FactorResidual]:
        """Per-factor residual snapshot for the most recent `optimize()` call.

        Future-experimentation hook per ADR 0016 §2: enables a Wave 6+
        bidirectional trust↔SLAM adapter without re-architecting this ABC.
        Returns an empty list until the first `optimize()` runs.
        """
        ...


class Telemetry(ABC):
    @abstractmethod
    def emit(self, event: str, **fields: object) -> None: ...
