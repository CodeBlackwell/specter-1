"""Single-robot Gazebo launch — TurtleBot4 + one specter agent + dashboard.

Brings up:
  * Gazebo Garden / Ignition with the TurtleBot4 model
  * One `specter.ros2.agent_node` instance subscribed to `/scan` and `/imu`
  * The `specter.ros2.dashboard_node` operator station

Pre-reqs:
  * ROS2 Humble or later sourced (`source /opt/ros/humble/setup.bash`)
  * `turtlebot4_simulator` package installed
  * `chronyd` running and synchronized (see `infra/chrony.conf`)
  * Roster generated: `python tools/gen_roster.py --n 1 --output-dir ./deploy`

Args:
  agent_id:   robot's roster ID                                (default: alpha)
  roster:    path to signed roster YAML                        (default: ./deploy/roster.yaml)
  identity:  path to robot's PEM private key                   (default: ./deploy/keystore/<agent_id>.key.pem)
  keystore:  SROS2 keystore root for signed-node authentication (default: ./deploy/sros2_keystore)
"""

from __future__ import annotations

from launch import LaunchDescription  # type: ignore[import-not-found]
from launch.actions import (  # type: ignore[import-not-found]
    DeclareLaunchArgument,
    IncludeLaunchDescription,
)
from launch.launch_description_sources import PythonLaunchDescriptionSource  # type: ignore[import-not-found]
from launch.substitutions import LaunchConfiguration, PathJoinSubstitution  # type: ignore[import-not-found]
from launch_ros.actions import Node  # type: ignore[import-not-found]
from launch_ros.substitutions import FindPackageShare  # type: ignore[import-not-found]


def generate_launch_description() -> LaunchDescription:
    agent_id = LaunchConfiguration("agent_id")
    roster = LaunchConfiguration("roster")
    identity = LaunchConfiguration("identity")
    keystore = LaunchConfiguration("keystore")

    turtlebot4_sim = IncludeLaunchDescription(
        PythonLaunchDescriptionSource(
            PathJoinSubstitution(
                [FindPackageShare("turtlebot4_ignition_bringup"),
                 "launch", "turtlebot4_ignition.launch.py"]
            )
        ),
        launch_arguments={"world": "depot"}.items(),
    )

    return LaunchDescription([
        DeclareLaunchArgument("agent_id", default_value="alpha"),
        DeclareLaunchArgument("roster", default_value="./deploy/roster.yaml"),
        DeclareLaunchArgument(
            "identity",
            default_value=["./deploy/keystore/", agent_id, ".key.pem"],
        ),
        DeclareLaunchArgument("keystore", default_value="./deploy/sros2_keystore"),

        turtlebot4_sim,

        Node(
            package="specter",
            executable="agent_node",
            name="specter_agent",
            arguments=[
                "--agent-id", agent_id,
                "--roster", roster,
                "--identity", identity,
                "--keystore", keystore,
                "--lidar-topic", "/scan",
                "--imu-topic", "/imu",
            ],
            output="screen",
        ),

        Node(
            package="specter",
            executable="dashboard_node",
            name="specter_dashboard",
            arguments=["--roster", roster, "--keystore", keystore],
            output="screen",
        ),
    ])
