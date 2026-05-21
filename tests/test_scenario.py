from pathlib import Path

from specter.sim.scenario import load_scenario

REPO_ROOT = Path(__file__).resolve().parent.parent


def test_load_two_agents():
    sim, duration = load_scenario(REPO_ROOT / "scenarios" / "two_agents.yaml")
    assert duration == 400
    assert len(sim.agents) == 2
    assert {a.id for a in sim.agents} == {"alpha", "bravo"}
    assert sim.seed == 42


def test_load_four_agents_corridor():
    sim, _ = load_scenario(REPO_ROOT / "scenarios" / "four_agents_corridor.yaml")
    assert len(sim.agents) == 4
    assert any(a.vy < 0 for a in sim.agents)
    assert any(a.vy > 0 for a in sim.agents)


def test_loaded_scenario_is_deterministic():
    a, _ = load_scenario(REPO_ROOT / "scenarios" / "two_agents.yaml")
    b, _ = load_scenario(REPO_ROOT / "scenarios" / "two_agents.yaml")
    assert a.run(75) == b.run(75)
