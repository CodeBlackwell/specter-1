"""Transport-realism wrappers for the Phase 1 in-process bus.

`LossyBus` adds drop / jitter / reorder over any `MessageBus`. `cadence_dispatch`
runs the sync sim tick at non-uniform sensor rates. `validate_timestamp` is an
outer skew filter on `Envelope.timestamp_ns`.

Wave 2: `Sros2Bus` ships the same `MessageBus` interface over ROS2/SROS2 DDS
so any `InProcessBus` consumer can swap to it (rclpy-required at runtime;
import is lazy so the package loads in test envs without rclpy).
"""

from .cadences import Cadence, cadence_dispatch
from .lossy_bus import LossyBus
from .qos import QoSProfile, qos_for_topic
from .sros2_marshal import (
    RCLPY_AVAILABLE,
    Sros2Unavailable,
    envelope_to_ros_msg,
    make_secure_node,
    ros_msg_to_envelope,
)
from .time_sync import validate_timestamp

__all__ = [
    "Cadence",
    "LossyBus",
    "QoSProfile",
    "RCLPY_AVAILABLE",
    "Sros2Unavailable",
    "cadence_dispatch",
    "envelope_to_ros_msg",
    "make_secure_node",
    "qos_for_topic",
    "ros_msg_to_envelope",
    "validate_timestamp",
]
