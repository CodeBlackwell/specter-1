import type { TickSnapshot } from "@specter/sim-core";
import { SIGMA_BEACON_RANGE_M, SIGMA_NLOS_RANGE_M, embed2D, lyingEdgeResiduals } from "@specter/sim-core";

export const TIER1_RANGE_SIGMA = Math.sqrt(
  SIGMA_BEACON_RANGE_M * SIGMA_BEACON_RANGE_M + SIGMA_NLOS_RANGE_M * SIGMA_NLOS_RANGE_M,
);
export const TIER1_K_SIGMA = 3.0;
export const TIER1_THRESHOLD_M = TIER1_K_SIGMA * TIER1_RANGE_SIGMA;
export const TIER2_TAU = 0.05;

export type Tier2Edge = { i: number; j: number; residual: number };
export type Tier1Edge = { i: number; j: number; delta: number };

export type TrustView = {
  agentIds: ReadonlyArray<string>;
  points: ReadonlyArray<readonly [number, number]>;

  tier2Edges: ReadonlyArray<Tier2Edge>;
  tier2Top: Tier2Edge | null;
  embeddability: number;

  tier1Edges: ReadonlyArray<Tier1Edge>;
  tier1Top: Tier1Edge | null;
  tier1MaxDelta: number;

  observedPairs: number;
  totalPairs: number;
};

const EMPTY_VIEW: TrustView = {
  agentIds: [],
  points: [],
  tier2Edges: [],
  tier2Top: null,
  embeddability: 0,
  tier1Edges: [],
  tier1Top: null,
  tier1MaxDelta: 0,
  observedPairs: 0,
  totalPairs: 0,
};

export function computeTrustView(snapshot: TickSnapshot | null): TrustView {
  if (!snapshot) return EMPTY_VIEW;
  const realAgents = snapshot.agents.filter((a) => !a.phantom);
  const n = realAgents.length;
  if (n < 3) return EMPTY_VIEW;

  const idx = new Map(realAgents.map((a, i) => [a.id, i] as const));
  const sum: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const count: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const obs of snapshot.observations) {
    const i = idx.get(obs.observer_id);
    const j = idx.get(obs.subject_id);
    if (i === undefined || j === undefined || i === j) continue;
    const sumRow = sum[i]!;
    const countRow = count[i]!;
    sumRow[j] = (sumRow[j] ?? 0) + obs.range_m;
    countRow[j] = (countRow[j] ?? 0) + 1;
  }

  const D: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const tier1Edges: Tier1Edge[] = [];
  let observedPairs = 0;
  const totalPairs = (n * (n - 1)) / 2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const aI = realAgents[i]!;
      const aJ = realAgents[j]!;
      const forwardCount = count[i]![j]!;
      const reverseCount = count[j]![i]!;
      const forwardAvg = forwardCount > 0 ? sum[i]![j]! / forwardCount : null;
      const reverseAvg = reverseCount > 0 ? sum[j]![i]! / reverseCount : null;
      let d: number;
      if (forwardAvg !== null && reverseAvg !== null) {
        d = (forwardAvg + reverseAvg) / 2;
        observedPairs++;
        tier1Edges.push({ i, j, delta: Math.abs(forwardAvg - reverseAvg) });
      } else if (forwardAvg !== null) {
        d = forwardAvg;
        observedPairs++;
      } else if (reverseAvg !== null) {
        d = reverseAvg;
        observedPairs++;
      } else {
        d = Math.hypot(aI.x - aJ.x, aI.y - aJ.y);
      }
      D[i]![j] = d;
      D[j]![i] = d;
    }
  }

  const { points, embeddability } = embed2D(D);
  const residualMatrix = lyingEdgeResiduals(D);
  const tier2Edges: Tier2Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = (residualMatrix[i]![j]! + residualMatrix[j]![i]!) / 2;
      tier2Edges.push({ i, j, residual: r });
    }
  }
  tier2Edges.sort((a, b) => b.residual - a.residual);
  tier1Edges.sort((a, b) => b.delta - a.delta);

  const tier2Top = tier2Edges.length > 0 && tier2Edges[0]!.residual > 0 ? tier2Edges[0]! : null;
  const tier1Top = tier1Edges.length > 0 ? tier1Edges[0]! : null;
  const tier1MaxDelta = tier1Top?.delta ?? 0;

  return {
    agentIds: realAgents.map((a) => a.id),
    points,
    tier2Edges,
    tier2Top,
    embeddability,
    tier1Edges,
    tier1Top,
    tier1MaxDelta,
    observedPairs,
    totalPairs,
  };
}
