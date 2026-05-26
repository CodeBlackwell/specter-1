/// <reference lib="webworker" />
import { runScenario } from "@specter/sim-core";
import { ATTACK_CATALOG, composeBundles } from "../data/scenarios";
import { computeContactReports } from "./contacts";
import { computeDetectionMap } from "./detection";
import { computePhantomWitnesses } from "./phantomWitnesses";
import { AO_WORLD } from "./world";
import type {
  WorkerRequest,
  WorkerResponse,
} from "./scenarioWorker.types";

declare const self: DedicatedWorkerGlobalScope;

const CHUNK_SIZE = 50;

function bundleFor(attackId: string) {
  const entry = ATTACK_CATALOG.find((a) => a.id === attackId) ?? ATTACK_CATALOG[0]!;
  return entry.build();
}

function build(
  id: number,
  attackIds: ReadonlyArray<string>,
  attackStartTick: number | undefined,
): void {
  const ids = attackIds.length > 0 ? attackIds : ["honest"];
  const bundles = ids.map((aid) => bundleFor(aid));
  const composed = composeBundles(bundles);
  if (attackStartTick !== undefined) composed.spec.attackStartTick = attackStartTick;

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
    },
  };
  self.postMessage(done);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, attackIds, attackStartTick } = e.data;
  try {
    build(id, attackIds, attackStartTick);
  } catch (err) {
    const msg: WorkerResponse = { id, kind: "error", error: (err as Error).message };
    self.postMessage(msg);
  }
};
