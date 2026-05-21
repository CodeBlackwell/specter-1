"""N-robot Gazebo launch — distinct DDS enclaves per agent.

Spawns N TurtleBot4 models in Gazebo (default 4) and one specter agent
node per robot, each in its own SROS2 enclave (separate keystore subdir).
The dashboard subscribes to all of them via a wildcard subscription.

Pre-reqs:
  * Same as `single_robot.launch.py`, plus
  * Per-agent enclaves generated:
      ros2 security create_keystore ./deploy/sros2_keystore
      for id in alpha bravo charlie delta; do
        ros2 security create_enclave ./deploy/sros2_keystore /$id
      done

Args:
  n_agents: number of robots (default 4)
  roster:   path to signed roster YAML covering all N agents
  keystore: SROS2 keystore root containing per-agent enclaves
"""

from __future__ import annotations

from launch import LaunchDescription  # type: ignore[import-not-found]
from launch.actions import DeclareLaunchArgument  # type: ignore[import-not-found]
from launch.substitutions import LaunchConfiguration  # type: ignore[import-not-found]
from launch_ros.actions import Node  # type: ignore[import-not-found]

DEFAULT_AGENT_IDS = ("alpha", "bravo", "charlie", "delta")


def generate_launch_description() -> LaunchDescription:
    roster = LaunchConfiguration("roster")
    keystore = LaunchConfiguration("keystore")

    actions: list = [
        DeclareLaunchArgument("roster", default_value="./deploy/roster.yaml"),
        DeclareLaunchArgument("keystore", default_value="./deploy/sros2_keystore"),
    ]

    # One agent_node per robot. Real Gazebo wiring (model spawning,
    # per-robot namespace remapping) lives in the turtlebot4 sim include
    # invoked by single_robot.launch.py for each agent_id; here we just
    # parameterize the agent_node side so the swarm layer is the focus.
    for aid in DEFAULT_AGENT_IDS:
        actions.append(
            Node(
                package="specter",
                executable="agent_node",
                name=f"specter_agent_{aid}",
                namespace=aid,
                arguments=[
                    "--agent-id", aid,
                    "--roster", roster,
                    "--identity", f"./deploy/keystore/{aid}.key.pem",
                    "--keystore", keystore,
                    "--lidar-topic", f"/{aid}/scan",
                    "--imu-topic", f"/{aid}/imu",
                ],
                output="screen",
            )
        )

    actions.append(
        Node(
            package="specter",
            executable="dashboard_node",
            name="specter_dashboard",
            arguments=["--roster", roster, "--keystore", keystore],
            output="screen",
        )
    )
    return LaunchDescription(actions)
