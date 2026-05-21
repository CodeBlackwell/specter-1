export type GlossaryEntry = {
  term: string;
  kind?: "var" | "concept" | "acronym" | "scenario";
  def: string;
};

export const GLOSSARY: Record<string, ReadonlyArray<GlossaryEntry>> = {
  "01": [
    { term: "Envelope", kind: "concept", def: "Signed wrapper carrying message + roster snapshot + timestamp." },
    { term: "ECDSA P-256", kind: "acronym", def: "Signature scheme used by the bus (ADR 0002)." },
    { term: "Canonical JSON", kind: "concept", def: "Deterministic encoding so signing is byte-equal across Python ↔ TS." },
    { term: "Roster", kind: "concept", def: "Signed set of permitted peer keys for the mission." },
    { term: "5 rejections", kind: "concept", def: "invalid-sig · unknown-peer · replay · stale · revoked." },
  ],
  "02": [
    { term: "MutableRoster", kind: "concept", def: "Per-process roster that admits signed in-mission updates." },
    { term: "KeyRotationAnnouncement", kind: "concept", def: "Signed message rotating a peer's pubkey." },
    { term: "RevocationList", kind: "concept", def: "Tombstones that block compromised keys at the bus." },
    { term: "MockAttestationProvider", kind: "concept", def: "Sim stand-in for Phase-4 hardware attestation (ADR 0009)." },
  ],
  "03": [
    { term: "α (alpha)", kind: "var", def: "Beta success count — increments on accepted observations." },
    { term: "β (beta)", kind: "var", def: "Beta failure count — increments on lies / rejections." },
    { term: "reputation", kind: "var", def: "α / (α + β) — trust scalar in [0, 1]." },
    { term: "record_accept", kind: "concept", def: "α-tightening update applied on accepted observations." },
    { term: "decay", kind: "concept", def: "10s exponential half-life on (α−1, β−1) — keeps history fresh." },
  ],
  "04": [
    { term: "Tier 1", kind: "concept", def: "Reciprocal-range pairwise corroboration." },
    { term: "Tier 2", kind: "concept", def: "Classical MDS multilateration over the range graph (ADR 0015)." },
    { term: "Embeddability", kind: "var", def: "Residual of MDS fit to Euclidean — high score = consistent." },
    { term: "Gossip", kind: "concept", def: "Periodic broadcast of Beta-snapshot views between peers." },
    { term: "B", kind: "var", def: "Cohort size — gated at 4 / 16; 64 / 200 opt-in via SPECTER_SCALE=1." },
  ],
  "05": [
    { term: "Lidar dropout", kind: "concept", def: "Random missing returns at the sensor level." },
    { term: "IMU bias drift", kind: "concept", def: "Slow gyro / accelerometer drift over time." },
    { term: "UWB beacon", kind: "acronym", def: "Ultra-wideband ranging anchor for absolute distance." },
    { term: "Frame-invariant", kind: "concept", def: "Ranges and scalars only — no global frame on the wire (ADR 0015)." },
  ],
  "06": [
    { term: "DeadReckoningSlam", kind: "concept", def: "Odometry-only baseline — drifts unboundedly." },
    { term: "ScanMatchSlam", kind: "concept", def: "Default: radial-flow LSQ scan alignment." },
    { term: "Radial-flow LSQ", kind: "concept", def: "Least-squares estimate of θ from radial scan features." },
    { term: "Drift", kind: "var", def: "Cumulative open-loop integration error." },
  ],
  "07": [
    { term: "OccupancyMapMerger", kind: "concept", def: "Fuses per-agent occupancy grids into a joint map." },
    { term: "Free / occupied vote", kind: "concept", def: "Per-cell evidence weights from each peer's scans." },
    { term: "Trust-weighted fusion", kind: "concept", def: "Each peer's vote scaled by its current reputation." },
  ],
  "08": [
    { term: "range_lie", kind: "scenario", def: "Byzantine peer fakes distance returns." },
    { term: "colluder_pair", kind: "scenario", def: "Two byzantines mutually corroborate." },
    { term: "sensor_fuzz", kind: "scenario", def: "Random noise injection at the sensor layer." },
    { term: "beacon_spoof", kind: "scenario", def: "Fake UWB anchor advertising a wrong position." },
    { term: "sybil_cabal", kind: "scenario", def: "Phantom agents mutually vouching — collapses under V3 presence." },
  ],
  "09": [
    { term: "specter.demo", kind: "concept", def: "Top-level composition primitives for the full swarm." },
    { term: "SROS2", kind: "acronym", def: "Secure ROS 2 transport (Phase-3 hardware path)." },
    { term: "Transport-swap", kind: "concept", def: "Same library; sim or SROS2 transport behind one interface." },
    { term: "ABC seam", kind: "concept", def: "Attestation boundary you re-implement on hardware (ADR 0009)." },
  ],
  "10": [
    { term: "PoseGraph", kind: "concept", def: "Nodes (poses) + edges (factors); optimized jointly." },
    { term: "OdometryFactor", kind: "concept", def: "Constraint between consecutive poses." },
    { term: "LoopClosureFactor", kind: "concept", def: "Long-range constraint linking revisited poses." },
    { term: "LM", kind: "acronym", def: "Levenberg–Marquardt — the iterative optimizer." },
    { term: "Drift redistribution", kind: "concept", def: "One closure forces accumulated drift to spread globally." },
  ],
  "11": [
    { term: "InterRobotFactor", kind: "concept", def: "Cross-robot pose constraint coupling two PoseGraphs." },
    { term: "pose_lie", kind: "scenario", def: "One robot lies about its self-pose — drags joint estimate ~1.4 m." },
    { term: "Joint landmark estimate", kind: "var", def: "Shared map estimate emerging from the coupled solve." },
    { term: "Residual identifiability", kind: "concept", def: "The optimizer alone can't isolate which peer lied — trust must." },
  ],
  "12": [
    { term: "GNC", kind: "acronym", def: "Graduated non-convexity — outlier rejection wrapper around LM." },
    { term: "DCS", kind: "acronym", def: "Dynamic covariance scaling — per-factor variance shaping." },
    { term: "Switchable", kind: "concept", def: "Latent on/off switch per factor (Sünderhauf-style)." },
    { term: "Exogenous prior", kind: "concept", def: "Trust-supplied prior on factor information (ADR 0018)." },
    { term: "Closed-loop", kind: "concept", def: "Reputation ↔ factor-information feedback both directions." },
  ],
  "13": [
    { term: "bad_key", kind: "scenario", def: "Rail attack — A0's signing keypair changes mid-mission, every envelope fails ECDSA at receivers. Same defense surface as L01's forged_envelope, two rejection paths." },
    { term: "single_bad_key", kind: "scenario", def: "Python eval counterpart (tests/eval/test_attack_battery.py::test_single_bad_key_collapses_immediately) — same attack, library-side audit surface." },
    { term: "key_revoked_post_rotation", kind: "concept", def: "Rejection category raised by MutableRoster when an envelope arrives signed with a rotated-out key. The wire-layer drop signal for L13's attack class." },
    { term: "Secure-bus boundary", kind: "concept", def: "ECDSA + roster + rotation rejections all fire at open_envelope, before the trust evaluator sees the payload." },
  ],
  "14": [
    { term: "Singleton landmark", kind: "concept", def: "A landmark observed by exactly one distinct reporter — no consensus to disagree with." },
    { term: "Confidence cap", kind: "concept", def: "Uniqueness-as-confidence-penalty: singleton factors scaled by SINGLETON_INFO_SCALE = 0.3 regardless of reporter rep." },
    { term: "Stale-singleton fade", kind: "concept", def: "Linear decay from full cap to zero over T_CORROBORATE + T_FADE = 400 ticks past insertion." },
    { term: "Provenance record", kind: "var", def: "(reporter_id, insertion_tick, reputation_at_insertion) stamped on each factor — the substrate cap and fade read." },
    { term: "Reporter set", kind: "var", def: "Per-landmark accumulator: the set of distinct sourceIds that ever contributed an observation; cardinality > 1 lifts the cap." },
    { term: "Bounded not resolved", kind: "concept", def: "The cap bounds damage; active resolution (re-observation tasking) is deferred to Phase 3 hardware." },
  ],
};
