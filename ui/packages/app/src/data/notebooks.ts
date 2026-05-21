export type Arc =
  | "Foundations"
  | "Trust"
  | "Sim & SLAM"
  | "Composition";

export type Notebook = {
  id: string;
  slug: string;
  title: string;
  teaches: string;
  arc: Arc;
  proves: string;
  limit: string;
  liveLesson?: string;
};

export const NOTEBOOKS: ReadonlyArray<Notebook> = [
  {
    id: "01",
    slug: "01_signed_envelopes_and_bus",
    title: "Signed envelopes & the bus",
    teaches:
      "ECDSA-signed envelopes, the 5 rejection categories, the receive pipeline.",
    arc: "Foundations",
    proves: "tests/test_secure_bus.py",
    limit: "THREAT_MODEL.md § hardware-key-compromise",
    liveLesson: "01",
  },
  {
    id: "02",
    slug: "02_identity_lifecycle",
    title: "Identity lifecycle",
    teaches:
      "MutableRoster, KeyRotationAnnouncement, RevocationList, MockAttestationProvider.",
    arc: "Foundations",
    proves: "tests/eval/test_identity_attacks.py",
    limit: "ADR 0009 — mock attestation; Phase-4 hardware",
    liveLesson: "13",
  },
  {
    id: "03",
    slug: "03_beta_reputation_and_decay",
    title: "Beta reputation & decay",
    teaches:
      "Beta(α, β) reputation, record_accept α-tightening, 10s exponential decay.",
    arc: "Trust",
    proves: "tests/eval/test_calibration.py",
    limit: "Decay constant tuning deferred to Phase 1+",
    liveLesson: "02",
  },
  {
    id: "04",
    slug: "04_voting_triangulation_gossip",
    title: "Voting, triangulation, gossip",
    teaches:
      "Tier 1 reciprocal-range, Tier 2 MDS multilateration, reputation gossip (ADR 0015).",
    arc: "Trust",
    proves: "tests/eval/test_attack_battery.py · tests/eval/test_scale.py",
    limit: "Gated at B ∈ {4, 16}; {64, 200} opt-in via SPECTER_SCALE=1",
    liveLesson: "03",
  },
  {
    id: "05",
    slug: "05_sim_and_sensor_realism",
    title: "Sim & sensor realism",
    teaches:
      "Lidar dropouts, IMU bias drift, UWB beacons — frame-invariant scalars only (ADR 0015).",
    arc: "Sim & SLAM",
    proves: "ADR 0005 sensor budget",
    limit: "Simulated noise only; no Gazebo PointCloud2 yet",
    liveLesson: "04",
  },
  {
    id: "06",
    slug: "06_slam_dead_reckoning_to_scan_match",
    title: "SLAM: dead-reckoning → scan-match",
    teaches:
      "DeadReckoningSlam (negative test) → ScanMatchSlam (default), radial-flow LSQ.",
    arc: "Sim & SLAM",
    proves: "tests/eval/test_slam_drift.py",
    limit: "Theta gyro-driven; no full pose-graph optimization",
    liveLesson: "09",
  },
  {
    id: "07",
    slug: "07_cooperative_map_merge",
    title: "Cooperative map merge",
    teaches:
      "OccupancyMapMerger, free-vote / occupied-vote weights, trust-weighted fusion.",
    arc: "Sim & SLAM",
    proves: "tests/eval/test_map_convergence.py",
    limit: "Pose correction out of scope; merger trusts the trust scalar",
    liveLesson: "08",
  },
  {
    id: "08",
    slug: "08_attack_battery_tour",
    title: "Attack battery tour",
    teaches:
      "Guided tour of all 12 scripted attack scenarios in tests/eval/scenarios.py.",
    arc: "Composition",
    proves: "tests/eval/test_attack_battery.py · THREAT_MODEL.md",
    limit: "Detection bounds, not pose-correction bounds",
  },
  {
    id: "09",
    slug: "09_full_byzantine_swarm",
    title: "Full Byzantine swarm",
    teaches:
      "Full composition via specter.demo primitives + SROS2 transport-swap appendix.",
    arc: "Composition",
    proves: "examples/unified_demo.py · tests/test_sros2.py",
    limit: "rclpy required for appendix; Phase-1 in HARDWARE_READINESS.md",
  },
  {
    id: "10",
    slug: "10_pose_graph_loop_closure",
    title: "Pose-graph SLAM & loop closure",
    teaches:
      "PoseGraph + OdometryFactor + LoopClosureFactor (ADRs 0016–0017); single loop closure redistributes drift globally.",
    arc: "Sim & SLAM",
    proves: "tests/eval/test_slam_integration.py",
    limit: "Naive closures can be poisoned — see NB 11",
    liveLesson: "09",
  },
  {
    id: "11",
    slug: "11_cooperative_slam_pose_lie",
    title: "Cooperative SLAM & pose_lie",
    teaches:
      "InterRobotFactor coupling; one lying self-pose drags the joint landmark estimate ~1.4 m off truth.",
    arc: "Sim & SLAM",
    proves: "tests/eval/test_baselines.py::_make_lying_landmark_graph",
    limit: "Optimizer can't identify the lying peer from residuals alone — see NB 12",
    liveLesson: "11",
  },
  {
    id: "12",
    slug: "12_bidirectional_trust_slam",
    title: "Bidirectional trust ↔ SLAM",
    teaches:
      "Four-mode baseline (GNC / DCS / Switchable / exogenous-prior); ADR 0018 closed-loop reputation ↔ factor weight.",
    arc: "Composition",
    proves:
      "tests/eval/test_baselines.py::test_baseline_comparison_table_four_modes_at_rep_liar_0p9",
    limit: "Trust layer must be in motion; sleeper-rep window survives one lie",
    liveLesson: "12",
  },
  {
    id: "13",
    slug: "13_roster_guard_and_keys",
    title: "Roster guard & keys",
    teaches:
      "Mid-mission revoke / pre-update admit / post-rotation bad-key all fail at the secure-bus boundary before the trust layer sees them.",
    arc: "Foundations",
    proves:
      "tests/eval/test_identity_attacks.py::test_revoked_compromised_key_rejected_post_revocation",
    limit: "Roster distribution is itself a trust problem (ADR 0010)",
    liveLesson: "13",
  },
];

export const ARCS: ReadonlyArray<Arc> = [
  "Foundations",
  "Trust",
  "Sim & SLAM",
  "Composition",
];
