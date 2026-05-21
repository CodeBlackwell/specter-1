"""Sensor topic adapters: ROS2 messages → internal sensor types.

Three adapters mirror the three sensor classes the trust + SLAM stack consumes:

  * `LidarAdapter` / `laser_scan_to_range_measurements` — `sensor_msgs/LaserScan`
    → `list[RangeMeasurement]` matching `sensors.lidar_scan(...)` output.
  * `ImuAdapter` / `imu_msg_to_imu_sample` — `sensor_msgs/Imu` → `IMUSample`
    matching `sensors.imu_sample(...)` output.
  * `UwbAdapter` / `uwb_msg_to_beacon_returns` — custom UWB topic
    (per-vendor) → `list[BeaconReturn]` matching `beacons.range_beacons(...)`
    output.

The pure translation functions (`*_to_*`) work without rclpy installed —
they take a duck-typed message object and produce internal types. The
`*Adapter` classes wrap them with rclpy subscriptions and require rclpy.

Design choice: per-message translation (not buffered). The adapter callback
fires once per ROS2 message and hands the translated value to a user-provided
sink. This keeps adapter cost O(1) per message and lets the agent_node
control batching / cadence on its side.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from specter.sim.beacons import BeaconReturn
from specter.types import IMUSample, RangeMeasurement

try:
    import rclpy  # type: ignore[import-not-found,unused-ignore]
    from rclpy.node import Node as _RclpyNode  # type: ignore[import-not-found,unused-ignore]
    from sensor_msgs.msg import (  # type: ignore[import-not-found,unused-ignore]
        Imu as _ImuMsg,
        LaserScan as _LaserScanMsg,
    )

    RCLPY_AVAILABLE = True
except ImportError:
    rclpy = None  # type: ignore[assignment,unused-ignore]
    _RclpyNode = None  # type: ignore[assignment,misc,unused-ignore]
    _ImuMsg = None  # type: ignore[assignment,misc,unused-ignore]
    _LaserScanMsg = None  # type: ignore[assignment,misc,unused-ignore]
    RCLPY_AVAILABLE = False


class AdapterUnavailable(RuntimeError):
    """Raised when an adapter is constructed but rclpy is not installed."""


# ─────────────────────────────────────────────────────────────────────────────
# Pure translation functions — work without rclpy. These take a duck-typed
# message object (anything with the expected attributes) and produce internal
# types. Tests can pass a stub object instead of a real rclpy message.
# ─────────────────────────────────────────────────────────────────────────────


def _stamp_to_seconds(stamp: Any) -> float:
    """ROS2 `builtin_interfaces/Time` (sec, nanosec) → float seconds."""
    return float(stamp.sec) + float(stamp.nanosec) * 1e-9


def laser_scan_to_range_measurements(msg: Any) -> list[RangeMeasurement]:
    """`sensor_msgs/LaserScan` → `list[RangeMeasurement]`.

    Matches the shape `sensors.lidar_scan(...)` produces:
      * `angle` — body-frame bearing (radians), evenly spaced from
        `angle_min` by `angle_increment`
      * `distance` — meters; values outside `[range_min, range_max]` or
        non-finite become `math.inf` (the sim's "no return" sentinel)
      * `t` — seconds, from `header.stamp`
    """
    t = _stamp_to_seconds(msg.header.stamp)
    angle_min = float(msg.angle_min)
    angle_increment = float(msg.angle_increment)
    range_min = float(msg.range_min)
    range_max = float(msg.range_max)
    out: list[RangeMeasurement] = []
    for i, raw in enumerate(msg.ranges):
        d = float(raw)
        # ROS2 convention: out-of-bounds and NaN/inf both indicate no return.
        # The sim uses math.inf as the unified sentinel; map to that.
        if not math.isfinite(d) or d < range_min or d > range_max:
            d = math.inf
        angle = angle_min + i * angle_increment
        out.append(RangeMeasurement(angle=angle, distance=d, t=t))
    return out


def imu_msg_to_imu_sample(msg: Any) -> IMUSample:
    """`sensor_msgs/Imu` → `IMUSample`.

    Maps `linear_acceleration.{x,y}` → `ax,ay` (planar sim — z is ignored)
    and `angular_velocity.z` → `omega`. Bias correction is the agent_node's
    responsibility (per-robot calibration is Phase 2 work, not adapter scope).
    """
    return IMUSample(
        ax=float(msg.linear_acceleration.x),
        ay=float(msg.linear_acceleration.y),
        omega=float(msg.angular_velocity.z),
        t=_stamp_to_seconds(msg.header.stamp),
    )


@dataclass(frozen=True)
class _UwbReturnView:
    """Duck-typed view over one entry in a vendor UWB message.

    Keeps the translation function vendor-agnostic — UWB hardware varies
    enormously, but every driver exposes (subject_id, range, bearing, t)
    in some form. The agent_node provides a small adapter from its specific
    UWB message into a list of these.
    """

    subject_id: str
    range_m: float
    bearing_rad: float
    t: float


def uwb_msg_to_beacon_returns(returns: list[_UwbReturnView] | Any) -> list[BeaconReturn]:
    """List of UWB return views → `list[BeaconReturn]`.

    Matches the shape `beacons.range_beacons(...)` produces. Accepts either a
    list of `_UwbReturnView` (from a vendor adapter shim) or any iterable of
    objects exposing the same four attributes — duck-typed for flexibility.
    """
    out: list[BeaconReturn] = []
    for r in returns:
        out.append(
            BeaconReturn(
                subject_id=str(r.subject_id),
                range_m=float(r.range_m),
                bearing_rad=float(r.bearing_rad),
                t=float(r.t),
            )
        )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# rclpy-backed adapters — wrap the translation functions with subscriptions.
# Each adapter owns one subscription on the parent Node; the user-provided
# sink callback receives the translated value once per message.
# ─────────────────────────────────────────────────────────────────────────────


class LidarAdapter:
    """Subscribes `sensor_msgs/LaserScan` on `topic`; calls
    `sink(list[RangeMeasurement])` per message."""

    def __init__(
        self,
        node: Any,
        topic: str,
        sink: Callable[[list[RangeMeasurement]], None],
        qos: int = 10,
    ) -> None:
        if not RCLPY_AVAILABLE or _LaserScanMsg is None:
            raise AdapterUnavailable("rclpy / sensor_msgs not installed")
        self._sub = node.create_subscription(
            _LaserScanMsg, topic, self._on_msg, qos
        )
        self._sink = sink

    def _on_msg(self, msg: Any) -> None:
        self._sink(laser_scan_to_range_measurements(msg))


class ImuAdapter:
    """Subscribes `sensor_msgs/Imu` on `topic`; calls `sink(IMUSample)` per message."""

    def __init__(
        self,
        node: Any,
        topic: str,
        sink: Callable[[IMUSample], None],
        qos: int = 50,
    ) -> None:
        if not RCLPY_AVAILABLE or _ImuMsg is None:
            raise AdapterUnavailable("rclpy / sensor_msgs not installed")
        self._sub = node.create_subscription(_ImuMsg, topic, self._on_msg, qos)
        self._sink = sink

    def _on_msg(self, msg: Any) -> None:
        self._sink(imu_msg_to_imu_sample(msg))


class UwbAdapter:
    """Vendor-agnostic UWB adapter.

    Constructor takes the message type + a `vendor_unpack` callable that
    converts ONE vendor message into `list[_UwbReturnView]`. The adapter
    handles subscription lifecycle and translation; the vendor shim handles
    schema specifics. This keeps the library independent of any specific
    UWB driver (Decawave DWM1000, Crazyflie Loco Positioning, etc.).
    """

    def __init__(
        self,
        node: Any,
        msg_type: Any,
        topic: str,
        sink: Callable[[list[BeaconReturn]], None],
        vendor_unpack: Callable[[Any], list[_UwbReturnView]],
        qos: int = 10,
    ) -> None:
        if not RCLPY_AVAILABLE:
            raise AdapterUnavailable("rclpy not installed")
        self._sub = node.create_subscription(msg_type, topic, self._on_msg, qos)
        self._sink = sink
        self._vendor_unpack = vendor_unpack

    def _on_msg(self, msg: Any) -> None:
        self._sink(uwb_msg_to_beacon_returns(self._vendor_unpack(msg)))
