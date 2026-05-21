import type {
  Agent,
  CooperativeScenario,
  CooperativeSlamSnapshot,
  Pose2,
  ScenarioResult,
  SlamSnapshot,
  SlamView,
  TickSnapshot,
} from "@specter/sim-core";
import {
  cooperativeSlamTruth,
  runCooperativeSlamDemo,
  runSingleAgentLoopClosureDemo,
  singleAgentLoopClosureTruth,
} from "@specter/sim-core";
import { AO_WORLD } from "./world";
import { newCoverageGrid } from "./coverage";

const SLAM_LESSON_IDS = new Set(["09", "10", "11", "12", "14"]);

const SHORT_DEMO_DENSITY = 3;

export function isSlamLesson(lessonId: string): boolean {
  return SLAM_LESSON_IDS.has(lessonId);
}

export type SlamSlice = {
  snapshots: TickSnapshot[];
  attackStartTick: number;
  hasAttackers: boolean;
};

function densify(snapshots: TickSnapshot[], factor: number): TickSnapshot[] {
  if (factor <= 1) return snapshots;
  const out: TickSnapshot[] = [];
  let tick = 0;
  for (const s of snapshots) {
    for (let r = 0; r < factor; r++) {
      out.push({ ...s, tick, t: tick });
      tick++;
    }
  }
  return out;
}

export function buildSlamSlice(lessonId: string): SlamSlice {
  if (lessonId === "09") return buildSingleAgentSlice();
  if (lessonId === "10") return buildCooperativeSlice("honest");
  if (lessonId === "11") return buildCooperativeSlice("pose_lie_naive");
  if (lessonId === "12") return buildCooperativeSlice("pose_lie_robust");
  if (lessonId === "14") return buildCooperativeSlice("singleton_lie");
  throw new Error(`buildSlamSlice: not a SLAM lesson: ${lessonId}`);
}

function buildSingleAgentSlice(): SlamSlice {
  const stages = runSingleAgentLoopClosureDemo();
  const total = stages.length;
  // Phase boundaries derived from snapshot shape. Pre-roll runs until the
  // full 12-pose trajectory is in place; LM landmarks-only runs until a
  // closure edge appears; LM with closures runs until the final converged
  // frame.
  let prerollEnd = 0;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i]!.trajectory.length >= 12) {
      prerollEnd = i;
      break;
    }
  }
  let closureAt = -1;
  for (let i = prerollEnd; i < stages.length; i++) {
    if (stages[i]!.closureEdges.length > 0) {
      closureAt = i;
      break;
    }
  }
  const snapshots = stages.map((stage, i) =>
    singleAgentSnapshot(stage, i, total, phaseLabelL09(stage, i, prerollEnd, closureAt, total)),
  );
  return { snapshots: densify(snapshots, SHORT_DEMO_DENSITY), attackStartTick: 0, hasAttackers: false };
}

function phaseLabelL09(
  stage: SlamSnapshot,
  index: number,
  prerollEnd: number,
  closureAt: number,
  total: number,
): string {
  if (index < prerollEnd) return `Walk · pose ${stage.trajectory.length}/12`;
  if (index === prerollEnd) return "Pre-optimize";
  if (closureAt < 0 || index < closureAt) {
    return `LM landmarks · iter ${stage.iterations}`;
  }
  if (index === closureAt) return "Loop closures inserted";
  if (index === total - 1) return "Converged";
  return `LM with closures · iter ${stage.iterations}`;
}

function buildCooperativeSlice(scenario: CooperativeScenario): SlamSlice {
  const stages = runCooperativeSlamDemo(scenario);
  const total = stages.length;
  // Pre-roll ends at the first snapshot with all 4 agents AND all 4
  // landmarks present — i.e. the fully constructed graph just before LM
  // kicks in.
  let prerollEnd = 0;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i]!.agents.length === 4 && stages[i]!.landmarks.size === 4) {
      prerollEnd = i;
      break;
    }
  }
  const snapshots = stages.map((stage, i) =>
    cooperativeSnapshot(
      stage,
      i,
      total,
      scenario,
      phaseLabelCoop(stage, i, prerollEnd, total, scenario, stages),
    ),
  );
  const hasAttackers = scenario !== "honest";
  // Attack arms once the lie can fold into the joint solve — i.e. right after
  // pre-roll completes (the first LM step on the full graph).
  const attackStartTick = hasAttackers ? prerollEnd + 1 : 0;
  // Closed-loop scenarios (pose_lie_robust, singleton_lie) emit many
  // per-LM-iter snapshots already — only the short demos need padding.
  const factor =
    scenario === "pose_lie_robust" || scenario === "singleton_lie" ? 1 : SHORT_DEMO_DENSITY;
  return {
    snapshots: densify(snapshots, factor),
    attackStartTick: attackStartTick * factor,
    hasAttackers,
  };
}

function phaseLabelCoop(
  stage: CooperativeSlamSnapshot,
  index: number,
  prerollEnd: number,
  total: number,
  scenario: CooperativeScenario,
  stages: ReadonlyArray<CooperativeSlamSnapshot>,
): string {
  if (index < prerollEnd) {
    const nAgents = stage.agents.length;
    const nLm = stage.landmarks.size;
    if (nAgents < 4) return `Build · place ${stage.agents[stage.agents.length - 1]?.id ?? ""}`;
    if (nLm < 4) return `Build · landmark ${nLm}/4`;
    return `Build · ring edge ${index - 3}/4`;
  }
  if (index === prerollEnd) return "Pre-optimize";
  if (scenario !== "pose_lie_robust" && scenario !== "singleton_lie") {
    return index === total - 1 ? "Converged" : `LM iter ${stage.iterations}`;
  }
  // L12 robust: count cycle boundaries (iterations resets near 0 between cycles).
  let cycle = 0;
  for (let i = prerollEnd + 1; i <= index && i < stages.length; i++) {
    const prev = stages[i - 1]!;
    const cur = stages[i]!;
    if (cur.iterations < prev.iterations && prev.iterations > 0) cycle++;
  }
  return `Cycle ${cycle + 1} · LM iter ${stage.iterations}`;
}

function singleAgentSnapshot(
  stage: SlamSnapshot,
  index: number,
  total: number,
  stageLabel: string,
): TickSnapshot {
  const startPose = stage.trajectory[0]?.[1] ?? { x: 0, y: 0, theta: 0 };
  const agentId = "alpha";
  const agents: Agent[] = [synthAgent(agentId, startPose)];
  const reputations: Record<string, number> = { [agentId]: 1.0 };
  const slam: SlamView = {
    kind: "single",
    cycle: index,
    totalStages: total,
    stageLabel,
    cost: stage.cost,
    iterations: stage.iterations,
    trajectory: stage.trajectory,
    closureEdges: stage.closureEdges,
    landmarks: mapToEntries(stage.landmarks),
  };
  return makeTickSnapshot(index, agents, reputations, slam);
}

function cooperativeSnapshot(
  stage: CooperativeSlamSnapshot,
  index: number,
  total: number,
  scenario: CooperativeScenario,
  stageLabel: string,
): TickSnapshot {
  const agents: Agent[] = stage.agents.map((a) => synthAgent(a.id, a.pose));
  const reputations: Record<string, number> = {};
  for (const a of stage.agents) reputations[a.id] = a.reputation;
  const slam: SlamView = {
    kind: "cooperative",
    cycle: index,
    totalStages: total,
    stageLabel,
    cost: stage.cost,
    iterations: stage.iterations,
    scenario,
    slamAgents: stage.agents,
    interRobotEdges: stage.interRobotEdges,
    landmarks: mapToEntries(stage.landmarks),
  };
  return makeTickSnapshot(index, agents, reputations, slam);
}

function synthAgent(id: string, pose: Pose2): Agent {
  return {
    id,
    x: pose.x,
    y: pose.y,
    theta: pose.theta,
    vx: 0,
    vy: 0,
    omega: 0,
    phantom: false,
  };
}

function makeTickSnapshot(
  tick: number,
  agents: Agent[],
  reputations: Record<string, number>,
  slam: SlamView,
): TickSnapshot {
  const consensus: Record<string, number> = { ...reputations };
  const perAgent: Record<string, Record<string, number>> = {};
  const perAgentBeta: Record<string, Record<string, [number, number]>> = {};
  for (const a of agents) {
    perAgent[a.id] = { ...reputations };
    perAgentBeta[a.id] = {};
  }
  return {
    tick,
    t: tick,
    agents,
    observations: [],
    reputations,
    perAgentReputations: perAgent,
    consensusReputations: consensus,
    perAgentBeta,
    newCohortEvents: [],
    gossipRound: false,
    attackArmed: false,
    gossipIngested: [],
    presenceGraph: {},
    slam,
  };
}

function mapToEntries(m: Map<string, [number, number]>): Array<[string, [number, number]]> {
  return Array.from(m.entries());
}

/** Minimal ScenarioResult shape compatible with simStore's fixture path. The
 * `evaluator` / `agentEvaluators` fields are unused by every UI consumer; the
 * cast mirrors the existing fixture loader. */
export function slamResult(snapshots: TickSnapshot[]): ScenarioResult {
  return { snapshots } as unknown as ScenarioResult;
}

export const EMPTY_SLAM_COVERAGE = newCoverageGrid(AO_WORLD.bounds, 2.5);
