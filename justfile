default:
    @just --list

setup:
    uv sync --all-extras

test:
    uv run pytest -v

sim file="scenarios/two_agents.yaml":
    uv run python examples/run_scenario.py {{file}}

viz file="scenarios/two_agents.yaml":
    uv run python examples/run_scenario.py {{file}} --viz

chat:
    uv run python examples/signed_chat.py

demo:
    uv run python examples/unified_demo.py

demo-smoke:
    SPECTER_DEMO_MAX_TICKS=5 SDL_VIDEODRIVER=dummy uv run python examples/unified_demo.py

workshop:
    uv run jupyter lab notebooks/

workshop-check:
    MPLBACKEND=Agg uv run jupyter nbconvert --to notebook --execute notebooks/*.ipynb --output-dir /tmp/nb-out

lint:
    uv run ruff check src tests
    uv run mypy src

# ── Phase 1 hardware deployment ──────────────────────────────────────────

# Generate operator key + signed roster YAML for N agents.
gen-roster n="4" output="./deploy":
    uv run python tools/gen_roster.py --n {{n}} --output-dir {{output}}

# Headless smoke for the per-robot agent node (no rclpy required).
agent-node agent_id="alpha" deploy="./deploy":
    uv run python -m specter.ros2.agent_node --dry-run \
        --agent-id {{agent_id}} \
        --roster {{deploy}}/roster.yaml \
        --identity {{deploy}}/keystore/{{agent_id}}.key.pem

# Headless smoke for the operator dashboard (no rclpy required).
dashboard deploy="./deploy":
    SDL_VIDEODRIVER=dummy uv run python -m specter.ros2.dashboard_node --dry-run \
        --roster {{deploy}}/roster.yaml

# Real Gazebo bring-up (requires ROS2 Humble+ sourced, turtlebot4_simulator).
gazebo:
    ros2 launch launch/single_robot.launch.py

# Phase 1 EXIT criterion: full attack battery over real DDS, multi-process.
# Requires rclpy + ROS2 Humble+ sourced. Set SPECTER_BATTERY_MULTIPROCESS=1 to opt in.
battery-multiprocess:
    SPECTER_BATTERY_MULTIPROCESS=1 uv run pytest tests/integration/test_battery_multiprocess.py -v

# Phase 1 EXIT in a ROS2 Humble container — the canonical way to run this on
# macOS (no native rclpy after Iron). First run pulls ros:humble (~700 MB) and
# pre-bakes Python deps (~5 min). Subsequent runs reuse the cached image and
# take just the test's ~4 min of DDS round-trips. Rebuild after pyproject.toml
# changes with `just battery-docker-build`.
battery-docker: battery-docker-build
    docker run --rm -v "{{justfile_directory()}}:/workspace" -w /workspace specter-battery:latest

battery-docker-build:
    docker build -f docker/Dockerfile.battery -t specter-battery:latest .

# Drop into the battery container for ad-hoc rclpy / ros2 CLI work.
battery-docker-shell: battery-docker-build
    docker run --rm -it -v "{{justfile_directory()}}:/workspace" -w /workspace specter-battery:latest bash

# ── Workshop UI (React) ──────────────────────────────────────────────────

# Vite dev server for the Workshop Console at http://localhost:5180.
dev: ui-fixtures-lessons ui-fixtures-notebooks
    cd ui && pnpm install --silent && pnpm --filter @specter/app dev

# Run the sim-core Vitest suite (TS parity tests).
ui-test:
    cd ui && pnpm install --silent && pnpm -r test

# Typecheck both UI packages.
ui-typecheck:
    cd ui && pnpm install --silent && pnpm -r typecheck

# Production build of the Workshop UI to ui/packages/app/dist.
ui-build: ui-fixtures-lessons ui-fixtures-notebooks
    cd ui && pnpm install --silent && pnpm --filter @specter/app build

# Regenerate Python→TS parity fixtures (run after evaluator/wire changes).
ui-fixtures:
    uv run python ui/packages/sim-core/tests/fixtures/_generate.py
    uv run python ui/packages/sim-core/tests/fixtures/_generate_scenarios.py

# Pre-render lesson scenarios to JSON fixtures (run after sim-core or scenarios.ts changes).
ui-fixtures-lessons:
    cd ui && pnpm install --silent && pnpm --filter @specter/app generate-fixtures

# Slim notebooks/*.ipynb into Coursework page JSON (run after editing or executing notebooks).
ui-fixtures-notebooks:
    cd ui && pnpm install --silent && pnpm --filter @specter/app generate-notebooks
