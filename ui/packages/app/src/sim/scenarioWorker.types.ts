import type { TickSnapshot } from "@specter/sim-core";
import type { CoverageGrid } from "./coverage";
import type { ContactReport, MapAttack } from "./contacts";
import type { DetectionMap } from "./detection";
import type { PhantomWitnessMap } from "./phantomWitnesses";
import type { RejectionEvent } from "./rejections";

export type WorkerRequest = {
  id: number;
  attackIds: ReadonlyArray<string>;
  attackStartTick?: number;
};

export type WorkerSliceTail = {
  attackStartTick: number;
  hasAttackers: boolean;
  /** De-duplicated agent ids that the composed scenario marked as adversarial.
   * Carries IDs only (the AttackFn closures can't cross the worker boundary).
   * Powers lesson-level overlays that need to identify the lying agents
   * before the trust layer's reputation collapse makes them visible. */
  attackerIds: ReadonlyArray<string>;
  sensorRadiusM: number;
  coverageGrid: CoverageGrid;
  mapAttacks: ReadonlyArray<MapAttack>;
  rejections: ReadonlyArray<RejectionEvent>;
  detectionMap: DetectionMap;
  contactReports: ContactReport[];
  phantomWitnesses: PhantomWitnessMap;
  rumorSubject?: string;
  cliques?: ReadonlyArray<ReadonlyArray<string>>;
};

export type WorkerResponse =
  | { id: number; kind: "chunk"; chunk: TickSnapshot[]; soFar: number; total: number }
  | { id: number; kind: "done"; tail: WorkerSliceTail }
  | { id: number; kind: "error"; error: string };
