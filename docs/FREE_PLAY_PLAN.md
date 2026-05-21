# FREE PLAY — Compose-then-Watch

Implementation plan for the Free Play redesign drafted in Figma on 2026-05-18 (file `ecDqtN6oR0CRU9CvRh2gAn`, frames "FREE PLAY — A · Attack Workbench" and "FREE PLAY — B · Compose / Running"). Replaces the current Free Play screen with a centered Composer card → LAUNCH → Watch state (canvas + TrustPanel + summary chip in TopBar).

## Context

The current Free Play screen (`FreePlayLayout` in `ui/packages/app/src/screens/WorkshopConsole.tsx:336-418`) is workshop chrome with attacks bolted on. Two structural problems:
1. The `CurriculumRail` is redundant in Free Play — most lessons are the same map with different attacks, which is exactly what the `AttackDock` chip pool already expresses.
2. The single shared `attackStartTick` slider cannot express a realistic attack battery — e.g. `range_lie` 120→400 with `colluder_pair` 200→260 *inside* the lie window, with `sensor_fuzz` running 80→500 as ambient noise.

The Compose-then-Watch card fixes both: per-attack scheduling rows, plus dedicated mission/environment/map controls instead of a lesson list. Watch state is canvas-first with a summary chip in the TopBar that re-opens the composer.

User decisions (locked at planning):
- **Engine scope: full end-to-end.** Pattern, path, map preset all land as real engine features — no UI placeholders.
- **Python parity: yes for the per-attack scheduling slice.** Motion/path/map factories land TS-first; Python parity follows when a Python eval scenario needs them.

## Architecture punch-list

| Knob | TS sim-core | Python sim | Engine work |
|---|---|---|---|
| N agents | EXISTS (`scenario.ts:69`) | EXISTS (`runner.py:26`) | none |
| Per-attack start/end tick | ✅ DONE (Wave 1) | ✅ DONE (Wave 1) | per-`Attacker` window |
| Flight pattern | MISSING (`planner?` hook exists at `scenario.ts:85`) | MISSING (`agent.py:14-17`) | new planner library |
| Path / waypoints | MISSING | MISSING | new geometry + path-follower |
| Map preset + beacon layout | PARTIAL (`items` plumbed) | PARTIAL (`world.py:24-37`) | new layout factory |
| User-saved presets | MISSING | n/a | localStorage schema |

Each wave below ends with `uv run pytest -q`, `just ui-test`, `just ui-typecheck`, and a `docs/PROGRESS.md` entry per the project's slice methodology.

---

## Wave 1 — Per-attack scheduling — ✅ SHIPPED

The blocker for the SCHEDULE UX. Per-`Attacker` window with `[startTick, endTick)` semantics; spec-level defaults preserved for back-compat.

**TS sim-core**
- [x] `ui/packages/sim-core/src/attacks.ts` — `Attacker` and `PoseAttacker` get optional `startTick`/`endTick`
- [x] `applyAttacks` + `applyPoseAttacks` filter per-attacker when `tickIndex1` passed
- [x] `ui/packages/sim-core/src/scenario.ts` — `runScenario` + `runSecureScenario` resolve per-attacker windows from spec-level defaults, gate per-attacker (global `attackArmed` still gates scenario-level injectors)
- [x] `ui/packages/sim-core/tests/concurrentAttacks.test.ts` — 4 tests (single window, non-overlapping pair, overlapping pair, spec-level fallback)

**Python**
- [x] `tests/eval/runner.py` — `AttackEvent.end_tick`; `disarms_by_tick` + `_disarm` helper covers pose_lie / drift_pose / sensor_fuzz / replay_storm / odometry_corrupt / beacon_spoof / range_lie / colluder_pair
- [x] `swap_key` explicitly rejects `end_tick` (keypair is overwritten; cannot auto-disarm)
- [x] `tests/eval/scenarios.py` — `liar_with_end_tick` + `dual_windowed_attacks`
- [x] `tests/eval/test_attack_battery.py` — 4 new tests (heal-equivalent, dual-window recovery, swap_key rejection, degenerate window rejection)

**UI plumbing**
- [x] `ui/packages/app/src/sim/scenarioWorker.types.ts` — `AttackSchedule` type + `WorkerRequest.attackSchedules?`
- [x] `ui/packages/app/src/sim/scenarioWorker.ts` — schedules param threaded
- [x] `ui/packages/app/src/sim/scenario.worker.ts` — `applySchedule()` tags every bundle's attackers with their requested window before composing
- [x] `ui/packages/app/src/sim/simStore.ts` — `attackSchedules: Record<id, AttackSchedule>` state, `setAttackSchedule(id, partial)` action, `toggleAttack` auto-allocates `{0, 900}` on add and drops on remove, `cacheKey` busts on window edits

**Quality gates (all green)**
- [x] `just ui-typecheck` clean
- [x] `just ui-test` — 253 passed (was 249, +4)
- [x] `uv run pytest tests/eval/test_attack_battery.py -q` — 19 passed, 6 xfailed (was 15+6, +4)
- [x] `uv run ruff check src tests/eval` clean
- [x] `docs/PROGRESS.md` Wave 1 entry

---

## Wave 2 — Motion planner library — ✅ SHIPPED

Real planners that drive `swarm.commandVelocities` via the existing `spec.planner` hook (`scenario.ts:85`, `swarm.ts:44-51`).

**TS sim-core**
- [x] `ui/packages/sim-core/src/planners.ts` (new) — `lawnmower({ bounds, stripeM, speed })`, `orbit({ center, radius, omegaRad })`, `rendezvous({ target, speed })`, `randomWalk({ rng, speed, turnSigma })`, plus `makePlanner` + `defaultPlannerFor(pattern, opts)` catalog
- [x] Each returns a `Planner` (`scenario.ts:62`) — lib doesn't touch the swarm loop
- [x] `ui/packages/sim-core/tests/planners.test.ts` — 7 tests (lawnmower flip + stripe separation, orbit radial settle + CCW sweep, rendezvous converge-and-hold, randomWalk deterministic replay + constant speed)

**Python**
- [x] `src/specter/sim/planners.py` (new) — `lawnmower`, `orbit`, `rendezvous`, `random_walk`, `default_planner_for` matching TS math
- [x] `tests/test_planners.py` — 7 tests mirroring the TS suite

**UI**
- [x] `simStore.flightPattern: FlightPattern | null` + `setFlightPattern` action; default null preserves lesson-supplied planners
- [x] Worker attaches `makePlanner(defaultPlannerFor(pattern, ...))` (or `randomWalk` with run-seed Rng) to the spec when no lesson planner exists; `WorkerRequest.flightPattern` threaded end-to-end; `cacheKey` busts on pattern change

**Quality gates**
- [x] `just ui-typecheck` clean
- [x] `just ui-test` — 253 passed (full sim-core suite, +7 planner tests, no regressions)
- [x] `uv run pytest tests/test_planners.py -v` — 7 passed
- [x] `uv run ruff check src tests` clean
- [x] `docs/PROGRESS.md` Wave 2 entry

---

## Wave 3 — Path / waypoint geometry

Paths sit *under* flight patterns: a path supplies the target stream, the pattern decides formation around the path leader.

**TS sim-core**
- [x] `ui/packages/sim-core/src/paths.ts` (new) — `loopWaypoints(points)`, `linearPath(start, end, opts)`, `figure8({ center, a, b })`, `freehand(points)` (used by Wave 6 map editor)
- [x] `pathFollower(path, options)` — Planner that picks next waypoint when within `arrivalThreshold`, commands velocity toward it; composes with flight-pattern planners
- [x] `ui/packages/sim-core/tests/paths.test.ts` — deterministic path-following at seed 7

**Python**
- [x] `src/specter/sim/paths.py` (new) — same four constructors + follower

**UI**
- [x] `simStore.pathPreset: "LOOP" | "LINEAR" | "FIGURE-8" | "FREEHAND"` and `pathWaypoints: Array<[number, number]> | null`
- [x] Preset paths derive waypoints from `mapPreset` bounds (LOOP = inset pentagon, LINEAR = diagonal, FIGURE-8 = centered)
- [x] FREEHAND reads `pathWaypoints` set by the Wave 6 map editor

**Quality gates**
- [x] `just ui-test` path parity tests pass
- [ ] Manual: switch path preset in Compose; map preview shows new waypoints, formation re-clusters at the new START
- [x] `docs/PROGRESS.md` Wave 3 entry

---

## Wave 4 — Map preset + beacon layout factory

Named maps with bounds and beacon-placement helpers.

**TS sim-core**
- [x] `ui/packages/sim-core/src/maps.ts` (new) — `MAP_PRESETS: { id, label, sizeM, defaultBeaconLayout, defaultBeaconCount }[]` starting with `WAREHOUSE_40x40`, `WAREHOUSE_60x40`, `OPEN_FIELD_100x100`
- [x] `beaconLayout(name, sizeM, count)` returning `Array<[number, number]>`:
  - [x] `"perimeter"` — equally spaced along the boundary (arc length)
  - [x] `"corners"` — fixed at the four corners (count ignored, always 4)
  - [x] `"dense"` — interior grid (m = ceil(sqrt(count)), 10% inset)
  - [x] `"custom"` — throws; explicit positions required from caller
- [x] `ui/packages/sim-core/tests/maps.test.ts` — beacon coordinates within bounds; perimeter arc-length gaps equal; corners locked at 4; dense 3x3 grid; custom throws

**Python**
- [x] `src/specter/sim/maps.py` (new) — same presets and factory (constant-for-constant parity with TS)
- [x] `tests/test_maps.py` parity test (mirrors the TS suite)

**UI**
- [x] `simStore.mapPresetId`, `beaconCount`, `beaconLayoutName`, `beaconPositions: Array<[number, number]> | null` (last one wins when user customizes); `setMapPreset` resets count + layout to preset defaults and clears positions
- [x] Worker types + worker: `WorkerRequest.mapConfig?` + `WorkerSliceTail.beaconPositions?` (back-compat: no `mapConfig` → legacy `AO_WORLD` path)
- [x] Map preview component reads from these fields *(Wave 5)*

**Quality gates**
- [x] `just ui-test` (265 passed, +12 maps) and `uv run pytest tests/test_maps.py -v` (15 passed)
- [x] Manual: change map preset; canvas world bounds + beacon positions update *(surfaced by Wave 5 MapPreview)*
- [x] `docs/PROGRESS.md` Wave 4 entry

---

## Wave 5 — Compose card UI (read-only map preview)

The new screen, wired to every store field added in Waves 1–4.

**New components** under `ui/packages/app/src/domain/freeplay/`
- [x] `Composer.tsx` — centered card (max-width 1180), two-column body (left: blocks; right: MapPreview), footer with recap + `LAUNCH ▶` *(preset row deferred to Wave 6 with SAVE PRESET)*
- [x] `ScheduleBlock.tsx` — chip pool + per-attack rows (two-thumb range slider via overlaid `<input type="range">`, start/end readout, duration tag, × remove)
- [x] `MissionBlock.tsx` — flight-pattern chips (LAWNMOWER / ORBIT / RENDEZVOUS / RANDOM WALK) + path preset chips (FREEHAND disabled — Wave 6); pattern-wins disabling on path when pattern is active *(agent stepper declared-deferral: see below)*
- [x] `EnvironmentBlock.tsx` — map preset chips + beacon layout chips + count range *(seed deferred — not in store yet)*
- [x] `MapPreview.tsx` — read-only SVG: bounds rect, beacon dots + range halos, waypoint path lines (closed-loop wrap when `path.closed`); reads `MAP_PRESETS` / `mapBounds` / `beaconLayout` / `defaultPathFor` / `freehand` from sim-core
- [x] `SummaryChip.tsx` — TopBar chip in Free Play + Watch state; click → `exitRun()` returns to Composer with the same config preserved

**Rewires**
- [x] `WorkshopConsole.tsx` — `FreePlayLayout` rewritten: `<Composer />` when `!isRunning`, else `SwarmCanvas` + `TickScrubber` + `TrustPanel`. Removed `CurriculumRail`, `SceneBriefing`, `AttackDock`, `AgentRepList` from Free Play.
- [x] `domain/TopBar.tsx` — render `<SummaryChip />` after mode tabs (component self-gates on `mode==="freeplay" && isRunning`)
- [x] `simStore.ts` — `isRunning: boolean` state; `setMode` resets `isRunning=false` on entry to `freeplay`; `launch()` freezes config + sets `isRunning=true` + triggers stream; `exitRun()` clears it; `streamForAttacks` early-returns (only updating `attackIds`) when `mode==="freeplay" && !isRunning` so edits don't churn the worker
- [ ] `domain/AttackDock.tsx` — kept as-is; the new ScheduleBlock owns its own chip pool. AttackDock still drives Workshop's bottom dock for non-Free-Play modes. *(declared-deferral — no factor extraction; AttackDock and ScheduleBlock both consume `ATTACK_CATALOG`/`FAMILY_COLOR` from `data/scenarios`, which is the actual seam)*

**Reuse**
- [x] `lib/` primitives — `Stack`, `Cluster`, `Surface`, `Chip`, `Mono`, `Button` used throughout
- [x] `tokens/tokens.css` cyanotype palette

**Declared deferrals**
- Agent stepper (the plan's `MissionBlock` calls for one). `DRONE_COUNT` is hardcoded at 8 across `droneSwarm.ts` and every attack constructor in `data/scenarios.ts`; making it variable touches every bundle constructor (`honest`, `range_lie`, `colluder_pair`, …) which would compound risk inside a UI slice. MissionBlock shows `Agents · fixed at 8` for now. Wiring this is a small standalone slice.
- Composer preset row (`L02 BETA RECOVERY` / `L05 MID-MISSION FLIP` / `CUSTOM`). The preset row + SAVE PRESET button land in Wave 6 alongside `presetSchema.ts` + `presets.ts` + localStorage persistence — keeping them in one slice avoids dead UI.
- `Composer.test.tsx`. The app package has no DOM-test setup yet (only `passWithNoTests`); spinning up jsdom + RTL is its own slice. Typecheck + production build + sim-core test suite (286 passed) cover correctness for now.
- Seed selector in EnvironmentBlock. `swarmOpts.seed` exists in `ScenarioSpec` but isn't exposed in `simStore`; trivial follow-up.

**Quality gates**
- [x] `just ui-typecheck` clean (both packages)
- [x] `just ui-test` — 286 sim-core tests pass; app package has no test files yet (`passWithNoTests`)
- [x] `just ui-build` — production bundle succeeds
- [x] `docs/PROGRESS.md` Wave 5 entry

---

## Wave 6 — Interactive map editor + preset save/load

Enables the MAP PREVIEW toolbar buttons and persistence.

- [x] `MapEditor.tsx` — interactive replacement for `MapPreview.tsx`; tool state in `simStore.mapTool: "MOVE" | "BEACON" | "WAYPOINT" | "ERASE" | null`; `MOVE` drags nearest beacon (hit-test threshold 4 m); `BEACON` appends to `beaconPositions`; `WAYPOINT` appends to `pathWaypoints` and forces `pathPreset = "FREEHAND"`; `ERASE` removes nearest beacon or waypoint within hit radius; pointer events on the `<svg>` use `setPointerCapture` to track drags; "custom · unsaved" tag shown when `beaconPositions !== null || pathWaypoints !== null`. RESET chip clears both overrides.
- [x] `presetSchema.ts` — `ComposerPreset = { id, name, attackIds, attackSchedules, flightPattern, pathPreset, pathWaypoints, mapPresetId, beaconCount, beaconLayoutName, beaconPositions, builtIn? }`; `loadUserPresets` / `saveUserPresets` round-trip through `localStorage["specter1.freeplay.presets.v1"]` with `{ version: 1, presets: [...] }` envelope; corrupt or version-mismatched JSON yields `[]` (defensive)
- [x] `presets.ts` — `BUILT_IN_PRESETS` array with `L02 BETA RECOVERY` (`liar_then_heals` windowed 60→260) and `L05 MID-MISSION FLIP` (`sleeper_pose_liar` windowed 300→700); marked `builtIn: true` so the UI suppresses the delete button
- [x] `PresetRow.tsx` — chip row of built-in + user presets + `CUSTOM` chip; `SAVE PRESET` button opens an inline naming popover (Enter saves, Escape cancels); per-user-preset `×` button deletes; selecting a preset calls `loadComposerPreset(preset)` which restores every store field
- [x] `simStore.ts` — `mapTool` state + `setMapTool` action; `loadComposerPreset(preset)` action that copies every preset field into the active state (deep-clones arrays so subsequent edits don't mutate the preset)
- [x] `Composer.tsx` — renders `<PresetRow />` between the header and the two-column body; right column uses `<MapEditor />` instead of `<MapPreview />` (MapPreview deleted)
- [x] `MissionBlock.tsx` — `FREEHAND` chip now enabled with tooltip pointing to the `+WAYPOINT` tool

**Quality gates**
- [x] `just ui-typecheck` clean (both packages)
- [x] `just ui-test` — 286 sim-core tests still pass; app package has no test files yet (`passWithNoTests`)
- [x] `just ui-build` — production bundle succeeds
- [x] `docs/PROGRESS.md` Wave 6 entry

**Declared deferrals**
- `MapEditor.test.tsx` and `presetSchema.test.ts` — same blocker as Wave 5 (no jsdom + RTL setup); deferred to a "test infrastructure" slice
- Agent count and seed in the preset schema — both still hardcoded in the store (agent count especially: see Wave 5 deferral note); presets capture every field that the store actually exposes
- The user-flow assertion that `mapPresetId` flips to `null` when beacons are customized — instead, we keep `mapPresetId` populated and use `beaconPositions !== null` as the "custom" signal. This preserves the bounds context for the editor (the editor needs to know what map you customized FROM) and matches the Wave 4 store contract where `setMapPreset` clears `beaconPositions` to re-derive layout

---

## End-of-Wave-5 acceptance (the user-visible milestone)

- [ ] Open Free Play; the Composer card is the only thing on screen besides the TopBar
- [ ] Select `range_lie`, `colluder_pair`, `sensor_fuzz`; set their windows to 120→400, 200→260, 80→500
- [ ] Change agents to 8, pattern to `ORBIT`, path to `FIGURE-8`, map to `OPEN_FIELD_100x100`, beacons to 6 perimeter, seed to 11
- [ ] LAUNCH; canvas shows 8 agents orbiting a figure-8, detection events fire at the right ticks per attack
- [ ] TopBar shows summary chip; clicking `✎ EDIT` re-opens the composer with same config preserved
- [ ] CI builds the UI bundle without errors

## End-of-Wave-6 acceptance

- [ ] Drag a beacon in MAP PREVIEW; `mapPresetId` flips to null, header shows `custom · unsaved`
- [ ] `SAVE PRESET` names + persists it; appears in the preset row on next load
