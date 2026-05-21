ADR 0021: SLAM lessons on the workshop tick rail
================================================

Status: Accepted (2026-05-18). Closes the placeholder note in
`ui/packages/app/src/data/lessonLayouts.ts` that Wave 5 left as a
"SLAM team will land per-lesson overrides" follow-up.

Context
-------

Wave 5 shipped pose-graph SLAM (ADR 0016/0017/0018/0020) and the
sim-core TS port (`PoseGraphTS`, `runSingleAgentLoopClosureDemo`,
`runCooperativeSlamDemo`) plus three Workshop Console canvas
components (`SlamCanvas`, `CooperativeSlamCanvas`, `ClosedLoopSlamCanvas`)
for lessons 09–12. Those canvases shipped as **static SVG diagrams**:
each computed its 2–5 stage snapshots via `useMemo` in-component and
drew an in-canvas row of primary/secondary `Button`s for stage
selection. Meanwhile, a **swarm scenario** also ran underneath
(`slam_loop_closure`, `slam_cooperative_honest`, etc.) producing 764
ticks of unrelated swarm reputations that the right-rail panels
(`AgentDetailsPanel`, `AgentRepList`, `TrustPanel`) animated through.

The two views never talked to each other: the center showed a static
pose-graph diagram with its own stepper, and the right rail showed
live but unrelated swarm Beta evidence. The mismatch read as visually
janky and pedagogically incoherent — the lesson story was told by
the center diagram's stage buttons, not by the timeline the user
otherwise drives lessons through.

The placeholder comment in `lessonLayouts.ts` deferred the integration
to "a follow-on slice matched to canvas-mode requirements." This ADR
records the integration.

Decision
--------

1. **One interaction model.** SLAM lessons drive their stage
   progression through the same `simStore` tick scrubber, spacebar
   play/pause, and `[`/`]` lesson nav as the swarm lessons. No
   in-canvas stage buttons. The N stages of each SLAM demo become N
   `TickSnapshot`s in `result.snapshots`.

2. **TickSnapshot extension.** `TickSnapshot` gains an optional
   `slam?: SlamView` field (`sim-core/src/scenario.ts`) carrying
   pose-graph state per stage: `stageLabel`, `cycle`, `cost`,
   `iterations`, `landmarks`, plus kind-specific data
   (`trajectory`/`closureEdges` for single-agent, `slamAgents`/
   `interRobotEdges`/`scenario` for cooperative). Swarm scenarios
   leave the field absent.

3. **Lesson code path.** `app/src/sim/slamLessons.ts:buildSlamSlice`
   runs the relevant `runCooperativeSlamDemo` /
   `runSingleAgentLoopClosureDemo` synchronously in-process and
   projects each stage into a `TickSnapshot` (synthesizing the
   `agents`/`reputations` fields so the shared types stay honest).
   `simStore.selectLesson` routes 09–12 through this path **before**
   the fixture loader is consulted; the old `slam_*.json` swarm
   fixtures are removed (`generate-lesson-fixtures.mts` skips SLAM
   ids; `fixtures/index.ts:KNOWN_ATTACK_IDS` excludes them).

4. **SLAM-aware right rail.** `domain/SlamMetricsPanel.tsx` replaces
   `TrustPanel`/`AgentDetailsPanel`/`AgentRepList` on SLAM lessons
   in both `WorkshopLayout` and `RightPanel` (FreePlay). It mirrors
   `TrustPanel`'s vocabulary (Surface, MetricCard, sparkline) but
   reads `slam.cost`/`iterations`/`landmarks`/`closureEdges`/
   `interRobotEdges` and the L12 per-agent SLAM-layer reputation.
   `SceneBriefing` shows a SLAM-aware phase label (`STAGE N/M ·
   stageLabel`) instead of the trust phase
   (`HONEST`/`WARMUP`/`ATTACK LIVE`) when `snapshot.slam` is present.

5. **L12 bidirectional toggle removed.** The previous canvas had an
   ON/OFF toggle whose OFF mode showed the naive scenario — which is
   exactly L11. The toggle was pedagogically redundant with L11→L12
   progression and broke the "one interaction model" rule (it was
   the only canvas-local scenario switch). L12 is the bidirectional
   case; L11 is the naive baseline; compare across the lesson boundary.

Consequences
------------

- **Slimmer SLAM canvases.** Each canvas drops ~30 lines of in-canvas
  stage chrome and `useMemo`-driven snapshot generation; it becomes a
  pure renderer of `useCurrentSnapshot().slam`. The L12 canvas keeps
  its reputation trace, but the trace now reads
  `result.snapshots[*].slam.slamAgents` so the timeline cursor on the
  scrubber and the cursor on the trace are the same cursor.

- **Bundle size.** Four SLAM swarm fixtures (~10.9 MB each) are
  removed. SLAM stages are computed in-process — total bytes
  contributed by SLAM lesson content drop to ~0.

- **No new tests.** The TS parity tests continue to pass unchanged —
  `TickSnapshot.slam` is optional, swarm scenarios don't populate
  it. There is no Python `slam_*` swarm scenario to maintain parity
  against; the SLAM stages are already byte-equivalent across
  Python/TS via the existing pose-graph parity coverage.

- **Open follow-ups (deferred, not silently shortcut).**
  - Per-iteration GN/LM streaming inside the optimizer. The demo
    emits 2–5 stages today; a hypothetical per-iteration stream would
    let the scrubber animate the optimizer's gradient descent rather
    than snap between stages. Pedagogy is fine as-is — stages are
    qualitatively distinct — so this is a tutorial-polish item, not a
    correctness item.
  - Wiring the swarm `BetaTrustEvaluator` into the L12 SLAM optimizer
    as a *live* DCS prior driven by the workshop's actual swarm
    scenarios. L12 currently uses the cooperative demo's
    self-contained per-source α/β accumulator (ADR 0020's reference
    impl). Cross-layer feedback against the live swarm evaluator is a
    hardware-readiness item, not a UI item.

Revisit when
------------

- Per-iteration LM/GN streaming becomes pedagogically valuable
  (e.g., demonstrating convergence basins, λ trust-region dynamics).
- Workshop ever needs L12 to consume live swarm reputations rather
  than the demo's internal accumulator.
- A real pose-lie attack lands on the swarm wire (today no swarm
  scenario emits pose lies; they would need to compose with
  `pose_lie` in `attacks.ts` and a SLAM consumer).
