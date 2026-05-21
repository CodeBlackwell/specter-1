# Coverage Parity PRD — Notebook ⇄ Rail

**Bring the Python notebook curriculum and the React UI rail to redundant
100% coverage: every attack live-demoed on both surfaces, no rail-only
or notebook-only live demos.**

This document codifies the multi-wave initiative. Slices land via
`PROGRESS.md`; durable design calls promote to ADRs.

---

## Bottom line

- Today: **system-wide coverage is complete; per-surface coverage is split.** 4 attacks are rail-only live demos (`forged_envelope`, `late_range_lie`, `partition_gossip`, `cop_corruption_full` + its three flavors). 2 attacks are notebook-only live demos (`beacon_spoof`, `odometry_corrupt`). Identity-lifecycle attacks are notebook-only.
- Target: **redundant 100%** — every attack runs as a named scenario on both surfaces, and a learner who takes only one curriculum still sees every defense activate.
- Methodology: eval-first per CLAUDE.md. Each promotion lands `tests/eval/scenarios.py` first → measured bound in `THREAT_MODEL.md` → notebook 08 row → rail `AttackEntry`. Lessons follow scenarios, not the other way around.
- Scope decision: this PRD **expands the rail past ADR 0015's range-only boundary** for SLAM and identity lifecycle (Wave 4). That decision needs its own ADR if Wave 4 is approved to execute.

---

## Coverage gap matrix (entry state)

Live demo of each attack on each surface, today:

| Attack | Defense layer | Notebook 08 | Rail | Gap |
|---|---|---|---|---|
| `forged_envelope` | Envelopes | — | ✓ L01 | Notebook |
| `replay_storm` | Replay window | ✓ | ✓ L01 | — |
| `single_bad_key` | Identity | ✓ | — | Rail |
| `range_lie` | Tier 1 | ✓ | ✓ (chip) | — |
| `late_range_lie` | Tier 1 (timing) | — | ✓ L05 | Notebook |
| `colluder_pair` | Tier 2 | ✓ | ✓ L03 | — |
| `sensor_fuzz` | Tier 1 (noise) | ✓ | ✓ L04 | — |
| `beacon_spoof` | Tier 1 | ✓ | — | Rail |
| `liar_then_heals` / `recovery_after_lie` | Beta decay | ✓ | ✓ L02 | — |
| `sybil_flood` / `sybil_cabal` | V3 presence | ✓ | ✓ L07 | — |
| `partition_gossip` | Voting + gossip | — | ✓ L06 | Notebook |
| `cop_phantom` | COP filter | — | ✓ (chip) | Notebook |
| `cop_suppress` | COP filter | — | ✓ (chip) | Notebook |
| `cop_fob_corrupt` | COP filter | — | ✓ (chip) | Notebook |
| `cop_corruption_full` | COP filter | — | ✓ L08 | Notebook |
| `odometry_corrupt` | SLAM | ✓ | — | Rail |
| Identity rotation/revocation | Identity | ✓ (notebook 02) | — | Rail |
| `pose_lie` / `drift_pose` (declared no-ops) | — | ✓ (named) | ✓ (named) | — |

**Gap count:** 4 notebook-side gaps (all map-layer + `forged_envelope` + `late_range_lie` + `partition_gossip` collapsed into 4 logical scenarios), 3 rail-side gaps (`beacon_spoof`, `odometry_corrupt`, identity).

---

## Wave structure

Each wave is independently shippable and ends green on the quality gates
listed below. Cumulative coverage improves monotonically.

### Wave 1 — cheap wins (1 slice) ✅ SHIPPED

Lands 3 scenarios that are essentially data adds, no runner / canvas
mechanism changes.

**Outcome:** all three items landed. Wave 1 also surfaced an empirical
finding that corrected a wrong claim in the rail's L05 lesson copy:
detection latency for `late_range_lie` is *not* identical to vanilla
`range_lie` — it scales with accrued α (wake=5 → 50 ticks, wake=60 →
350 ticks). The pedagogical lesson is now sharper: this is the *cost*
of Beta forgiveness (the same math L02 teaches as a feature). Honest
history bought time, exactly as the operator intuition would expect,
and the eval makes the bound legible. See PROGRESS.md slice entry.

1. **`late_range_lie` Python eval** — new scenario function in `tests/eval/scenarios.py` reusing the existing `range_lie` ATTACK_KIND with `attack_tick=120`. Measured bound: same detection-tick budget as `range_lie` measured from t=120, not from start. THREAT_MODEL.md row added. Notebook 08 battery picks it up automatically; the rail-mapping cell in notebook 08 graduates `late_range_lie` from "no Python eval" to "covered."
2. **`beacon_spoof` React rail** — new `AttackEntry` in `ui/packages/app/src/data/scenarios.ts` wiring the already-exported `beaconSpoof` from `@specter/sim-core`. Dock-toggleable; no new lesson slot needed (Wave 1 maintains the 8-lesson arc; `beacon_spoof` joins the dock alongside `range_lie` and `sensor_fuzz` as a Tier 1 chip).
3. **`recovery_after_lie` parity audit** — verify `liar_then_heals` in notebook 08 exhibits the same dip-then-recover shape as the rail's L02. If divergent, parameterize `liar_then_heals` to match (same lie-window, same gap-to-recovery). Update the notebook 08 rail-mapping cell to call this out.

**Exit criteria:**
- `uv run pytest tests/eval/ -q` green; new `late_range_lie` row in THREAT_MODEL.md.
- `just workshop-check` green; notebook 08 includes `late_range_lie` and shows `liar_then_heals` parity with rail L02.
- `just ui-typecheck` + `just ui-test` + `just ui-build` green; `beacon_spoof` chip visible in AttackDock.
- PROGRESS.md slice entry.

### Wave 2 — partition gossip (1–2 slices) ✅ SHIPPED

**Outcome:** runner extension + scenario + test + notebook 04 live cell
all landed in one slice. Empirical finding: cross-clique reputation does
NOT cross the detection threshold from gossip alone — it settles at
~0.73 with the standard `GOSSIP_DISCOUNT=0.1`. The partition exposes a
real *limit* of gossip-only reconciliation, which is now documented as a
measured bound in `THREAT_MODEL.md`. Direct observation is the strong
detection channel; gossip is corroboration, not substitute. This sharpens
rail Lesson 06's framing — the visual divergence-then-partial-convergence
is consistent across both surfaces. See PROGRESS.md slice entry.

Lands the network-partition scenario on the Python side. Requires runner
machinery, not just a data add.

1. **Runner extension**: `link_predicate: Callable[[str, str], bool] | None` added to the eval runner so per-link delivery can be gated. Default `None` preserves existing behavior. Scenario file defines the two cliques.
2. **`partition_gossip` Python eval scenario** — `tests/eval/scenarios.py` entry that splits the swarm and runs `range_lie` inside one clique. Measured bound: detection latency on the *other* clique relative to gossip period (existing 20-tick default). THREAT_MODEL.md row.
3. **Notebook 04 live cell**: ("voting + gossip" already derives the math) — add an `apply_attack`+`run_scenario` cell at the bottom that runs the new `partition_gossip` scenario and renders the divergence-then-convergence trajectory. Notebook 08 picks up the row.

**Exit criteria:** all of Wave 1's gates + a runner unit test asserting `link_predicate` filtering. Possible ADR if the runner change exposes a deeper architectural seam.

### Wave 3 — map-layer attacks (dedicated PRD, ~5 slices) ✅ SHIPPED

**Outcome:** all four cop_* scenarios landed in one session as a single
slice — turned out smaller than the PRD estimated because the
`OccupancyMapMerger` was *not* the integration point (kept independent;
ADR 0019 §"Composition with the OccupancyMapMerger" documents the scope
boundary). The eval-side mechanism is `Item` (in `world.py`) +
`ContactReport` (in `messages.py`) + `MapAttack` (runner-only, eval
adversary primitive) + `build_cop()` filter. Four scenarios + four
tests; notebook 07 live cell shows the COP composite defense visibly
filtering both phantoms while surfacing both real items.
**Empirical bound:** real items keep weight > 0.85 from 3 honest reporters;
single-reporter phantoms drop out cleanly once attacker rep < 0.5.
ADR 0019 documents the design. See PROGRESS.md slice entry.



Largest wave. The Python eval runner has no `MapAttack` mechanism today
— contact reports, COP filtering, and phantom-injection / suppression
are TS-side only.

Sub-waves (each its own slice):

1. **`MapAttack` Python type + runner integration** — port the TS `MapAttack` shape (reporter ID, phantom contacts, suppressed item IDs) to Python; `OccupancyMapMerger` learns to consume contact reports and apply trust weights to map deltas. Notebook 07 currently shows the merger statically; this slice gives it a live attack surface.
2. **`cop_phantom` scenario + eval** — `tests/eval/scenarios.py` + runner branch. THREAT_MODEL.md row. Notebook 07 + 08 pick up.
3. **`cop_suppress` scenario + eval** — same.
4. **`cop_fob_corrupt` scenario + eval** — same.
5. **`cop_corruption_full` composite scenario + eval** — Python equivalent of the TS composite. Notebook 07 gets a live composite cell.

This sub-wave needs its own ADR (call it 0016) on Python map-attack
mechanics, since it crosses the trust ↔ map boundary.

**Exit criteria:** all four map-attack rows in THREAT_MODEL.md with
measured detection / suppression bounds; notebook 07 + 08 demonstrate
all four live; rail unchanged (it already covers these).

### Wave 4 — SLAM and identity in the rail (~2 slices) ✅ SHIPPED (identity portion)

**Outcome — scope correction**: ADR 0015 doesn't constrain the rail's
*visualization* — only the trust voting layer's input. The "rail is
range-only" framing earlier in this PRD was a misreading. Wave 4 did
**not** need a new ADR re-opening 0015's scope; the rail can show
SLAM trajectories and identity ceremonies freely. The trust math
simply won't react to pose lies, which is what the L08 closing
paragraph already names.

**Identity-lifecycle (this slice)**: new lesson L13 "Who's allowed to
talk" with `bad_key` AttackEntry (signature-failure rejection events
modeled on `forged_envelope` and `replay_storm`); ATTACK_SCENE +
LESSON_SCENE + LESSON_LAYOUTS + lessonTitleShort entries. Notebook 02
gains a live demo cell running `single_bad_key` for parity.

**SLAM lessons (L09–L12)**: in flight via the SLAM_PLAN team (ADRs
0016 / 0017-loop-closure / 0018; `src/specter/slam/pose_graph.py` +
sim-core `poseGraph.ts`). Placeholder LESSON_SCENE entries added so
the rail's briefing pane doesn't degrade until the SLAM team lands
their full content. ATTACK_CATALOG additions for the 4 `slam_*`
scenarios remain SLAM team's deliverable.

**Net coverage outcome**: 7 of 7 trust + COP + identity gaps closed
on this side. Remaining cross-surface asymmetries are entirely in the
SLAM trunk's territory (L09–L12), pending SLAM_PLAN PRD completion.



**Re-opens ADR 0015's range-only scope decision for the UI.** Needs its
own ADR before kicking off. Required only if the user wants truly
symmetric surfaces. If skipped, the cross-reference table in
`notebooks/README.md` handles the two residual asymmetries
(identity lifecycle = notebook 02, SLAM = notebook 06).

1. **`odometry_corrupt` rail scenario + lesson** — new `AttackEntry` plus a per-agent SLAM trunk in the canvas (drift bands, scan-match recovery visualization). New lesson L09 "Drift you can see" if the rail expands; otherwise dock-only chip.
2. **Identity-lifecycle rail scenarios** — new chip(s) for `key_rotation` + `revocation` + `swap_key`. Requires UI affordances (rotation ceremony animation, revocation broadcast). Possible new lesson L10 "Who's allowed to talk."

**Exit criteria:** new ADR (call it 0017) on rail-scope expansion past ADR 0015; rail rebuilds clean; coverage matrix shows zero rail-side gaps.

---

## Cross-wave deliverables (every wave updates)

- **`docs/PROGRESS.md`** — slice entry per wave.
- **`docs/THREAT_MODEL.md`** — new attack row per new scenario, with measured bound.
- **`docs/WORKSHOP_UX_GAPS.md`** — strike resolved items as they ship.
- **`notebooks/README.md`** cross-reference table — update the per-attack mapping from "rail-only" / "notebook-only" to "✓ both" as parity lands.
- **`docs/COVERAGE_PARITY_PRD.md`** (this file) — strike completed waves; track residual scope.

## Files added/touched per wave

| Wave | Python files (touched) | TS files (touched) | Doc updates |
|---|---|---|---|
| 1 | `tests/eval/scenarios.py` (+1 fn), `tests/eval/runner.py` (no change — reuses existing kind) | `ui/packages/app/src/data/scenarios.ts` (+1 AttackEntry), `sceneCopy.ts` (+1 ATTACK_SCENE entry) | PROGRESS, THREAT_MODEL, this PRD |
| 2 | `tests/eval/runner.py` (+`link_predicate`), `scenarios.py` (+1), notebook 04 cell | — | PROGRESS, THREAT_MODEL, this PRD |
| 3 | New `MapAttack` machinery in `src/specter/` + 4 scenarios in `scenarios.py` + 4 runner branches; notebooks 07 + 08 cells | — | PROGRESS, THREAT_MODEL, ADR 0016, this PRD |
| 4 | — | New rail lessons / scenarios in `ui/packages/app/src/`; canvas-mode extensions | PROGRESS, ADR 0019, WORKSHOP_UX_GAPS, this PRD |

---

## Quality gates (every slice)

Per CLAUDE.md:

**Python:**
```
uv run pytest -q
uv run ruff check src tests
uv run mypy src/specter/{trust,sim,slam}
```

**UI:**
```
just ui-typecheck
just ui-test
just ui-build
```

**Cross-language parity** (Wave 3+ touches sim-core map machinery):
```
just ui-fixtures
just ui-test
```

**Notebooks:**
```
just workshop-check
```

---

## Decision log

- **Wave order** — cheap wins first so the matrix improves monotonically before any deep work begins. Wave 3 is gated behind a separate ADR because it crosses the trust ↔ map boundary; Wave 4 behind another because it re-opens ADR 0015's scope.
- **Lesson count discipline** — Waves 1–2 do not add rail lesson slots. The 8-lesson arc is sized for operator-question density, not attack-count density. New attacks join the AttackDock as chips. Only Wave 4 adds new lesson slots (and only if executed).
- **No-op handling** — `pose_lie` / `drift_pose` / `gradient_drift` / `colluding_pair_pose_liars` remain as the L08 closing paragraph + named entries in notebook 08. Per user decision, no dedicated "limits" lesson.
- **Methodology** — each scenario lands eval-first per the project's slice-and-document discipline. Bounds in THREAT_MODEL come from test outcomes, not estimates.

---

## Out of scope for this PRD

- Web Worker scenario distribution / multi-process eval — orthogonal performance concern.
- Rail UI redesigns beyond what new lessons require (Wave 4 only).
- Hardware integration of new attacks — the Phase 1 entry kit (`tests/integration/test_battery_multiprocess.py`) picks up new scenarios automatically once they're in `tests/eval/`.
- Documentation deep-clean of legacy lesson references in `docs/threat-model.md` (lowercase, separate file from `THREAT_MODEL.md`) — not in the workshop curriculum surface.
