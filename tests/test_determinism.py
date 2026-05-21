import pytest

from specter.sim.agent import Agent
from specter.sim.runner import Simulation
from specter.sim.world import Wall, box_world


def make_sim(seed: int) -> Simulation:
    world = box_world(10.0, 10.0, Wall(5.0, 0.0, 5.0, 5.0))
    agents = [
        Agent(id="alpha", x=2.0, y=2.0, theta=0.0, vx=0.3, omega=0.1),
        Agent(id="bravo", x=8.0, y=8.0, theta=3.14, vx=-0.2, omega=-0.1),
    ]
    return Simulation(world=world, agents=agents, seed=seed)


def test_seeded_runs_match():
    a = make_sim(42).run(100)
    b = make_sim(42).run(100)
    assert a == b


def test_different_seeds_diverge():
    a = make_sim(1).run(50)
    b = make_sim(2).run(50)
    assert a[-1].scans != b[-1].scans


def test_tick_count_and_time():
    sim = make_sim(0)
    ticks = sim.run(20)
    assert len(ticks) == 20
    assert ticks[-1].t == pytest.approx(20 * sim.dt)
