"""Run a YAML scenario. Default headless (stdout). Pass --viz for pygame window."""

import sys

from specter.sim.scenario import load_scenario


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: run_scenario.py <path.yaml> [--viz]")
        sys.exit(1)

    path = sys.argv[1]
    viz = "--viz" in sys.argv
    sim, duration = load_scenario(path)

    if viz:
        from specter.viz.pygame_viz import run

        run(sim, duration)
        return

    for tick in sim.run(duration):
        positions = " ".join(f"{a.id}=({a.x:5.2f},{a.y:5.2f})" for a in tick.agents)
        print(f"t={tick.t:6.2f}  {positions}")


if __name__ == "__main__":
    main()
