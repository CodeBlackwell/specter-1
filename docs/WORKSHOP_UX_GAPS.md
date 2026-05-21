# Workshop UX Coverage Gaps

Audit of what the React Workshop Console (`ui/packages/app`) does **not** yet
visualize, despite the underlying mechanism existing in `sim-core` or being
demonstrable in principle. Itemized so we can pick the next slice deliberately.

Generated alongside slices 1–3 (AO frame, frontier exploration, fog of war,
COP filter, phantom + suppression). Compare against `WORKSHOP_OUTLINE.md` for
the lesson-coverage view.

Legend: priority is the editor's opinion of pedagogical / demo payoff, not effort.

---

## Rail revision (2026-05-17): 9 lessons → 8

The lesson rail was rewritten from a 9-lesson sequence with three redundant
`honest` openers (L01–03) and two redundant `colluder_pair` closers (L08–09)
to an 8-lesson arc where every lesson runs a distinct scenario and answers
an operator-resonance question. Two whole defenses previously absent from the
curriculum — V3 transitive presence and the trust-weighted COP filter — now
have dedicated lessons. The declared limits (`pose_lie` / `drift_pose`) live
as a closing paragraph in L08's briefing rather than their own slot.

Old → new mapping (for any reader following stale lesson references below):

| Old | Old title | New | New title | Scenario change |
|---|---|---|---|---|
| 01 | Signed envelopes | 01 | The wire is hostile | `honest` → `forged_envelope + replay_storm` composed |
| 02 | Replay window | 01 | (folded into new L01) | — |
| 03 | Beta(α,β) reputation | 02 | Reputation that forgives | `honest` → `recovery_after_lie` |
| 04 | Tier 1 reciprocal range | — | (range_lie remains in dock) | — |
| 05 | Tier 2 MDS embeddability | 03 | When two liars agree | unchanged: `colluder_pair` |
| 06 | Sim + sensor realism | 04 | Bad data ≠ bad actor | unchanged: `sensor_fuzz` |
| 07 | Voting + gossip | 06 | When the swarm splits | unchanged: `partition_gossip` |
| 08 | Attack battery tour | — | (removed; redundant `colluder_pair`) | — |
| 09 | Byzantine swarm full demo | — | (removed; redundant `colluder_pair`) | — |
| — | (new) | 05 | The sleeper agent | `late_range_lie` |
| — | (new) | 07 | Agents that never were | `sybil_cabal` |
| — | (new) | 08 | Attacks on the map itself | `cop_corruption_full` (NEW composite) |

Resolved items below are tagged with the rail revision where applicable.

---

## 1. Foundational mechanism visualization

The trust math runs, but the audience can't see the *reason* a decision was made.

- [x] **(P1) Tier 2 MDS geometry panel** — render the classical-MDS 2D embedding + per-point residuals + lying-edge attribution when a Tier-2 attack is live. `colluder_pair` currently just makes A0/A1 go red; the embeddability score crossing τ=0.05 is invisible. *Shipped as merged `TrustPanel` (Tier 1 + Tier 2 in one view, two metric cards + shared 2D embedding + lying-edge callouts).*
- [x] **(P1) Reputation timeline / sparkline per drone** — Inspector or rep-list should show Beta(α,β) trajectories across the full run. The collapse moment is the demo's emotional beat; right now there's no chart of it. *Shipped: `AgentRepList` full-run sparklines with current-tick cursor + future-dim + detection marker.*
- [ ] **(P1) Tier 1 reciprocal residual readout** — when two drones disagree on their pairwise range, surface the actual numbers (`A0→A2 = 32m, A2→A0 = 28m, Δ=4m > k·σ`). Currently inferable only via PerspectiveBadge hover. *Partially covered by TrustPanel max-Δ card; hover-level numerics still missing.*
- [ ] **(P2) Gossip-round event marker** — `partition_gossip` fires gossip every 20 ticks; visualize each round with a brief edge animation or a tick badge. The "trust crosses the partition" moment currently happens silently.
- [ ] **(P2) Per-drone Beta(α,β) breakdown on hover** — PerspectiveBadge shows rep but not the underlying α / β / decay state. L02 ("Reputation that forgives") leans on the audience to imagine this; would land harder with α/β numerics visible during the dip-then-recover demo.
- [ ] **(P3) Embeddability score over time** — a small chart that climbs past τ=0.05 in `colluder_pair`, stays below in honest runs. Provides a numerical companion to the MDS panel.

## 2. Curriculum lesson coverage holes

The rail now has 8 lessons (see mapping above); every lesson runs a distinct
scenario. Items below are tagged against the **new** numbering.

- [x] **(P1) L01 wire boundary** — signature verification and replay drops both visible on-canvas. *Shipped via `forged_envelope` + `replay_storm` composed; bound to L01 in rail revision.*
- [x] **(P1) Beta recovery scene** — was implied by old L03 copy but had no scenario. *Shipped: new L02 runs `recovery_after_lie` — dip + decay-driven recovery both visible.*
- [x] **(P1) Sleeper-agent scene** — mid-mission Byzantine flip had no lesson. *Shipped: new L05 runs `late_range_lie`.*
- [x] **(P1) V3 presence scene** — `sybil_cabal` existed but no lesson taught it. *Shipped: new L07.*
- [x] **(P1) Map-layer attack scene** — three COP attacks (`cop_phantom`, `cop_suppress`, `cop_fob_corrupt`) shipped but no lesson taught them. *Shipped: new L08 runs `cop_corruption_full`, a composite that unions all three flavors under a single `rangeLie(A0)` wrapper.*
- [ ] **(P2) L04 sensor realism deepening** — copy talks about NLOS, multipath, noise floor; no visible NLOS event, no per-link noise inspector beyond the σ=5m fuzz already shipped.
- [ ] **(P3) Cross-attack composite "full demo"** — old L09's ambition (everything at once) was never properly delivered; the rail revision drops the slot rather than ship a stub. Worth revisiting if/when a genuine multi-defense composite scenario is built.

## 3. Attack-space gaps in the catalog

Beyond what's wired today.

- [ ] **(P1) `cop_mislocate`** — compromised drone reports a real item at *wrong coordinates*. Third class alongside phantom (new contact) and suppression (omit). Probably the most realistic spoofed-recon attack. *Mechanism shipped (ADR 0019 Python ContactReport + MapAttack); just needs a new MapAttack flavor that emits a real-id contact at perturbed coordinates.*
- [ ] **(P2) `cop_cosigned_phantom`** — two compromised drones cosign the same phantom. Combined trust weight passes the COP filter unless Tier 1/2 catches at least one. Stress-tests the filter threshold. *Mechanism shipped (multiple MapAttack reporters supported); just needs scenario construction with two attacker MapAttacks targeting the same phantom_contacts.*
- [x] **(P2) `cop_fob_corrupt`** — A0 reports the friendly FOB as hostile or at the wrong location. *Shipped as standalone scenario; also folded into `cop_corruption_full` composite for L08. ADR 0019 promotes the Python eval mechanism (Coverage Parity Wave 3).*
- [x] **(P2) Compromise mid-mission** — *Shipped: `late_range_lie` scenario, bound to L05 in rail revision. `attackStartTick` is also live-controllable via AttackDock slider.*
- [x] **(P3) `replay_storm`** — bulk replay of past observations; tests the replay window under load. *Shipped alongside Lesson 02 scene.*
- [ ] **(P3) `beacon_spoof`** — exists in `sim-core/attacks.ts` (per index export) but no `ATTACK_CATALOG` entry uses it.
- [ ] **(P3) Two-honest-vs-one-byzantine in tight quorum** — does Tier 2 still catch when only one trusted partner is in range?

## 4. Map / COP feature gaps

Beyond what's rendered.

- [ ] **(P1) Raw vs COP toggle** — currently the canvas shows the trust-fused COP. A toggle to "RAW · all reports unfiltered" would make the filtering mechanism legible by contrast (phantoms appear solid in raw, ghosted in COP).
- [ ] **(P2) Per-item provenance card** — click an item to see who reported, when (first-seen tick), current trust weight, full reporter list, suppression history. *Substrate shipped 2026-05-18 via ADR 0022 §1: `PoseGraphTS.factorProvenance(factor)` exposes `reporterId / insertionTick / reputationAtInsertion`; `OccupancyMapMerger.cellReporters()` exposes the per-cell reporter set persisted across `merge()` calls. UI integration (the card itself) is the remaining work.*
- [ ] **(P3) Contact age decay** — old contacts in the COP should age out unless re-confirmed. Currently a single tick-30 sighting persists forever. *Mechanism partly shipped 2026-05-18 via ADR 0022 §§3/6: stale-singleton fade decays single-reporter contributions to zero over `T_CORROBORATE + T_FADE = 400` ticks past insertion (gated by `enable_singleton_fade(True)` + `set_current_tick`). Multi-reporter cells stay un-decayed — corroboration is the lift mechanism. UI surfacing the fade as a visual ghost is the remaining work.*
- [ ] **(P2) Shared-map convergence indicator** — beyond AO coverage %, show "% of items where all trusted drones agree on location" as a fidelity metric.
- [ ] **(P3) Multi-tick freshness indicator on items** — color-code by "last confirmed N ticks ago."

## 5. Interactive affordances

Currently the user is a scrubber-driven observer. Hands-on poking would tighten the demo loop.

- [ ] **(P1) Click-to-compromise** — click any drone to manually flip it to a chosen attack mode mid-sim. Replaces fixed-script scenarios with audience-driven experimentation.
- [ ] **(P2) Click-to-task** — click an AO point to redirect a drone there. Lets the audience steer exploration past the frontier picker.
- [ ] **(P2) Time-of-attack slider** — surface `attackStartTick` as a control instead of a constant.
- [ ] **(P2) Compromise-count selector** — choose how many drones are compromised (currently 1, sometimes 2 for colluder).
- [ ] **(P3) Trust-threshold slider** — `COP_TRUST_THRESHOLD` (0.5) exposed live; audience watches the COP filter tighten/relax.
- [ ] **(P3) Save/load scenario state** — capture a tick and share a permalink.

## 6. Realism / verisimilitude gaps

- [ ] **(P2) NLOS / occlusion near buildings** — drones flying near the industrial complex should have degraded ranges. Currently noise is uniform across the AO.
- [ ] **(P2) Drone loss / failure** — agents are indestructible. A "drone N destroyed at tick X" scenario tests swarm recovery.
- [ ] **(P3) Range-based comms partition** — `linkPredicate` is currently used as a clique mask. A distance-based version would partition organically as drones drift apart.
- [ ] **(P3) Battery / endurance constraint** — drones currently run forever; finite endurance forces RTB decisions and competing-priorities trade-offs.
- [ ] **(P3) Wind / external disturbance on pose** — would justify the `drift_pose` no-op scenario being a non-no-op once map merger is in.

## 7. Polish / lower-payoff items

- [ ] **(P3) Drone callsigns (ALPHA…HOTEL)** — proposed in slice 1 planning, deferred to keep scope small. Cosmetic but improves narrative pitch.
- [ ] **(P3) Animated transitions** — items fade in as detected (not snap), fog has a soft edge instead of cell-blocky.
- [ ] **(P3) Mobile / narrow-viewport layout** — current Inspector / status overlays assume desktop width.
- [ ] **(P3) Keyboard shortcuts surfaced** — `[`, `]`, space, arrows exist but aren't documented in-UI.

## 8. Behavioral edge cases worth a scene

- [x] **(P2) Recovery after false positive** — *Shipped: `recovery_after_lie` scenario, bound to L02 ("Reputation that forgives") in rail revision. Dip + decay-driven recovery both visible on the sparklines.*
- [ ] **(P2) Sybil under V3 presence** — `sybil_cabal` exists. Worth checking that the post-slice-2 fog-of-war doesn't accidentally render phantom agents at (120, 50) and (-20, 50) — phantoms are *outside* the AO so they're clipped, which may also need a visual "OUT OF AO" callout.
- [ ] **(P3) Total swarm wipeout** — what does the UI show if every drone goes byzantine? Currently undefined; probably worth a defensive empty-state.

---

## Prioritization (one editor's read)

If picking three:

1. ~~**Tier 2 MDS panel** (§1)~~ ✅ shipped — merged into `TrustPanel`.
2. ~~**Reputation timeline sparklines** (§1)~~ ✅ shipped — `AgentRepList` full-run sparklines with cursor.
3. ~~**Lessons 01 + 02 scenes** (§2)~~ ✅ shipped — `forged_envelope` + `replay_storm` with on-canvas rejection markers.

All three P1 picks closed. Remaining P1s: Tier 1 reciprocal residual hover readout, `cop_mislocate` attack, raw-vs-COP toggle, click-to-compromise. The 2026-05-17 rail revision also closed §2 (curriculum coverage) almost entirely — sleeper agent, V3 presence, false-positive recovery, and map-layer attacks all now have lessons.
