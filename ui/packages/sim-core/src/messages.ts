export const KIND_POSE = "pose_report";
export const KIND_OBSERVATION = "observation";
export const KIND_REPUTATION = "reputation_gossip";
export const KIND_LANDMARK_OBSERVATION = "landmark_observation";
export const KIND_CONTACT_REPORT = "contact_report";

export type PoseReport = {
  agent_id: string;
  x: number;
  y: number;
  theta: number;
  timestamp_ns: bigint;
};

export type Observation = {
  observer_id: string;
  subject_id: string;
  range_m: number;
  bearing_rad: number;
  timestamp_ns: bigint;
};

export type ReputationGossip = {
  gossiper_id: string;
  views: Record<string, [number, number]>;
  timestamp_ns: bigint;
};

export type LandmarkObservation = {
  observer_id: string;
  landmark_id: string;
  range_m: number;
  bearing_rad: number;
  timestamp_ns: bigint;
  nlos: boolean;
};

/** One agent's claim that an item is at a given position. TS parity to
 * `src/specter/messages.py:ContactReport` (ADR 0019). The trust-weighted
 * Common Operating Picture aggregates these by `contact_id`. */
export type ContactReport = {
  reporter_id: string;
  contact_id: string;
  kind: string;
  x: number;
  y: number;
  timestamp_ns: bigint;
};
