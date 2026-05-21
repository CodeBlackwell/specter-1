"""Declarative YAML scenarios → Simulation. Phase 0 'config schema' deliverable.

Schema:
    world:   { width: float, height: float }
    walls:   [[x1, y1, x2, y2], ...]      # optional
    agents:  [{ id, x, y, theta, vx?, vy?, omega? }, ...]
    seed:    int                          # optional, default 0
    duration: int                         # tick count, default 200
    bounce:  bool                         # optional, default false
"""

from pathlib import Path

import yaml

from .agent import Agent
from .runner import Simulation
from .world import Wall, box_world


def load_scenario(path: str | Path) -> tuple[Simulation, int]:
    data = yaml.safe_load(Path(path).read_text())
    w = data["world"]
    walls = tuple(Wall(*coords) for coords in data.get("walls", []))
    world = box_world(float(w["width"]), float(w["height"]), *walls)
    agents = [Agent(**spec) for spec in data["agents"]]
    seed = int(data.get("seed", 0))
    duration = int(data.get("duration", 200))
    bounce_walls = bool(data.get("bounce", False))
    sim = Simulation(world=world, agents=agents, seed=seed, bounce_walls=bounce_walls)
    return sim, duration
