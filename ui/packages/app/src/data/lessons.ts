export type LessonTrunk = "trust" | "slam" | "composition";

export type Lesson = {
  id: string;
  index: number;
  title: string;
  trunk: LessonTrunk;
  blurb: string;
  attackIds: ReadonlyArray<string>;
};

export const LESSONS: ReadonlyArray<Lesson> = [
  { id: "01", index: 1, title: "The wire is hostile",       trunk: "trust",       blurb: "Signed envelopes + replay window",   attackIds: ["forged_envelope", "replay_storm"] },
  { id: "02", index: 2, title: "Reputation that forgives",  trunk: "trust",       blurb: "Beta(α,β) + exponential decay",      attackIds: ["recovery_after_lie"] },
  { id: "03", index: 3, title: "When two liars agree",      trunk: "trust",       blurb: "Tier 2 MDS embeddability",           attackIds: ["colluder_pair"] },
  { id: "04", index: 4, title: "Bad data ≠ bad actor",      trunk: "trust",       blurb: "Tier 1 catches sensor faults too",   attackIds: ["sensor_fuzz"] },
  { id: "05", index: 5, title: "The sleeper agent",         trunk: "trust",       blurb: "Mid-mission Byzantine flip",         attackIds: ["late_range_lie"] },
  { id: "06", index: 6, title: "When the swarm splits",     trunk: "trust",       blurb: "Gossip across a partition",          attackIds: ["partition_gossip"] },
  { id: "07", index: 7, title: "Agents that never were",    trunk: "trust",       blurb: "V3 transitive presence",             attackIds: ["sybil_cabal"] },
  { id: "08", index: 8, title: "Attacks on the map itself", trunk: "composition", blurb: "Trust-weighted COP, three flavors",  attackIds: ["cop_corruption_full"] },
  // Wave 5 — pose-graph SLAM lessons per ADR 0016 / 0017 / 0018. Scenarios
  // wired by the follow-on UI integration slice (TS PoseGraphTS already shipped).
  { id: "09", index: 9, title: "SLAM 101: loop closure fixes drift", trunk: "slam", blurb: "Single agent, landmark co-visibility snap (ADR 0017)", attackIds: ["slam_loop_closure"] },
  { id: "10", index: 10, title: "Cooperative SLAM",                   trunk: "slam", blurb: "4 agents, inter-robot factors + Umeyama Sim(2) alignment", attackIds: ["slam_cooperative_honest"] },
  { id: "11", index: 11, title: "Byzantine SLAM: pose_lie",           trunk: "slam", blurb: "1 lying peer distorts the joint map without reputation gating", attackIds: ["slam_pose_lie_naive"] },
  { id: "12", index: 12, title: "Reputation as a factor prior",       trunk: "slam", blurb: "Exogenous-prior DCS (ADR 0018) recovers from pose_lie", attackIds: ["slam_pose_lie_robust"] },
  // Wave 4 — identity-lifecycle rail symmetry (Coverage Parity PRD).
  { id: "13", index: 13, title: "Who's allowed to talk",              trunk: "trust", blurb: "Bad key / mid-mission swap fails ECDSA at receivers", attackIds: ["bad_key"] },
  // ADR 0022 — singleton-trusted-window lie defense.
  { id: "14", index: 14, title: "When no one else is watching",       trunk: "slam",  blurb: "A0 lies about a landmark only A0 ever sees — cap + fade bound the damage (ADR 0022)", attackIds: ["slam_singleton_lie"] },
] as const;

export const TRUNK_COLORS: Record<LessonTrunk, string> = {
  trust: "var(--accent-primary)",
  slam: "var(--lesson-intuition)",
  composition: "var(--status-nominal)",
};
