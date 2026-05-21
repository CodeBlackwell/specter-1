import type { FlightPattern, TickSnapshot } from "@specter/sim-core";
import ScenarioWorker from "./scenario.worker?worker";
import type {
  AttackSchedule,
  MapConfig,
  PathPresetId,
  WorkerRequest,
  WorkerResponse,
  WorkerSliceTail,
} from "./scenarioWorker.types";

export type StreamHandlers = {
  onChunk: (chunk: TickSnapshot[], soFar: number, total: number) => void;
  onDone: (tail: WorkerSliceTail) => void;
  onError: (err: Error) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, StreamHandlers>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new ScenarioWorker();
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const handlers = pending.get(e.data.id);
    if (!handlers) return;
    if (e.data.kind === "chunk") {
      handlers.onChunk(e.data.chunk, e.data.soFar, e.data.total);
      return;
    }
    pending.delete(e.data.id);
    if (e.data.kind === "done") handlers.onDone(e.data.tail);
    else handlers.onError(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "worker error");
    for (const h of pending.values()) h.onError(err);
    pending.clear();
  };
  return worker;
}

export function streamSliceInWorker(
  attackIds: ReadonlyArray<string>,
  attackStartTick: number | undefined,
  handlers: StreamHandlers,
  attackSchedules?: Record<string, AttackSchedule>,
  flightPattern?: FlightPattern,
  pathPreset?: PathPresetId | null,
  pathWaypoints?: ReadonlyArray<[number, number]> | null,
  mapConfig?: MapConfig,
): number {
  const id = nextId++;
  pending.set(id, handlers);
  const request: WorkerRequest = {
    id,
    attackIds,
    attackStartTick,
    attackSchedules,
    flightPattern,
    pathPreset,
    pathWaypoints,
    mapConfig,
  };
  getWorker().postMessage(request);
  return id;
}

export function cancelAllWorkerRequests(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
}

export type { AttackSchedule, MapConfig, PathPresetId, WorkerSliceTail };
