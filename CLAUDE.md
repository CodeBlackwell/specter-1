# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repo. Read this before working in `specter-1/`; it explains the layout, methodology, and quality gates that other docs assume.

## What specter-1 is

Byzantine-resilient cooperative SLAM demonstrator. A swarm of agents maps together while detecting and surviving compromised peers. Two halves:

1. **Trust resilience** (~95% complete in sim) — signed envelopes + per-peer Beta(α,β) reputation + range-only voting (ADR 0015: Tier 1 reciprocal range, Tier 2 MDS embeddability).
2. **Cooperative SLAM** (~50%) — dead-reckoning shipped; map merger pending.

Hardware target locked to ROS 2 Humble + Gazebo + TurtleBot4 + Crazyflie+UWB (ADR 0006). Phase 1 is pure-Python sim; Phase 3 is SROS2 + hardware. No Phase 2 — Gazebo bridges the gap.

## Layout

```
specter-1/
  src/specter/           # Python sim core (ADR 0001)
    crypto.py            # ECDSA P-256 + SHA-256 (Phase 4 → ATECC608A)
    secure_bus.py        # Envelope, canonical-JSON signed blob, roster, replay window
    messages.py          # Wire types (Observation = range_m + bearing_rad per ADR 0015)
    trust/
      evaluator.py       # BetaTrustEvaluator: Beta math + cohorts + Tier 1 + Tier 2
      mds.py             # Classical MDS — embeddability_score, lying_edge_residuals
    sim/                 # Agent, beacons, world, runner
    ros2/                # Phase 3 SROS2 transport (ADR 0011)
    viz/                 # Dashboard + notebook viz
  tests/
    eval/                # Scenario battery — every THREAT_MODEL claim cites one
  notebooks/             # Workshop curriculum (ADR 0014) — audit surface
  docs/
    PROGRESS.md          # State of every component + recent slices (update on ship)
    HARDWARE_READINESS.md# Sim → hardware punch list, phased entry/exit criteria
    THREAT_MODEL.md      # Auditable claims, each cites tests/eval scenario + bound
    RUNBOOK.md           # Anomaly category dictionary
    adr/                 # 0001–0015. Add a new ADR for any non-obvious design call.
  ui/                    # React Workshop Console (sub-workspace, see below)
  examples/              # unified_demo.py + run_scenario.py
  justfile               # All dev recipes
```

## ui/ — React Workshop Console

Pnpm workspace ported from the Python `specter.*` library. Two packages:

```
ui/
  packages/
    sim-core/            # Pure TS port of crypto/envelope/reputation/swarm/mds/evaluator
      src/
        crypto.ts        # @noble/curves/p256 + sha256 (sync verify)
        canonicalJson.ts # Byte-exact match to Python json.dumps(sort_keys, no whitespace)
        envelope.ts      # Envelope, signedBlob, seal, openEnvelope
        reputation.ts    # PeerReputation + Beta math + exponential decay
        agent.ts, swarm.ts, beacons.ts, rng.ts, messages.ts
        linalg.ts        # Jacobi symmetric eigendecomposition (no numpy)
        mds.ts           # Double-center, embeddability_score, lying_edge_residuals
        evaluator.ts     # BetaTrustEvaluator (Tier 1 + Tier 2, scoped — see deferrals)
        attacks.ts       # range_lie, colluder_pair, sensor_fuzz, beacon_spoof
        scenario.ts      # runScenario → deterministic snapshots[]
      tests/
        fixtures/        # parity.json + _generate.py (run uv to regen)
        *.parity.test.ts # Python→TS parity tests (35 byte-exact + 18 MDS + 13 + 5 + smoke = 71)
    app/                 # Vite + React + TS + CSS vars (no Tailwind)
      src/
        tokens/tokens.css # CSS variables mirroring the Figma token collection
        lib/              # Stack, Cluster, Surface, Button, Pill, Chip, Mono, StatusDot, Tabs, ...
        charts/Sparkline.tsx
        sim/              # simStore (zustand) + SwarmCanvas + TickScrubber + AgentRepList
        domain/           # TopBar, CurriculumRail, Inspector, AttackDock
        screens/WorkshopConsole.tsx
        data/             # lessons, scenarios catalog
```

**Parity contract**: TS sim-core must produce byte-identical signed envelopes and 12-decimal-equivalent Beta/MDS math to the Python. The `tests/fixtures/_generate.py` script is the source of truth — regenerate with `just ui-fixtures` whenever the wire shape or core math changes.

**Per-agent evaluators** (ported): `runScenario` instantiates one `BetaTrustEvaluator` per agent with `selfId` set to that agent's ID, alongside the shared global evaluator. Each agent's view is exposed on `TickSnapshot.perAgentReputations` and `ScenarioResult.agentEvaluators`. The bus is broadcast and lossless today, so views are numerically identical to the shared view (modulo each agent's self-rep clamped to 1.0); divergence will emerge once envelope rejection or per-link loss is wired in. The Python `test_per_agent_views_can_diverge` is the eventual parity contract.

**Gossip integration** (ported): `BetaTrustEvaluator` exposes `gossipSnapshot()`, `recordGossip(gossiperId, views, ts)`, and `reputation()` now combines first-hand Beta(α,β) with gossip-weighted contributions (formula: `α += firstHandScore(gossiper) × GOSSIP_DISCOUNT(0.1) × (view.α − 1.0)`, same for β). `ScenarioSpec.gossipRoundEvery: number` opts a scenario into periodic gossip — every Nth tick, every agent broadcasts its snapshot and every other agent ingests it. Self-gossip and foreign views of self are rejected per Python. See `tests/evaluator.test.ts` gossip suite (4 tests).

**V3 transitive presence** (ported): `BetaTrustEvaluator` tracks `_seenBy[subject][observer] = ts` on every `recordObservation`. `hasPresence(peerId, nowNs)` implements the 3-rule cascade: (a) self anywhere in granters → sticky True; (b) any granter G in granters where self has personally beaconed G and G's beacon is fresh (< `PRESENCE_WINDOW_NS = 2s`) → True; falls back to V1 windowed-any-granter when `selfId` is undefined. Voting weight in `_vote` is gated to 0 when presence fails. Observations of no-presence subjects charge observer `OBSERVATION_PRESENCE_BETA = 0.2`. `recordPoseReport(agentId, ts)` charges a one-shot `PRESENCE_BETA = 1.0` per agent that lacks beacon corroboration. See `tests/evaluator.test.ts` presence suite (7 tests) including the Sybil-cabal-cannot-manufacture-presence assertion (ported from Python `test_sybil_cabal_mutual_gossip_cannot_manufacture_presence`).

**Phantom agents + injection hooks** (shipped): `Agent.phantom: boolean` marks non-physical agents — `Swarm.tick` excludes them from both observer and peer lists (real beacons can't reach phantoms, phantoms emit no real beacons), and `runScenario` skips them when constructing per-agent evaluators. `ScenarioSpec.injectedObservations(tick, ts)` and `injectedPoseReports(tick, ts)` callbacks feed phantom evidence onto the bus each tick. The `sybil_cabal` attack uses these: two phantom agents mutually vouch and pose-report, but no real beacon ever grants them presence → V3 presence rule collapses their per-agent reputation. Visible in the UI canvas via `consensusReputations`.

**Per-link delivery filtering** (shipped): `ScenarioSpec.linkPredicate: (observerId, receiverId) => boolean` gates whether each per-agent evaluator ingests each observation. Gossip rounds intentionally bypass the predicate (gossip is modeled as eventually-consistent multi-hop). The `partition_gossip` attack splits the swarm into two cliques and runs `range_lie` on A0 — A0's clique catches the lie directly; the other clique sees no divergence until gossip rounds carry the disagreement across. Lesson 07 wires to this scenario.

**Consensus view** (added): `TickSnapshot.consensusReputations` is the median of all real agents' per-agent views per peer. The canvas, AgentRepList, and Inspector now read this so the swarm's collective verdict drives the UI status colors (the shared/global evaluator becomes a debug-only "external observer"). Without per-agent views (e.g., scenarios with no `selfId`s), falls back to `reputations`.

**UI conventions**: flexbox-first responsive. The Figma reference is 1440-wide; production layouts must reflow. No fixed pixel widths — Figma column widths (260/340/...) are defaults, not contracts. See user's memory `specter1_ui_conventions.md`.

## Methodology — eval-first, slice-and-document

Every defensive change starts with an eval that measures the gap, then a slice that closes it, then a doc update that records what was measured.

- **Eval-first**: write the scenario in `tests/eval/scenarios.py` first; xfail it; implement until xpass. Numbers in `THREAT_MODEL.md` come from test outcomes, not estimates.
- **Slice discipline**: each slice does one thing, ends with `uv run pytest -q` green + `uv run ruff check src tests` clean + `docs/PROGRESS.md` entry.
- **Promotion rules**:
  - Item ships → strike through in PROGRESS with commit hash
  - Non-obvious design call → write an ADR; link from PROGRESS
  - Risk that survives sim → promote to `THREAT_MODEL.md` with measured bound
  - New "known limit" → goes in `THREAT_MODEL.md` only after a scenario proves the limit empirically
- **Multi-slice plans**: drafted as a plan-mode artifact (see ADR 0015's 5-wave PRD) before coding starts.

## Quality gates

Per slice (Python):
```bash
uv run pytest -q
uv run ruff check src tests
uv run mypy src/specter/{trust,sim,slam}
```

Per slice (UI):
```bash
just ui-typecheck   # tsc --noEmit across sim-core + app
just ui-test        # vitest run — sim-core parity suite
just ui-build       # vite build — verify production bundle
```

Cross-language parity (after wire/math changes):
```bash
just ui-fixtures    # regenerates ui/packages/sim-core/tests/fixtures/parity.json
just ui-test        # verifies TS still matches
```

## Commit style

Lowercase, optional `category:` prefix, focus on the *why* not just the *what*. Examples from history:
- `feat: range-only trust voting (ADR 0015) — 5 waves end-to-end`
- `record_accept α-tightening: 0.1 default closes Byzantine attack-rep gap`
- `voting-order fix: cohort-close gating closes the colluder early-fire gap`

Body explains the mechanism + lists empirical impact (detection ticks, scenario passes).

## Recipes — quick reference

```bash
just                       # list all recipes
just setup                 # uv sync --all-extras
just test                  # full pytest suite
just demo                  # examples/unified_demo.py — live pygame visualization
just demo-smoke            # 5-tick headless smoke
just workshop              # jupyter lab notebooks/
just workshop-check        # nbconvert --execute all 9 notebooks
just lint                  # ruff + mypy

# UI (React Workshop Console)
just dev                   # Vite dev server at http://localhost:5180
just ui-test               # vitest — TS parity tests
just ui-typecheck          # tsc both packages
just ui-build              # production bundle to ui/packages/app/dist
just ui-fixtures           # regen Python→TS parity vectors

# Hardware phase 1
just gen-roster n="4"      # signed roster + keypairs
just agent-node alpha      # per-robot node dry-run
just dashboard             # operator dashboard dry-run
just battery-multiprocess  # Phase 1 EXIT criterion — DDS attack battery
```

## Audit doc map — read these before planning work

- `docs/PROGRESS.md` — current state, recent slices, attack-battery measurement table
- `docs/THREAT_MODEL.md` — every "we resist X" claim cites a `tests/eval/` scenario
- `docs/HARDWARE_READINESS.md` — sim → hardware punch list
- `docs/adr/000{1..15}.md` — design decisions, status, "revisit when"
- `notebooks/README.md` — 9-notebook curriculum index + glossary
