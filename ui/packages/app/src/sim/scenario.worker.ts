/// <reference lib="webworker" />
import {
  MAP_PRESETS,
  beaconLayout,
  createRng,
  defaultPathFor,
  defaultPlannerFor,
  freehand,
  makePlanner,
  pathFollower,
  randomWalk,
  runScenario,
  type FlightPattern,
} from "@specter/sim-core";
import { ATTACK_CATALOG, composeBundles } from "../data/scenarios";
import { computeContactReports } from "./contacts";
import { computeDetectionMap } from "./detection";
import { computePhantomWitnesses } from "./phantomWitnesses";
import { AO_WORLD } from "./world";
import type {
  MapConfig,
  PathPresetId,
  WorkerRequest,
  WorkerResponse,
} from "./scenarioWorker.types";

declare const self: DedicatedWorkerGlobalScope;

const CHUNK_SIZE = 50;

function bundleFor(attackId: string) {
  const entry = ATTACK_CATALOG.find((a) => a.id === attackId) ?? ATTACK_CATALOG[0]!;
  return entry.build();
}

function applySchedule(bundle: ReturnType<typeof bundleFor>, window: { startTick: number; endTick: number }) {
  // Wave 1: tag every attacker emitted by this bundle with the requested
  // window. The sim-core runner honors per-attacker startTick/endTick and
  // falls back to spec-level defaults when unset.
  const attackers = bundle.spec.attackers;
  if (!attackers || attackers.length === 0) return bundle;
  bundle.spec = {
    ...bundle.spec,
    attackers: attackers.map((a) => ({
      ...a,
      startTick: window.startTick,
      endTick: window.endTick,
    })),
  };
  return bundle;
}

const AO_BOUNDS_PATH = {
  minX: AO_WORLD.bounds.minX,
  minY: AO_WORLD.bounds.minY,
  maxX: AO_WORLD.bounds.maxX,
  maxY: AO_WORLD.bounds.maxY,
};

const AO_BOUNDS_PLANNER = {
  xmin: AO_WORLD.bounds.minX,
  ymin: AO_WORLD.bounds.minY,
  xmax: AO_WORLD.bounds.maxX,
  ymax: AO_WORLD.bounds.maxY,
};

function attachFlightPattern(
  spec: ReturnType<typeof composeBundles>["spec"],
  pattern: FlightPattern,
): void {
  // User-selected pattern replaces the bundle's default `wheelPlanner`.
  // Lesson fixtures don't reach this worker (they load via sliceFromFixture),
  // so there's no bespoke lesson planner to preserve.
  const agentCount = spec.agents.filter((a) => !a.phantom).length;
  if (pattern === "RANDOM_WALK") {
    // defaultPlannerFor throws on RANDOM_WALK because it needs an Rng — wire
    // one here off the swarm seed so trajectories stay deterministic per-run.
    const seed = spec.swarmOpts?.seed ?? 0;
    spec.planner = randomWalk({ rng: createRng(seed), speed: 1.0, turnSigma: 0.2 });
    return;
  }
  spec.planner = makePlanner(
    defaultPlannerFor(pattern, { bounds: AO_BOUNDS_PLANNER, agentCount, seed: 0 }),
  );
}

function attachPath(
  spec: ReturnType<typeof composeBundles>["spec"],
  pathPreset: PathPresetId | null | undefined,
  pathWaypoints: ReadonlyArray<[number, number]> | null | undefined,
): void {
  if (!pathPreset && !pathWaypoints) return;
  const hasWaypoints = pathWaypoints && pathWaypoints.length > 0;
  const path =
    pathPreset === "FREEHAND" || (!pathPreset && hasWaypoints)
      ? hasWaypoints
        ? freehand(pathWaypoints!)
        : null
      : pathPreset
        ? defaultPathFor(pathPreset, AO_BOUNDS_PATH)
        : null;
  if (path) spec.planner = pathFollower(path, { speed: 1.0 });
}

function resolveBeaconPositions(mc: MapConfig): ReadonlyArray<[number, number]> {
  if (mc.beaconPositions) return mc.beaconPositions;
  const preset = MAP_PRESETS.find((p) => p.id === mc.presetId) ?? MAP_PRESETS[0]!;
  if (mc.beaconLayoutName === "custom") {
    // Custom layout without explicit positions: fall back to the preset's
    // default layout rather than throwing (worker must stay defensive).
    return beaconLayout(preset.defaultBeaconLayout, preset.sizeM, mc.beaconCount);
  }
  return beaconLayout(mc.beaconLayoutName, preset.sizeM, mc.beaconCount);
}

function build(
  id: number,
  attackIds: ReadonlyArray<string>,
  attackStartTick: number | undefined,
  attackSchedules: Record<string, { startTick: number; endTick: number }> | undefined,
  flightPattern: FlightPattern | undefined,
  pathPreset: PathPresetId | null | undefined,
  pathWaypoints: ReadonlyArray<[number, number]> | null | undefined,
  mapConfig: MapConfig | undefined,
): void {
  const ids = attackIds.length > 0 ? attackIds : ["honest"];
  const bundles = ids.map((aid) => {
    const b = bundleFor(aid);
    const window = attackSchedules?.[aid];
    return window ? applySchedule(b, window) : b;
  });
  const composed = composeBundles(bundles);
  if (attackStartTick !== undefined) composed.spec.attackStartTick = attackStartTick;
  // Pattern wins when both are set; falls through to bundle's default planner
  // (wheelPlanner from buildSwarm) when neither is provided.
  if (flightPattern) {
    attachFlightPattern(composed.spec, flightPattern);
  } else {
    attachPath(composed.spec, pathPreset, pathWaypoints);
  }

  const tStart = performance.now();
  const result = runScenario(composed.spec, {
    chunkSize: CHUNK_SIZE,
    onChunk: (chunk, soFar, total) => {
      const msg: WorkerResponse = { id, kind: "chunk", chunk, soFar, total };
      self.postMessage(msg);
    },
  });
  const tRun = performance.now() - tStart;

  const tDerived0 = performance.now();
  const detectionMap = computeDetectionMap(result.snapshots, AO_WORLD.items, AO_WORLD.sensorRadiusM);
  const contactReports = computeContactReports(
    detectionMap,
    AO_WORLD.items,
    composed.mapAttacks,
    composed.spec.attackStartTick ?? 0,
  );
  const phantomWitnesses = computePhantomWitnesses(
    result.snapshots,
    composed.mapAttacks,
    AO_WORLD.sensorRadiusM,
  );
  const tDerived = performance.now() - tDerived0;

  console.log(
    `[worker] ${ids.join("+")} @${attackStartTick ?? "auto"} · ${composed.spec.ticks}t ` +
      `runScenario=${tRun.toFixed(0)}ms derived=${tDerived.toFixed(0)}ms`,
  );

  const beaconPositions = mapConfig ? resolveBeaconPositions(mapConfig) : undefined;

  const done: WorkerResponse = {
    id,
    kind: "done",
    tail: {
      attackStartTick: composed.spec.attackStartTick ?? 0,
      hasAttackers: (composed.spec.attackers?.length ?? 0) > 0,
      attackerIds: composed.spec.attackers
        ? Array.from(new Set(composed.spec.attackers.map((a) => a.agentId)))
        : [],
      sensorRadiusM: AO_WORLD.sensorRadiusM,
      coverageGrid: composed.grid,
      mapAttacks: composed.mapAttacks,
      rejections: composed.rejections,
      detectionMap,
      contactReports,
      phantomWitnesses,
      rumorSubject: composed.spec.rumorSubject,
      cliques: composed.spec.cliques,
      beaconPositions,
    },
  };
  self.postMessage(done);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const {
    id,
    attackIds,
    attackStartTick,
    attackSchedules,
    flightPattern,
    pathPreset,
    pathWaypoints,
    mapConfig,
  } = e.data;
  try {
    build(
      id,
      attackIds,
      attackStartTick,
      attackSchedules,
      flightPattern,
      pathPreset,
      pathWaypoints,
      mapConfig,
    );
  } catch (err) {
    const msg: WorkerResponse = { id, kind: "error", error: (err as Error).message };
    self.postMessage(msg);
  }
};
