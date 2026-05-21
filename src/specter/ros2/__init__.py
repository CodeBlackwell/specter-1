"""ROS2 integration layer — sensor adapters, per-robot agent node, operator dashboard.

This module is the bridge between the rest of the library (which is pure Python
and works without ROS2) and a real ROS2 deployment. The application contract
(`Sros2Bus` over DDS, hardened receive chain, envelope signing) is unchanged
from the in-process path; this module wraps the deployment-time bits:

  * `adapters` — translate `sensor_msgs/LaserScan`, `sensor_msgs/Imu`, and a
    custom UWB topic into the internal `RangeMeasurement` / `IMUSample` /
    `BeaconReturn` types `ScanMatchSlam.update` and the publish path consume.
  * `roster_loader` — load a signed roster YAML produced by `tools/gen_roster.py`,
    verify the operator signature, build a `MutableRoster`.
  * `agent_node` (Wave 1) — per-robot rclpy Node wiring adapters → SLAM →
    publish path → `Sros2Bus`.
  * `dashboard_node` (Wave 1) — operator-station rclpy Node subscribing
    gossip / anomaly / fragments and rendering the demo's right pane.

rclpy is an optional dependency (install via `[ros2]` extras). Modules that
need rclpy at import time gate themselves; pure-Python helpers (the type
contracts, the YAML loader) work without rclpy installed.
"""

from specter.ros2.adapters import (
    LidarAdapter,
    ImuAdapter,
    UwbAdapter,
    laser_scan_to_range_measurements,
    imu_msg_to_imu_sample,
    uwb_msg_to_beacon_returns,
)
from specter.ros2.agent_node import SpecterAgentNode
from specter.ros2.dashboard_node import SpecterDashboardNode
from specter.ros2.identity_store import IdentityStoreError, load_identity
from specter.ros2.roster_loader import RosterLoader, RosterYamlError

__all__ = [
    "IdentityStoreError",
    "ImuAdapter",
    "LidarAdapter",
    "RosterLoader",
    "RosterYamlError",
    "SpecterAgentNode",
    "SpecterDashboardNode",
    "UwbAdapter",
    "imu_msg_to_imu_sample",
    "laser_scan_to_range_measurements",
    "load_identity",
    "uwb_msg_to_beacon_returns",
]
