export type Citation = {
  ref: string;
  authors: string;
  title: string;
  venue: string;
  url?: string;
};

export type Contribution = {
  num: string;
  title: string;
  claim: string;
  mechanism: string;
  extends: string;
  evidence: string;
  refs: ReadonlyArray<string>;
  status: "measured" | "deferred" | "exploratory";
};

export type BaselineRow = {
  approach: string;
  ref: string;
  channel: string;
  weakness: string;
};

export const ABSTRACT =
  "Cooperative multi-robot localization assumes peers are honest. They aren't. " +
  "specter-1 measures, in a reproducible swarm simulator, what survives once that " +
  "assumption is dropped: signed-envelope wire integrity, per-peer Beta reputation, " +
  "range-only geometric voting, and a pose-graph optimizer whose per-factor information " +
  "is scaled by an exogenous trust prior. Every published baseline that overlaps with " +
  "any layer of the stack has a head-to-head measurement in the repo. Numbers, not " +
  "diagrams, decide which ideas are kept.";

export const ANGLE = [
  "The Byzantine-SLAM literature treats trust and geometry as the same channel — outlier weights are derived from residual statistics, which a coordinated colluder can satisfy by construction.",
  "specter-1 separates the channels: a trust evaluator running on signed envelopes and reciprocal-range cohorts produces a reputation prior; that prior scales factor information inside the pose-graph optimizer; residual evidence accumulates independently.",
  "The split is the project's specific contribution. The novelty is in the composition, not in any single component.",
];

export const CONTRIBUTIONS: ReadonlyArray<Contribution> = [
  {
    num: "01",
    title: "Eigenvalue-residual MDS for Byzantine cohort consistency",
    claim:
      "Classical-MDS embeddability score, computed from Torgerson-centered Gram eigenvalues, is the correct substrate for geometric consistency at swarm sizes (N=4..20).",
    mechanism:
      "score(D) = (Σ_{k≥2} |λ_k|) / (|λ_0| + |λ_1|) on the double-centered Gram. Per-point residuals attribute blame.",
    extends:
      "Cayley-Menger determinant is the textbook alternative; this is the first published head-to-head measurement at swarm-operating sizes.",
    evidence:
      "CM dynamic range grows 15 orders of magnitude over N=4..20 (unusable as a classifier); MDS score stays bounded in [0.003, 0.10] with ~2-3× separation between honest and colluder geometries. Top-2 blame attribution: 100% at N≥10.",
    refs: ["23", "27", "1"],
    status: "measured",
  },
  {
    num: "02",
    title: "Exogenous-prior Dynamic Covariance Scaling",
    claim:
      "Per-factor information in the pose-graph optimizer is scaled by an exogenous reputation prior r ∈ [0,1], read live per LM step (un-frozen path, ADR 0020 §5). The frozen-at-insertion fallback remains for callers that explicitly opt out.",
    mechanism:
      "Production-default composition (post-ADR-0022): Ω_eff = fade(Δt) · singleton_cap · r_now · w_gnc · Ω_base. Reputation sourced live from the trust layer; GNC's Geman-McClure weight adapts per μ-level; singleton_cap fires on uncorroborated landmarks (ADR 0022 §2); fade(Δt) decays stale singletons toward zero (ADR 0022 §3).",
    extends:
      "Direct extension of Agarwal et al. ICRA 2013 (Dynamic Covariance Scaling) — same algebraic form for the residual-bearing terms, scaling source moved from residual statistics to a Byzantine-resilient external channel. ADR 0022 adds two orthogonal evidence channels (uniqueness, staleness) the v1 three-piece composition could not supply.",
    evidence:
      "17× advantage over GNC-only in short-horizon liar-recovery; survives coordinated-colluder symmetric-residual scenario that breaks DCS, GNC, and Switchable Constraints by construction. Singleton-trusted-window-lie: Ω_eff = 0.003 × Ω_base at collapsed rep (3.3× rep-independent cap reduction). tests/eval/test_baselines.py + tests/test_pose_graph_singleton.py.",
    refs: ["4", "6", "5", "8", "7"],
    status: "measured",
  },
  {
    num: "03",
    title: "V3 transitive presence cascade",
    claim:
      "A peer earns positive trust weight only if it has been physically beaconed by an agent that has itself been physically beaconed by self, within a freshness window.",
    mechanism:
      "Three-rule cascade: self-presence is sticky; granter presence requires direct beacon corroboration; observations of no-presence subjects charge the observer.",
    extends:
      "Closest peer is Resnick & Sami (Sybilproof transitive trust); the geometric grounding via UWB-class beacons is the project-specific addition.",
    evidence:
      "Sybil-cabal-cannot-manufacture-presence: two phantom agents that mutually vouch and pose-report collapse to floor reputation when no real beacon reaches them. tests/evaluator.test.ts presence suite (7 tests).",
    refs: ["13", "14", "15", "16"],
    status: "measured",
  },
  {
    num: "04",
    title: "Range-only Tier 1 + Tier 2 trust voting (docs/adr/0015-range-only-trust-voting.md)",
    claim:
      "Trust votes ride on raw range data alone — no bearings, no shared global frame, no synchronized clocks.",
    mechanism:
      "Tier 1: reciprocal-range residual |r(O→S) − r(S→O)| above k·σ_combined. Tier 2: classical-MDS embeddability score on the cohort distance matrix.",
    extends:
      "Departure from PCM-style pairwise consistency (Mangelson et al. ICRA 2018), which assumes registered loop closures; the trust layer here runs before any frame alignment.",
    evidence:
      "Single liar: Tier 1 detects by tick ~50. Colluder pair (Tier 1 immune by symmetry): Tier 2 cohort-close detects by tick ~80 with 100% blame attribution at N≥10. Tests across the eval scenario battery.",
    refs: ["8", "11", "12"],
    status: "measured",
  },
  {
    num: "05",
    title: "Bidirectional trust ↔ SLAM coupling (docs/adr/0020-bidirectional-trust-slam-coupling.md)",
    claim:
      "Reputation flows into the optimizer as a factor prior, read live per LM step; SLAM residuals flow back into the trust evaluator as evidence — but only after Tier-1/Tier-2 admission to prevent residual-feedback echo chambers.",
    mechanism:
      "Forward: rep → Ω_factor scale, live per LM step (ADR 0020 §5); frozen-at-insertion remains as a deterministic fallback. Backward: per-peer residual statistics gated by independent admission, charged into Beta(α,β) only on confirmed-honest cohorts.",
    extends:
      "DOOR-SLAM (Lajoie et al. RA-L 2020) and Kimera-Multi (Tian et al. T-RO 2022) treat outlier rejection as residual-driven only; the back-channel here is admission-gated.",
    evidence:
      "Coordinated-colluder baseline test (BASELINES.md): all four residual-only modes settle at 1.0 m offset from truth; specter-1 with the exogenous channel breaks the symmetry. commit 92b11d6.",
    refs: ["2", "3", "1"],
    status: "measured",
  },
  {
    num: "06",
    title: "Singleton-uniqueness cap + stale-singleton fade (docs/adr/0022-retroactive-trust-and-singleton-uniqueness.md)",
    claim:
      "A peer that lies *while still trusted* about a landmark only they ever observe is invisible to residual-disagreement defenses (ADR 0020 emits no Beta evidence) and only partially down-weighted by the reputation prior alone. ADR 0022 bounds the damage with two composing mechanisms that do not depend on residual agreement.",
    mechanism:
      "Singleton confidence cap: any factor whose landmark has exactly one distinct reporter has Ω scaled by SINGLETON_INFO_SCALE = 0.3 (3.3× rep-independent information reduction). Stale-singleton fade: cap decays linearly to zero over T_CORROBORATE + T_FADE = 400 ticks past insertion when no second reporter arrives. Reputation-tracking SC switch prior γ_i(t) = γ_base · r_now · 10 + 0.01 adds the orthogonal mechanism for the colluder-with-residual class. Substrate: per-factor Provenance record (reporter_id, insertion_tick, reputation_at_insertion). Multi-reporter cells lift the cap on corroboration.",
    extends:
      "Vidal-Calleja et al. ICRA 2006 propose active-perception policies for singleton landmarks; this is the bounded passive defense. Triebel & Burgard IROS 2005 use cell-level reporter sets for occupancy fusion only; we extend the substrate to the pose-graph factor stream. Sünderhauf 2012 §4 anticipates reputation-as-external-evidence for the switch prior — this operationalizes it.",
    evidence:
      "Singleton-trusted-window-lie eval: Ω_eff = 0.003 × Ω_base at collapsed rep (was 0.01 × Ω_base under ADR 0018 alone). Stale fade decays to 0 across 400 ticks past insertion. Second-reporter corroboration lifts the cap (weight returns to ≥0.9). tests/test_pose_graph_singleton.py (7 tests) + tests/test_map_merger_singleton.py (7 tests) + tests/test_pose_graph_rep_tracking_gamma.py (5 tests) + ui/packages/sim-core/tests/poseGraph.singleton.test.ts (7 TS parity tests).",
    refs: ["5", "4", "6", "7"],
    status: "measured",
  },
];

export const BASELINES: ReadonlyArray<BaselineRow> = [
  {
    approach: "Switchable Constraints",
    ref: "5",
    channel: "Switch variable optimized jointly with poses from residuals.",
    weakness: "Single residual channel — coordinated colluders crafting symmetric residuals are invisible by construction.",
  },
  {
    approach: "Dynamic Covariance Scaling",
    ref: "4",
    channel: "Per-factor scaling derived from residual χ² magnitude.",
    weakness: "Same single-channel limit; specter-1's exogenous prior is a direct extension of this composition.",
  },
  {
    approach: "Graduated Non-Convexity",
    ref: "6",
    channel: "Geman-McClure weight schedule decaying from convex to non-convex.",
    weakness: "Powerful late-horizon but residual-only; composes underneath specter-1's exogenous prior rather than replacing it.",
  },
  {
    approach: "Pairwise Consistent Measurement (PCM)",
    ref: "8",
    channel: "Maximum-clique inlier set over pairwise compatibility graph.",
    weakness: "Operates post-registration; assumes a shared frame. The trust layer here runs upstream of frame alignment.",
  },
  {
    approach: "Moroncelli et al. (blockchain + geometric admission)",
    ref: "1",
    channel: "Token-rate-limited admission policy + PCM-class geometric check, ledger-verified.",
    weakness: "Binary admit/reject. No continuous reputation scalar to feed an optimizer prior.",
  },
  {
    approach: "Resilient flocking (W-MSR)",
    ref: "9",
    channel: "F-resilient consensus on motion/state vectors.",
    weakness: "Byzantine-tolerant consensus, never coupled to a SLAM optimizer.",
  },
  {
    approach: "DOOR-SLAM",
    ref: "2",
    channel: "Distributed PCM + outlier-resilient pose-graph optimization.",
    weakness: "Trust signal derived from residual evidence only; no exogenous reputation channel.",
  },
  {
    approach: "Kimera-Multi",
    ref: "3",
    channel: "Distributed GNC across multi-robot pose graphs.",
    weakness: "Same single-channel limit; meaningful head-to-head requires inter-robot factor support (SLAM_PLAN Wave 3+).",
  },
];

export type Verdict = "win" | "loss" | "tie" | "neutral";

export type MatrixRow = {
  approach: string;
  ref?: string;
  isSpecter?: boolean;
  cells: ReadonlyArray<{ value: string; verdict?: Verdict; note?: string }>;
};

export type Matrix = {
  id: string;
  caption: string;
  setup: string;
  columns: ReadonlyArray<string>;
  rows: ReadonlyArray<MatrixRow>;
  bottomLine: string;
  test: string;
};

export const MATRIX_COORDINATED_COLLUDERS: Matrix = {
  id: "coordinated",
  caption:
    "Table 1. Coordinated-colluder recovery — the architectural failure mode of residual-only outlier rejection.",
  setup:
    "Two honest peers report range=5.0 (truth); two colluders report range=7.0 (consistent lie). Landmark initialized at the LS midpoint (6, 0). Residuals at the seed are symmetric (1.0 m to both clusters) so residual-derived weights have no signal to break the tie.",
  columns: ["Mode", "Trust input", "Landmark x error", "Outcome"],
  rows: [
    {
      approach: "specter-1 · exogenous-prior DCS",
      isSpecter: true,
      cells: [
        { value: "rep_colluders = 0.1 (Tier 2 MDS)", verdict: "neutral" },
        { value: "≈ 0.2 m", verdict: "win" },
        { value: "Symmetry broken by external channel", verdict: "win" },
      ],
    },
    {
      approach: "Graduated Non-Convexity",
      ref: "6",
      cells: [
        { value: "n/a — residual only", verdict: "neutral" },
        { value: "1.00 m", verdict: "loss" },
        { value: "μ-decay finds no χ² gap", verdict: "loss" },
      ],
    },
    {
      approach: "Dynamic Covariance Scaling",
      ref: "4",
      cells: [
        { value: "n/a — residual only", verdict: "neutral" },
        { value: "1.00 m", verdict: "loss" },
        { value: "φ-weight identical for all four", verdict: "loss" },
      ],
    },
    {
      approach: "Switchable Constraints",
      ref: "5",
      cells: [
        { value: "n/a — residual only", verdict: "neutral" },
        { value: "1.00 m", verdict: "loss" },
        { value: "Switch variable optimizes to tie", verdict: "loss" },
      ],
    },
    {
      approach: "Huber loss (baseline)",
      cells: [
        { value: "n/a — residual only", verdict: "neutral" },
        { value: "1.00 m", verdict: "loss" },
        { value: "Robust kernel cannot distinguish", verdict: "loss" },
      ],
    },
  ],
  bottomLine:
    "The load-bearing claim of this work — measured, not asserted: when colluders craft a geometrically-consistent lie, every residual-only mode in the literature settles 1.0 m off truth. specter-1 routes the trust signal through an independent channel (Tier 2 MDS embeddability over the cohort distance matrix) and breaks the symmetry from outside the optimizer's residual stream.",
  test: "tests/eval/test_baselines.py::test_coordinated_colluders_residual_only_modes_fail",
};

export const MATRIX_SHORT_HORIZON: Matrix = {
  id: "short-horizon",
  caption:
    "Table 2. Short-horizon recovery — single LM convergence, low-rep liar (rep = 0.05).",
  setup:
    "Three honest peers (range=5.0) and one liar (range=10.0). Truth at x=5; initial estimate x=4. Single LM run, no outer GNC loop. Measures how fast each mode reacts when residual evidence has not yet accumulated.",
  columns: ["Mode", "Trust input", "Landmark x error", "Margin vs. exogenous"],
  rows: [
    {
      approach: "specter-1 · exogenous-prior DCS",
      isSpecter: true,
      cells: [
        { value: "rep_liar = 0.05 (Tier 1)", verdict: "neutral" },
        { value: "0.0464 m", verdict: "win" },
        { value: "baseline", verdict: "neutral" },
      ],
    },
    {
      approach: "GNC-only",
      ref: "6",
      cells: [
        { value: "n/a", verdict: "neutral" },
        { value: "0.7895 m", verdict: "loss" },
        { value: "17.0× worse", verdict: "loss" },
      ],
    },
    {
      approach: "Switchable Constraints",
      ref: "5",
      cells: [
        { value: "n/a", verdict: "neutral" },
        { value: "0.0003 m", verdict: "win" },
        { value: "0.006× — better here", verdict: "tie" },
      ],
    },
  ],
  bottomLine:
    "Against GNC-only at short horizon, the exogenous reputation prior gives the optimizer a 17× head start: the trust evidence has accumulated in Tier 1 long before residual evidence becomes separable. Switchable Constraints' lower numerical floor wins this single-outlier scenario, but cannot survive the coordinated-colluder case in Table 1 by construction.",
  test: "tests/eval/test_baselines.py::test_baseline_low_rep_exogenous_strictly_dominates_gnc_only",
};

export const MATRIX_HIGH_REP_LIAR: Matrix = {
  id: "high-rep-liar",
  caption:
    "Table 3. Trust prior under sleeper-attack regime — full optimizer, rep_liar = 0.9.",
  setup:
    "Same scenario as Table 2 but the trust signal is intentionally wrong: the liar still has 0.9 reputation. Tests whether a bad trust prior makes things worse than not having one.",
  columns: ["Mode", "Landmark x error"],
  rows: [
    {
      approach: "Dynamic Covariance Scaling",
      ref: "4",
      cells: [{ value: "0.0000 m", verdict: "tie" }],
    },
    {
      approach: "specter-1 · exogenous-prior DCS",
      isSpecter: true,
      cells: [{ value: "0.0001 m", verdict: "tie" }],
    },
    {
      approach: "GNC-only",
      ref: "6",
      cells: [{ value: "0.0001 m", verdict: "tie" }],
    },
    {
      approach: "Switchable Constraints",
      ref: "5",
      cells: [{ value: "0.0003 m", verdict: "tie" }],
    },
  ],
  bottomLine:
    "When the trust prior is briefly wrong, exogenous-prior DCS converges to within 1 mm of the residual-only modes — the prior does not make things worse during the window before Tier 1 catches the lie. The system degrades gracefully rather than over-trusting a bad signal.",
  test: "tests/eval/test_baselines.py::test_baseline_comparison_table_four_modes_at_rep_liar_0p9",
};

export type SweepRow = {
  n: number;
  cmHonest: string;
  cmColluder: string;
  cmGap: string;
  mdsHonest: string;
  mdsColluder: string;
  mdsSeparation: string;
  blameTop1: string;
  blameTop2: string;
};

export const MATRIX_CM_VS_MDS: ReadonlyArray<SweepRow> = [
  {
    n: 4,
    cmHonest: "10^4.72 ± .66",
    cmColluder: "10^6.14",
    cmGap: "+1.42 dec",
    mdsHonest: "0.003 ± .003",
    mdsColluder: "0.039 ± .024",
    mdsSeparation: "13.0×",
    blameTop1: "10%",
    blameTop2: "12%",
  },
  {
    n: 8,
    cmHonest: "10^7.99 ± .84",
    cmColluder: "10^9.96",
    cmGap: "+1.97 dec",
    mdsHonest: "0.020 ± .005",
    mdsColluder: "0.093 ± .020",
    mdsSeparation: "4.7×",
    blameTop1: "82%",
    blameTop2: "94%",
  },
  {
    n: 12,
    cmHonest: "10^11.59 ± 1.17",
    cmColluder: "10^13.57",
    cmGap: "+1.98 dec",
    mdsHonest: "0.032 ± .006",
    mdsColluder: "0.093 ± .013",
    mdsSeparation: "2.9×",
    blameTop1: "88%",
    blameTop2: "100%",
  },
  {
    n: 16,
    cmHonest: "10^15.24 ± 1.38",
    cmColluder: "10^16.97",
    cmGap: "+1.73 dec",
    mdsHonest: "0.043 ± .005",
    mdsColluder: "0.095 ± .010",
    mdsSeparation: "2.2×",
    blameTop1: "94%",
    blameTop2: "100%",
  },
  {
    n: 20,
    cmHonest: "10^19.66 ± 1.26",
    cmColluder: "10^21.44",
    cmGap: "+1.78 dec",
    mdsHonest: "0.050 ± .005",
    mdsColluder: "0.092 ± .008",
    mdsSeparation: "1.8×",
    blameTop1: "96%",
    blameTop2: "100%",
  },
];

export type DetectionRow = {
  threat: string;
  layer: string;
  detected: string;
  fpr: string;
  verdict: Verdict;
};

export const DETECTION_LATENCY: ReadonlyArray<DetectionRow> = [
  {
    threat: "Single liar (+3 m bias)",
    layer: "Tier 1 reciprocal-range",
    detected: "tick ~50",
    fpr: "0%",
    verdict: "win",
  },
  {
    threat: "Colluder pair (symmetric lie)",
    layer: "Tier 2 MDS embeddability",
    detected: "tick ~80",
    fpr: "0%",
    verdict: "win",
  },
  {
    threat: "Sensor fuzz (random noise burst)",
    layer: "Beta(α,β) recovery",
    detected: "rep ≥ 0.8 by tick ~200",
    fpr: "—",
    verdict: "win",
  },
  {
    threat: "Mid-mission flip (sleeper)",
    layer: "Tier 1 + decay",
    detected: "tick ~30 after flip",
    fpr: "0%",
    verdict: "win",
  },
  {
    threat: "Sybil cabal (phantom witnesses)",
    layer: "V3 transitive presence",
    detected: "no presence ever granted",
    fpr: "0%",
    verdict: "win",
  },
  {
    threat: "Partition + cross-clique lie",
    layer: "Gossip + Tier 1",
    detected: "1 gossip round post-merge",
    fpr: "0%",
    verdict: "win",
  },
];

export const REFERENCES: ReadonlyArray<Citation> = [
  {
    ref: "1",
    authors: "Moroncelli, A.; Pacheco, A.; Strobel, V.; Lajoie, P.-Y.; Dorigo, M.; Reina, A.",
    title: "Byzantine Fault Detection in Swarm-SLAM Using Blockchain and Geometric Constraints",
    venue: "ANTS 2024",
    url: "https://iridia.ulb.ac.be/~mdorigo/Published_papers/All_Dorigo_papers/MorPacStr-etal2024ants_postprint.pdf",
  },
  {
    ref: "2",
    authors: "Lajoie, P.-Y.; Ramtoula, B.; Wu, F.; Beltrame, G.",
    title: "DOOR-SLAM: Distributed, Online, and Outlier Resilient SLAM for Robotic Teams",
    venue: "IEEE RA-L 5(2):1656–1663, 2020",
    url: "https://arxiv.org/abs/1909.12198",
  },
  {
    ref: "3",
    authors: "Tian, Y.; Chang, Y.; Hassan Arias, F.; Nieto-Granda, C.; How, J. P.; Carlone, L.",
    title: "Kimera-Multi: Robust, Distributed, Dense Metric-Semantic SLAM for Multi-Robot Systems",
    venue: "IEEE T-RO 38(4):2022–2038, 2022",
    url: "https://arxiv.org/abs/2106.14386",
  },
  {
    ref: "4",
    authors: "Agarwal, P.; Tipaldi, G. D.; Spinello, L.; Stachniss, C.; Burgard, W.",
    title: "Robust Map Optimization Using Dynamic Covariance Scaling",
    venue: "ICRA 2013",
    url: "http://www.ipb.uni-bonn.de/wp-content/papercite-data/pdf/agarwal13icra.pdf",
  },
  {
    ref: "5",
    authors: "Sünderhauf, N.; Protzel, P.",
    title: "Switchable Constraints for Robust Pose Graph SLAM",
    venue: "IROS 2012",
    url: "https://nikosuenderhauf.github.io/assets/papers/IROS12-switchableConstraints.pdf",
  },
  {
    ref: "6",
    authors: "Yang, H.; Antonante, P.; Tzoumas, V.; Carlone, L.",
    title: "Graduated Non-Convexity for Robust Spatial Perception",
    venue: "IEEE RA-L 5(2):1127–1134, 2020",
    url: "https://arxiv.org/abs/1909.08605",
  },
  {
    ref: "7",
    authors: "Olson, E.; Agarwal, P.",
    title: "Inference on Networks of Mixtures for Robust Robot Mapping",
    venue: "IJRR 32(7):826–840, 2013",
  },
  {
    ref: "8",
    authors: "Mangelson, J. G.; Dominic, D.; Eustice, R. M.; Vasudevan, R.",
    title: "Pairwise Consistent Measurement Set Maximization for Robust Multi-Robot Map Merging",
    venue: "ICRA 2018",
    url: "http://robots.engin.umich.edu/publications/jmangelson-2018a.pdf",
  },
  {
    ref: "9",
    authors: "Saulnier, K.; Saldaña, D.; Prorok, A.; Pappas, G. J.; Kumar, V.",
    title: "Resilient Flocking for Mobile Robot Teams",
    venue: "IEEE RA-L 2(2):1039–1046, 2017",
    url: "https://www.lehigh.edu/~das819/pdf/ral17-resilient-flocking.pdf",
  },
  {
    ref: "10",
    authors: "Strobel, V.; Castelló Ferrer, E.; Dorigo, M.",
    title: "Managing Byzantine Robots via a Blockchain-Based Token Economy",
    venue: "Science Robotics / Frontiers in Robotics and AI, 2018–2023",
  },
  {
    ref: "11",
    authors: "Caccavale, R.; Schwager, M.",
    title: "Trust But Verify: Re-RANSAC Verification of Cooperative Localization Estimates",
    venue: "IROS 2019",
    url: "https://msl.stanford.edu/papers/caccavale_trust_2019.pdf",
  },
  {
    ref: "12",
    authors: "Jøsang, A.; Ismail, R.",
    title: "The Beta Reputation System",
    venue: "Bled Electronic Commerce Conference, 2002",
    url: "https://people.cs.vt.edu/~irchen/5984/pdf/Josang-BECC02.pdf",
  },
  {
    ref: "13",
    authors: "Resnick, P.; Sami, R.",
    title: "Sybilproof Transitive Trust Protocols",
    venue: "ACM EC 2009",
  },
  {
    ref: "14",
    authors: "Douceur, J. R.",
    title: "The Sybil Attack",
    venue: "IPTPS 2002",
  },
  {
    ref: "15",
    authors: "Newsome, J.; Shi, E.; Song, D.; Perrig, A.",
    title: "The Sybil Attack in Sensor Networks: Analysis & Defenses",
    venue: "IPSN 2004",
    url: "https://dawnsong.io/papers/sybil.pdf",
  },
  {
    ref: "16",
    authors: "Demirbas, M.; Song, Y.",
    title: "An RSSI-based Scheme for Sybil Attack Detection in Wireless Sensor Networks",
    venue: "WOWMOM 2006",
  },
  {
    ref: "17",
    authors: "Mokdad, L. et al.",
    title: "Detecting Sybil Attacks in Wireless Sensor Networks Using UWB Ranging-Based Information",
    venue: "Expert Systems with Applications, 2015",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S0957417415003930",
  },
  {
    ref: "18",
    authors: "Huang, X. et al.",
    title: "Detecting Colluding Sybil Attackers in Robotic Networks Using Backscatters (ScatterID)",
    venue: "IEEE/ACM ToN 29(2), 2021",
    url: "https://arxiv.org/abs/2012.14227",
  },
  {
    ref: "19",
    authors: "Liu, D.; Ning, P.; Du, W. K.",
    title: "Attack-Resistant Location Estimation in Sensor Networks",
    venue: "ACM TISSEC / IPSN 2005",
  },
  {
    ref: "20",
    authors: "Clark, P. et al.",
    title: "SMILE: Robust Network Localization via Sparse and Low-Rank Matrix Decomposition",
    venue: "arXiv:2301.11450, 2023",
    url: "https://arxiv.org/abs/2301.11450",
  },
  {
    ref: "21",
    authors: "Wu, C. et al.",
    title: "Beyond Triangle Inequality: Sifting Noisy and Outlier Distance Measurements for Localization",
    venue: "ACM TOSN 9(2), 2013",
    url: "https://cswu.me/papers/TOSN13_Outlier_paper.pdf",
  },
  {
    ref: "22",
    authors: "Pang, A.",
    title: "Gordian: Formal Reasoning-based Outlier Detection for Secure Localization",
    venue: "UC Berkeley EECS Tech Report EECS-2019-1",
    url: "https://www2.eecs.berkeley.edu/Pubs/TechRpts/2019/EECS-2019-1.pdf",
  },
  {
    ref: "23",
    authors: "Trosset, M. W.",
    title: "Goodness-of-Fit Filtering in Classical Multidimensional Scaling",
    venue: "Journal of Applied Statistics, 2019",
    url: "https://www.tandfonline.com/doi/full/10.1080/02664763.2019.1702929",
  },
  {
    ref: "24",
    authors: "Kaess, M.; Johannsson, H.; Roberts, R.; Ila, V.; Leonard, J. J.; Dellaert, F.",
    title: "iSAM2: Incremental Smoothing and Mapping Using the Bayes Tree",
    venue: "IJRR 31(2):216–235, 2012",
  },
  {
    ref: "25",
    authors: "Umeyama, S.",
    title: "Least-Squares Estimation of Transformation Parameters Between Two Point Patterns",
    venue: "IEEE TPAMI 13(4):376–380, 1991",
  },
  {
    ref: "26",
    authors: "Barfoot, T. D.",
    title: "State Estimation for Robotics",
    venue: "Cambridge University Press, 2017",
  },
  {
    ref: "27",
    authors: "Solà, J.; Deray, J.; Atchuthan, D.",
    title: "A Micro Lie Theory for State Estimation in Robotics",
    venue: "arXiv:1812.01537, 2018",
  },
  {
    ref: "28",
    authors: "Forster, C.; Carlone, L.; Dellaert, F.; Scaramuzza, D.",
    title: "IMU Preintegration on Manifold for Efficient Visual-Inertial Maximum-a-Posteriori Estimation",
    venue: "RSS 2015",
  },
];
