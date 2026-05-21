from specter.sim.agent import Agent
from specter.sim.runner import Simulation
from specter.sim.world import box_world


def test_bounce_keeps_agent_inside_box():
    world = box_world(5.0, 5.0)
    agents = [
        Agent(id="ne", x=2.5, y=2.5, theta=0.0, vx=2.0, vy=1.5),
        Agent(id="sw", x=2.5, y=2.5, theta=0.0, vx=-1.7, vy=-2.3),
    ]
    sim = Simulation(world=world, agents=agents, seed=0, bounce_walls=True)
    sim.run(400)
    for a in sim.agents:
        assert 0.0 <= a.x <= 5.0, f"{a.id} escaped at x={a.x}"
        assert 0.0 <= a.y <= 5.0, f"{a.id} escaped at y={a.y}"


def test_bounce_off_horizontal_wall_flips_vy():
    world = box_world(5.0, 5.0)
    agents = [Agent(id="up", x=2.5, y=4.9, theta=0.0, vy=2.0)]
    sim = Simulation(world=world, agents=agents, seed=0, bounce_walls=True)
    sim.run(5)
    assert sim.agents[0].vy < 0


def test_bounce_disabled_lets_agents_escape():
    world = box_world(5.0, 5.0)
    agents = [Agent(id="esc", x=2.5, y=2.5, theta=0.0, vx=5.0)]
    sim = Simulation(world=world, agents=agents, seed=0)
    sim.run(20)
    assert sim.agents[0].x > 5.0


def test_bounce_is_deterministic():
    def make() -> Simulation:
        world = box_world(5.0, 5.0)
        agents = [Agent(id="a", x=2.5, y=2.5, theta=0.0, vx=1.7, vy=1.3)]
        return Simulation(world=world, agents=agents, seed=42, bounce_walls=True)

    assert make().run(200) == make().run(200)
