ADR 0019: Python map-attack mechanism — Item / ContactReport / MapAttack / COP filter
======================================================================================

Status: Accepted (2026-05-17) — Coverage Parity PRD Wave 3 landed; `tests/eval/test_attack_battery.py` gates four COP scenarios in CI.

Context
-------

The React UI rail (`ui/packages/app/src/sim/contacts.ts`) implements a
trust-weighted Common Operating Picture (COP) — operator-facing aggregation
of every reporter's contact stream weighted by reporter reputation — and
demonstrates four map-layer adversaries against it: `cop_phantom`,
`cop_suppress`, `cop_fob_corrupt`, and the composite `cop_corruption_full`
(Lesson 08 in the rail per the curriculum revision shipped 2026-05-17).

The Python eval runner (`tests/eval/runner.py`) had **no equivalent**.
Notebook 07 (`07_cooperative_map_merge.ipynb`) derived occupancy-merger
trust-weighting statically with one hand-rolled liar fragment, but no
scenario exercised contact-report aggregation or COP filtering; the
`OccupancyMapMerger` (`src/specter/slam/map_merger.py`, ADR 0010) consumed
only occupancy grids. Coverage Parity Wave 3 (`docs/COVERAGE_PARITY_PRD.md`)
closes this gap by promoting the map-layer adversary primitives from
TS-only to a Python eval mechanism so notebook 07 can run them live and
THREAT_MODEL.md can name measured bounds.

Empirical inputs supporting this decision:

- Existing TS rail `MapAttack` shape (reporter_id, phantom_contacts,
  suppressed_item_ids) has shipped and worked through multiple iterations;
  no architectural rethink needed, just a port to the Python harness.
- `OccupancyMapMerger` already exposes `peer_weights: Mapping[str, float]`
  per ADR 0010 — the trust integration pattern is established. Contact-
  report aggregation is the *next* trust-weighted consumer, not a new
  paradigm.
- `tests/eval/test_map_convergence.py` already exercises the merger with
  trust-weighted vs uniform weights (US-011 + US-012). The COP filter
  is a thinner consumer (sum-and-threshold) than the occupancy fusion.

Decision
--------

Add four primitives at the eval harness layer, with two of them
(`Item` and `ContactReport`) promoted into the library proper so
production code can adopt them later without re-architecting:

1. **`Item`** in `src/specter/sim/world.py` — frozen dataclass
   `(id: str, kind: str, x: float, y: float)`. Distinct from `Landmark`
   (jointly-estimated SLAM feature per ADR 0016): an `Item` is a
   *reportable contact* — a UXO, friendly FOB, vehicle, etc. Added as
   `World.items: tuple[Item, ...]` with a default-empty factory so
   pre-Wave-3 callers keep working.

2. **`ContactReport`** in `src/specter/messages.py` — frozen dataclass
   `(reporter_id, contact_id, kind, x, y, timestamp_ns)` plus
   `KIND_CONTACT_REPORT = "contact_report"` registered in the wire
   decoder. Distinct from `LandmarkObservation` (range-bearing
   measurement to a known landmark, used by pose-graph SLAM): a
   ContactReport carries the reporter's *world-frame estimate* of an
   item — this is the input to the COP. Position is world-frame because
   the COP is operator-facing; reporter SLAM drift becomes part of the
   reported position. The fault domain is documented (operator's COP
   sees drift; trust path stays range-only per ADR 0015).

3. **`MapAttack`** in `tests/eval/runner.py` — frozen dataclass
   `(reporter_id, phantom_contacts: tuple[Item, ...],
   suppressed_item_ids: tuple[str, ...])`. **Eval-only**, not in
   `src/specter/`: this is an *adversary* primitive for scenarios, not a
   production type. Multiple MapAttacks may be active in one scenario
   as long as they target different reporters; composite attacks on a
   single reporter live in one MapAttack with both fields populated.

4. **`build_cop()`** + **`CopEntry`** in `tests/eval/runner.py`.
   `build_cop(contact_log, reputations, threshold=0.5) -> dict[contact_id, CopEntry]`.
   Group reports by `contact_id`; for each group, compute the average
   reputation across the *distinct set* of reporters; keep entries where
   the average ≥ `COP_TRUST_THRESHOLD = 0.5` (matches the TS rail
   constant byte-for-byte). Position is the mean across all reports
   (rejects geometric jitter). The threshold defaults are wired so the
   filter behavior is identical to the TS `copView()` even though the
   storage layers diverge.

### Wire flow

Per-tick contact emission, gated on `scenario.items` or
`scenario.map_attacks` being non-empty (zero overhead for non-COP
scenarios):

```
for each agent a:
    suppressed = map_attacks[a.id].suppressed_item_ids   # or empty
    for each item in scenario.items:
        if item.id in suppressed: continue
        if dist(a, item) > scenario.cop_sensor_radius_m: continue
        emit ContactReport(a.id, item.id, item.kind, item.x, item.y, ts)
    for phantom in map_attacks[a.id].phantom_contacts:    # if any
        emit ContactReport(a.id, phantom.id, phantom.kind, phantom.x, phantom.y, ts)
```

A single shared subscriber (`_make_contact_collector`) appends accepted
envelopes (signature + replay-window verified via `open_envelope`) to a
single `contact_log: list[ContactReport]`. The bus is broadcast and
**`link_predicate` does not gate contacts** in this wave — partition
behavior is a Wave 2 concern for observations only; if a future scenario
needs partitioned contact delivery, the predicate can be extended to a
second per-channel flag.

At end-of-run, `build_cop(contact_log, avg_rep_by_peer)` produces the
aggregate; `EvaluationResult.cop` is the operator's filtered view,
`EvaluationResult.contact_log` is the raw audit trail.

### Trust-weighting hook

Reporter reputation is sourced from the average across honest viewers'
final per-peer `BetaTrustEvaluator.reputation()` outputs. This matches
the rail's "consensus reputation" semantics: the swarm's median verdict
drives the COP filter, not any single agent's view. Future iterations
can swap to per-receiver COP views when partition semantics for
contacts are introduced.

### Composition with the OccupancyMapMerger (ADR 0010)

The COP filter and the occupancy merger are **independent** trust-
weighted consumers. Both read `peer_weights` from the trust scalar;
neither feeds the other. A future bidirectional adapter (mirroring
ADR 0016's trust↔SLAM coupling discussion) could fuse contact reports
into the occupancy grid as point-mass observations, but Wave 3 stops at
the COP filter to keep scope tight. The hook lives in
`build_cop()` — replacing it with a merger-aware variant is one function
swap when the time comes.

Consequences
------------

**Wins:**

- Four `cop_*` scenarios run in the Python eval, gated in CI, with
  bound assertions in `tests/eval/test_attack_battery.py`
  (`test_cop_phantom_suppressed_once_reporter_collapses`,
  `test_cop_suppress_real_item_survives_via_redundancy`,
  `test_cop_fob_corrupt_anchor_protected`,
  `test_cop_corruption_full_composite_defeated`).
- Notebook 07 gains a live attack cell — first time the curriculum
  exercises the map-layer adversary surface on the Python side.
- THREAT_MODEL.md gains four new rows with measured bounds.
- The notebook ↔ rail cross-reference table reaches parity on the
  COP/map row — no more "rail-only live demo" qualifier.

**Costs / scope boundaries:**

- `MapAttack` is eval-only and intentionally not added to `src/specter/`.
  Production map-attack handling (e.g., a deployment where attestation
  records that a contact came from a compromised reporter) is out of
  scope; if hardware Phase 1 wants this, a follow-up ADR can promote
  the eval mechanism with appropriate envelope-attestation linkage.
- `Item` and `ContactReport` *are* in `src/specter/` (library code) but
  with no consumer outside the eval harness yet. This is intentional —
  the wire shape is what production needs to commit to early; the
  consumer can come later without re-marshalling. Pattern matches ADR
  0016's preservation hooks (factor residuals exposed before any
  consumer needs them).
- COP position is world-frame; reporter SLAM drift bleeds in. Acceptable
  at MVP / sim scale (drift bounded to 0.5 m by ADR 0007 scan-match);
  may need amendment when Phase 2 hardware shifts to noisier UWB-only
  setups, where the merger's pose-correction loop will need to land
  upstream of contact emission.
- Per-link gating of contacts is **not** implemented in Wave 3. The
  observation `link_predicate` does not touch the contact channel.
  Wave 4's partition variants of cop_corruption_full will need this
  extension.

**Out of scope for this ADR / future work:**

- Per-receiver COP views (current implementation is global aggregate).
- Bidirectional trust↔COP coupling (e.g., feeding COP residuals back
  into Tier 1/Tier 2 votes). Symmetric to the trust↔SLAM contract
  discussed in ADR 0016 — a real research question, not a sim
  shortcoming.
- Promoting MapAttack to a production adversary modeling primitive
  (would need attestation linkage).

Related ADRs
------------

- ADR 0010 (Map-merger occupancy voting) — the original trust-weighted
  fusion layer. ADR 0019's COP filter is its sibling consumer.
- ADR 0015 (Range-only trust voting) — the trust scalar this ADR
  consumes. Contact reports carry world-frame positions but the
  reputation that weights them comes from range-only voting.
- ADR 0016 (Pose-graph substrate and trust↔SLAM contract) — landmark
  observations (jointly-estimated features) are distinguished from
  contact reports (operator-facing items) by their consumer; both
  share the wire layer.

Revisit when
------------

- Hardware Phase 1 lands and operators want a deployable COP filter.
- Per-link contact delivery gating is needed for partitioned-network
  COP scenarios.
- A bidirectional adapter between contact reports and the occupancy
  merger is proposed.
