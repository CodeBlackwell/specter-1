"""Sensor-cadence dispatch over a sync `Simulation`.

Keeps `Simulation.tick()` untouched. The wrapper iterates ticks and fires
each callback only on its configured tick stride. Real ROS2 lidar/IMU/UWB
rates (10/200/10 Hz at sim dt=0.05s) map to strides 2/1/2.
"""

from collections.abc import Callable
from dataclasses import dataclass

from ..sim.runner import Simulation, Tick

# At sim dt=0.05s (20 Hz tick rate), these strides yield the target rates.
LIDAR_STRIDE = 2  # 10 Hz
IMU_STRIDE = 1  # 200 Hz (every sim tick — sim's IMU samples at tick rate)
UWB_STRIDE = 2  # 10 Hz

DEFAULT_RATES: dict[str, int] = {
    "lidar": LIDAR_STRIDE,
    "imu": IMU_STRIDE,
    "beacons": UWB_STRIDE,
}


@dataclass(frozen=True)
class Cadence:
    """Bind a callback to a tick stride."""

    callback: Callable[[Tick], None]
    every_n_ticks: int


def cadence_dispatch(
    sim: Simulation,
    callbacks: dict[str, Cadence],
    tick_count: int,
) -> None:
    """Run `sim.tick()` `tick_count` times; fire each callback on its stride.

    Within a single sim tick, callbacks fire in `callbacks` insertion order.
    """
    for tick_idx in range(1, tick_count + 1):
        snapshot = sim.tick()
        for cadence in callbacks.values():
            if cadence.every_n_ticks <= 0:
                raise ValueError("every_n_ticks must be positive")
            if tick_idx % cadence.every_n_ticks == 0:
                cadence.callback(snapshot)
