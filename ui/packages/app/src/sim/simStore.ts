import { startTransition } from "react";
import { create } from "zustand";
import {
  MAP_PRESETS,
  type Attacker,
  type BeaconLayoutName,
  type FlightPattern,
  type ScenarioResult,
  type ScenarioSpec,
  type TickSnapshot,
} from "@specter/sim-core";
import { type ScenarioBundle } from "../data/scenarios";
import { LESSONS } from "../data/lessons";
import { type LessonFixture, loadLessonFixture } from "../data/fixtures";
import { AO_WORLD } from "./world";
import { type DetectionMap, computeDetectionMap } from "./detection";
import { type CoverageGrid, newCoverageGrid } from "./coverage";
import { type ContactReport, type MapAttack, computeContactReports } from "./contacts";
import { type PhantomWitnessMap, computePhantomWitnesses } from "./phantomWitnesses";
import type { RejectionEvent } from "./rejections";
import {
  cancelAllWorkerRequests,
  streamSliceInWorker,
  type AttackSchedule,
  type MapConfig,
  type PathPresetId,
  type WorkerSliceTail,
} from "./scenarioWorker";
import { buildSlamSlice, isSlamLesson, slamResult } from "./slamLessons";
import type { ComposerPreset } from "../domain/freeplay/presetSchema";

const FALLBACK_ATTACK = "honest";
const DEFAULT_END_TICK = 900;

const DEFAULT_MAP_PRESET_ID = "WAREHOUSE_40x40";

function findPreset(id: string) {
  return MAP_PRESETS.find((p) => p.id === id) ?? MAP_PRESETS[0]!;
}

export type AppMode = "workshop" | "freeplay" | "research" | "coursework";

type SimState = {
  mode: AppMode;
  lessonId: string | null;
  attackIds: string[];
  /** Per-attack window (Wave 1). When an attack is selected, a default
   * `{ startTick: 0, endTick: DEFAULT_TICKS }` is allocated; users can
   * tighten the window via `setAttackSchedule`. Removed attacks have
   * their schedules dropped. */
  attackSchedules: Record<string, AttackSchedule>;
  /** Flight pattern (Wave 2). Null = use the lesson-supplied planner if any.
   * When non-null the worker attaches `makePlanner(defaultPlannerFor(pattern, ...))`
   * to the scenario spec unless the spec already has a planner. */
  flightPattern: FlightPattern | null;
  /** Wave 3: preset name (LOOP/LINEAR/FIGURE-8/FREEHAND) driving the
   * Free Play agents' path. `null` means "use whatever motion the
   * lesson fixture or composed spec defines". Engine-layer note: when
   * both `flightPattern` and `pathPreset` are set, the pattern wins
   * (path is ignored). Wave 5 UI composition reconciles them. */
  pathPreset: PathPresetId | null;
  /** Wave 3: explicit waypoints (Wave 6 populates from the map editor).
   * `null` falls back to the preset's default geometry. */
  pathWaypoints: ReadonlyArray<[number, number]> | null;
  /** Wave 4 — map preset id; defaults to `WAREHOUSE_40x40`. */
  mapPresetId: string;
  /** Wave 4 — count of beacon anchors to place via `beaconLayoutName`. */
  beaconCount: number;
  /** Wave 4 — beacon layout selector. Function import is `beaconLayout`;
   * the field is renamed to avoid shadowing it. */
  beaconLayoutName: BeaconLayoutName;
  /** Wave 4 — user-customized beacon positions. `null` means derive from
   * preset + layout + count; non-null overrides (Wave 6 map editor sets). */
  beaconPositions: Array<[number, number]> | null;
  spec: ScenarioSpec | null;
  result: ScenarioResult | null;
  detectionMap: DetectionMap;
  coverageGrid: CoverageGrid;
  mapAttacks: ReadonlyArray<MapAttack>;
  contactReports: ContactReport[];
  phantomWitnesses: PhantomWitnessMap;
  rejections: ReadonlyArray<RejectionEvent>;
  tickIndex: number;
  isPlaying: boolean;
  playbackHz: number;
  autoAdvance: boolean;
  endedDuringPlayback: boolean;
  loadingProgress: number;
  selectedAgentId: string | null;
  welcomeDismissed: boolean;
  /** Wave 5 — Free Play Compose-vs-Watch toggle. `false` shows the Composer
   * card and suppresses auto-restream on every config edit; `true` shows the
   * canvas + scrubber + TrustPanel and lets the existing setters auto-stream. */
  isRunning: boolean;
  /** Wave 6 — active tool in MapEditor. `null` is the default read-only
   * MapPreview behavior; selecting a tool turns the preview interactive. */
  mapTool: "MOVE" | "BEACON" | "WAYPOINT" | "ERASE" | null;
  dismissWelcome: () => void;
  setMode: (mode: AppMode) => void;
  loadScenario: (bundle: ScenarioBundle, attackId: string) => void;
  setActiveAttacks: (ids: ReadonlyArray<string>) => void;
  toggleAttack: (id: string) => void;
  setAttackStartTick: (tick: number) => void;
  setAttackSchedule: (id: string, window: Partial<AttackSchedule>) => void;
  setFlightPattern: (pattern: FlightPattern | null) => void;
  setPathPreset: (preset: PathPresetId | null) => void;
  setPathWaypoints: (waypoints: ReadonlyArray<[number, number]> | null) => void;
  setMapPreset: (id: string) => void;
  setBeaconCount: (n: number) => void;
  setBeaconLayoutName: (name: BeaconLayoutName) => void;
  setBeaconPositions: (positions: Array<[number, number]> | null) => void;
  /** Wave 5 — freeze the current Free Play config and switch to Watch state.
   * Triggers a fresh stream so cached compose-time edits become visible. */
  launch: () => void;
  /** Wave 5 — return from Watch back to Compose; pauses playback. */
  exitRun: () => void;
  /** Wave 6 — switch the MapEditor tool. */
  setMapTool: (tool: SimState["mapTool"]) => void;
  /** Wave 6 — load a saved preset; restores every field except `isRunning`. */
  loadComposerPreset: (preset: ComposerPreset) => void;
  selectLesson: (lessonId: string) => void;
  nextLesson: () => void;
  prevLesson: () => void;
  setAutoAdvance: (on: boolean) => void;
  setTick: (index: number) => void;
  step: (delta: number) => void;
  reset: () => void;
  setPlaying: (playing: boolean) => void;
  clearEndedFlag: () => void;
  setSelectedAgent: (id: string | null) => void;
  prefetchScenarios: (idsList: ReadonlyArray<ReadonlyArray<string>>) => void;
  prefetchLessons: (lessonIds: ReadonlyArray<string>) => void;
};

function lessonIndex(id: string | null): number {
  if (id === null) return -1;
  return LESSONS.findIndex((l) => l.id === id);
}

type Slice = {
  spec: ScenarioSpec;
  result: ScenarioResult;
  detectionMap: DetectionMap;
  coverageGrid: CoverageGrid;
  mapAttacks: ReadonlyArray<MapAttack>;
  contactReports: ContactReport[];
  phantomWitnesses: PhantomWitnessMap;
  rejections: ReadonlyArray<RejectionEvent>;
  playbackHz?: number;
};

const DEFAULT_PLAYBACK_HZ = 35;

const WELCOME_STORAGE_KEY = "specter1.welcome.dismissed.v1";

function welcomePersisted(): boolean {
  try {
    return localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const SCENARIO_CACHE_CAPACITY = 24;
const scenarioCache = new Map<string, Slice>();

function cacheKey(
  ids: ReadonlyArray<string>,
  startTick: number | undefined,
  schedules?: Record<string, AttackSchedule>,
  flightPattern?: FlightPattern | null,
  pathPreset?: PathPresetId | null,
  pathWaypoints?: ReadonlyArray<[number, number]> | null,
  mapConfig?: MapConfig,
): string {
  const base = `${[...ids].sort().join("|")}@${startTick ?? "auto"}`;
  let key = base;
  if (schedules) {
    const tagged = [...ids]
      .sort()
      .map((id) => {
        const w = schedules[id];
        return w ? `${id}:${w.startTick}-${w.endTick}` : id;
      })
      .join("|");
    key = `${key}#${tagged}`;
  }
  if (flightPattern) key = `${key}~p:${flightPattern}`;
  if (pathPreset || pathWaypoints) {
    const wpStr = pathWaypoints ? pathWaypoints.map(([x, y]) => `${x},${y}`).join(";") : "";
    key = `${key}~path:${pathPreset ?? ""}/${wpStr}`;
  }
  if (mapConfig) {
    const posTag = mapConfig.beaconPositions
      ? `:${mapConfig.beaconPositions.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(";")}`
      : "";
    key = `${key}~m:${mapConfig.presetId}/${mapConfig.beaconLayoutName}x${mapConfig.beaconCount}${posTag}`;
  }
  return key;
}

function bumpCache(key: string, slice: Slice): void {
  scenarioCache.set(key, slice);
  while (scenarioCache.size > SCENARIO_CACHE_CAPACITY) {
    const oldest = scenarioCache.keys().next().value;
    if (oldest === undefined) break;
    scenarioCache.delete(oldest);
  }
}

const EMPTY_GRID = newCoverageGrid(AO_WORLD.bounds, 2.5);
const EMPTY_REJECTIONS: ReadonlyArray<RejectionEvent> = [];
const EMPTY_MAP_ATTACKS: ReadonlyArray<MapAttack> = [];
const EMPTY_DETECTION_MAP: DetectionMap = {};
const EMPTY_CONTACT_REPORTS: ContactReport[] = [];
const EMPTY_PHANTOM_WITNESSES: PhantomWitnessMap = {};
const STUB_ATTACKER: Attacker = { agentId: "", attackFn: (o) => o };

function specStub(
  snapshotCount: number,
  attackStartTick: number,
  hasAttackers: boolean,
  attackerIds: ReadonlyArray<string> = [],
): ScenarioSpec {
  return {
    agents: [],
    ticks: snapshotCount,
    attackStartTick,
    // Carry the attacker IDs across the worker boundary as id-only stubs so
    // overlays that need to know who's lying (e.g. L3's pre-detection lie
    // visualization) can read them off `spec.attackers`.
    attackers: hasAttackers
      ? attackerIds.length > 0
        ? attackerIds.map((id) => ({ ...STUB_ATTACKER, agentId: id }))
        : [STUB_ATTACKER]
      : undefined,
  };
}

function sliceFromSlamLesson(lessonId: string): Slice {
  const built = buildSlamSlice(lessonId);
  const targetSeconds = 20;
  const MIN_HZ = 4;
  const hz = Math.min(
    DEFAULT_PLAYBACK_HZ,
    Math.max(MIN_HZ, Math.floor(built.snapshots.length / targetSeconds)),
  );
  return {
    spec: specStub(built.snapshots.length, built.attackStartTick, built.hasAttackers),
    result: slamResult(built.snapshots),
    detectionMap: EMPTY_DETECTION_MAP,
    coverageGrid: EMPTY_GRID,
    mapAttacks: EMPTY_MAP_ATTACKS,
    contactReports: EMPTY_CONTACT_REPORTS,
    phantomWitnesses: EMPTY_PHANTOM_WITNESSES,
    rejections: EMPTY_REJECTIONS,
    playbackHz: hz,
  };
}

function sliceFromFixture(fixture: LessonFixture): Slice {
  const detectionMap = computeDetectionMap(
    fixture.snapshots,
    AO_WORLD.items,
    fixture.sensorRadiusM,
  );
  const contactReports = computeContactReports(
    detectionMap,
    AO_WORLD.items,
    fixture.mapAttacks,
    fixture.attackStartTick,
  );
  const phantomWitnesses = computePhantomWitnesses(
    fixture.snapshots,
    fixture.mapAttacks,
    fixture.sensorRadiusM,
  );
  return {
    spec: specStub(fixture.snapshots.length, fixture.attackStartTick, fixture.hasAttackers),
    result: {
      snapshots: fixture.snapshots,
      rumorSubject: fixture.rumorSubject,
      cliques: fixture.cliques,
    } as ScenarioResult,
    detectionMap,
    coverageGrid: fixture.coverageGrid,
    mapAttacks: fixture.mapAttacks,
    contactReports,
    phantomWitnesses,
    rejections: fixture.rejections,
  };
}

let activeRequestTag = 0;

export const useSimStore = create<SimState>((set, get) => {
  function commit(slice: Slice, attackIds: ReadonlyArray<string>, lessonId?: string) {
    startTransition(() => {
      set({
        ...(lessonId !== undefined ? { lessonId } : {}),
        attackIds: [...attackIds],
        ...slice,
        playbackHz: slice.playbackHz ?? DEFAULT_PLAYBACK_HZ,
        tickIndex: 0,
        isPlaying: true,
        loadingProgress: 1,
        endedDuringPlayback: false,
      });
    });
  }

  function streamForAttacks(
    ids: ReadonlyArray<string>,
    attackStartTick: number | undefined,
    lessonId?: string,
    attackSchedules?: Record<string, AttackSchedule>,
    flightPattern?: FlightPattern | null,
    pathPreset?: PathPresetId | null,
    pathWaypoints?: ReadonlyArray<[number, number]> | null,
    mapConfig?: MapConfig,
  ): void {
    const effectiveIds = ids.length > 0 ? ids : [FALLBACK_ATTACK];

    // Wave 5 — in Free Play Compose state, just update attackIds without
    // touching the sim. The Composer card is up; nothing is watching.
    const cur = get();
    if (cur.mode === "freeplay" && !cur.isRunning) {
      set({ attackIds: [...ids] });
      return;
    }

    const key = cacheKey(
      effectiveIds,
      attackStartTick,
      attackSchedules,
      flightPattern,
      pathPreset,
      pathWaypoints,
      mapConfig,
    );
    const cached = scenarioCache.get(key);
    if (cached) {
      scenarioCache.delete(key);
      scenarioCache.set(key, cached);
      commit(cached, ids, lessonId);
      return;
    }

    cancelAllWorkerRequests();
    const tag = ++activeRequestTag;

    set({
      ...(lessonId !== undefined ? { lessonId } : {}),
      attackIds: [...ids],
      spec: specStub(0, attackStartTick ?? 0, ids.length > 0),
      result: { snapshots: [] } as unknown as ScenarioResult,
      detectionMap: EMPTY_DETECTION_MAP,
      coverageGrid: EMPTY_GRID,
      mapAttacks: EMPTY_MAP_ATTACKS,
      contactReports: EMPTY_CONTACT_REPORTS,
      phantomWitnesses: EMPTY_PHANTOM_WITNESSES,
      rejections: EMPTY_REJECTIONS,
      tickIndex: 0,
      isPlaying: false,
      loadingProgress: 0,
      endedDuringPlayback: false,
      selectedAgentId: null,
    });

    const snapshots: TickSnapshot[] = [];
    streamSliceInWorker(
      effectiveIds,
      attackStartTick,
      {
        onChunk: (chunk, soFar, total) => {
          if (tag !== activeRequestTag) return;
          for (const s of chunk) snapshots.push(s);
          startTransition(() => {
            set((prev) => ({
              result: {
                snapshots: snapshots.slice(),
                rumorSubject: prev.result?.rumorSubject,
                cliques: prev.result?.cliques,
              } as unknown as ScenarioResult,
              loadingProgress: soFar / total,
              isPlaying: prev.isPlaying || snapshots.length >= 30,
            }));
          });
        },
        onDone: (tail: WorkerSliceTail) => {
          if (tag !== activeRequestTag) return;
          const slice: Slice = {
            spec: specStub(snapshots.length, tail.attackStartTick, tail.hasAttackers, tail.attackerIds),
            result: {
              snapshots,
              rumorSubject: tail.rumorSubject,
              cliques: tail.cliques,
            } as ScenarioResult,
            detectionMap: tail.detectionMap,
            coverageGrid: tail.coverageGrid,
            mapAttacks: tail.mapAttacks,
            contactReports: tail.contactReports,
            phantomWitnesses: tail.phantomWitnesses,
            rejections: tail.rejections,
          };
          bumpCache(key, slice);
          startTransition(() => {
            set({
              spec: slice.spec,
              detectionMap: slice.detectionMap,
              coverageGrid: slice.coverageGrid,
              mapAttacks: slice.mapAttacks,
              contactReports: slice.contactReports,
              phantomWitnesses: slice.phantomWitnesses,
              rejections: slice.rejections,
              loadingProgress: 1,
              isPlaying: true,
            });
          });
        },
        onError: (err) => {
          if (tag !== activeRequestTag) return;
          console.error("[simStore] worker failed", err);
          set({ loadingProgress: 0 });
        },
      },
      attackSchedules,
      flightPattern ?? undefined,
      pathPreset,
      pathWaypoints,
      mapConfig,
    );
  }

  function currentMapConfig(state: SimState): MapConfig {
    return {
      presetId: state.mapPresetId,
      beaconCount: state.beaconCount,
      beaconLayoutName: state.beaconLayoutName,
      beaconPositions: state.beaconPositions ?? undefined,
    };
  }

  function restream(state: SimState, overrides: {
    attackIds?: ReadonlyArray<string>;
    attackSchedules?: Record<string, AttackSchedule>;
    flightPattern?: FlightPattern | null;
    pathPreset?: PathPresetId | null;
    pathWaypoints?: ReadonlyArray<[number, number]> | null;
  } = {}): void {
    streamForAttacks(
      overrides.attackIds ?? state.attackIds,
      undefined,
      undefined,
      overrides.attackSchedules ?? state.attackSchedules,
      overrides.flightPattern ?? state.flightPattern,
      overrides.pathPreset ?? state.pathPreset,
      overrides.pathWaypoints ?? state.pathWaypoints,
      currentMapConfig(state),
    );
  }

  return {
    mode: "workshop",
    lessonId: null,
    attackIds: [],
    attackSchedules: {},
    flightPattern: null,
    pathPreset: null,
    pathWaypoints: null,
    mapPresetId: DEFAULT_MAP_PRESET_ID,
    beaconCount: findPreset(DEFAULT_MAP_PRESET_ID).defaultBeaconCount,
    beaconLayoutName: findPreset(DEFAULT_MAP_PRESET_ID).defaultBeaconLayout,
    beaconPositions: null,
    spec: null,
    result: null,
    detectionMap: {},
    coverageGrid: EMPTY_GRID,
    mapAttacks: [],
    contactReports: [],
    phantomWitnesses: {},
    rejections: [],
    tickIndex: 0,
    isPlaying: false,
    playbackHz: 35,
    autoAdvance: true,
    endedDuringPlayback: false,
    loadingProgress: 1,
    selectedAgentId: null,
    welcomeDismissed: welcomePersisted(),
    isRunning: false,
    mapTool: null,

    dismissWelcome: () => set({ welcomeDismissed: true }),

    setMode: (mode) => {
      // Free Play always opens in Compose state; other modes ignore the flag.
      set({ mode, isRunning: mode === "freeplay" ? false : true });
    },

    launch: () => {
      const state = get();
      set({ isRunning: true });
      streamForAttacks(
        state.attackIds,
        undefined,
        undefined,
        state.attackSchedules,
        state.flightPattern,
        state.pathPreset,
        state.pathWaypoints,
        currentMapConfig(state),
      );
    },

    exitRun: () => set({ isRunning: false, isPlaying: false }),

    setMapTool: (tool) => set({ mapTool: tool }),

    loadComposerPreset: (preset) => {
      set({
        attackIds: [...preset.attackIds],
        attackSchedules: { ...preset.attackSchedules },
        flightPattern: preset.flightPattern,
        pathPreset: preset.pathPreset,
        pathWaypoints: preset.pathWaypoints ? [...preset.pathWaypoints] : null,
        mapPresetId: preset.mapPresetId,
        beaconCount: preset.beaconCount,
        beaconLayoutName: preset.beaconLayoutName,
        beaconPositions: preset.beaconPositions
          ? preset.beaconPositions.map(([x, y]) => [x, y] as [number, number])
          : null,
      });
    },

    loadScenario: (_bundle, attackId) => {
      streamForAttacks([attackId], undefined);
    },

    setActiveAttacks: (ids) => {
      streamForAttacks(ids, undefined);
    },

    toggleAttack: (id) => {
      const state = get();
      const isAdding = !state.attackIds.includes(id);
      const next = isAdding
        ? [...state.attackIds, id]
        : state.attackIds.filter((x) => x !== id);
      const schedules = { ...state.attackSchedules };
      if (isAdding) {
        schedules[id] = { startTick: 0, endTick: DEFAULT_END_TICK };
      } else {
        delete schedules[id];
      }
      set({ attackSchedules: schedules });
      restream(get(), { attackIds: next, attackSchedules: schedules });
    },

    setAttackStartTick: (tick) => {
      const state = get();
      if (state.attackIds.length === 0) return;
      streamForAttacks(
        state.attackIds,
        Math.max(0, Math.round(tick)),
        undefined,
        state.attackSchedules,
        state.flightPattern,
        state.pathPreset,
        state.pathWaypoints,
        currentMapConfig(state),
      );
    },

    setAttackSchedule: (id, partial) => {
      const state = get();
      if (!state.attackIds.includes(id)) return;
      const existing = state.attackSchedules[id] ?? { startTick: 0, endTick: DEFAULT_END_TICK };
      const startTick = Math.max(0, Math.round(partial.startTick ?? existing.startTick));
      const endTick = Math.max(startTick + 1, Math.round(partial.endTick ?? existing.endTick));
      const schedules = { ...state.attackSchedules, [id]: { startTick, endTick } };
      set({ attackSchedules: schedules });
      restream(get(), { attackSchedules: schedules });
    },

    setFlightPattern: (pattern) => {
      set({ flightPattern: pattern });
      restream(get(), { flightPattern: pattern });
    },

    setPathPreset: (preset) => {
      set({ pathPreset: preset });
      restream(get(), { pathPreset: preset });
    },

    setPathWaypoints: (waypoints) => {
      set({ pathWaypoints: waypoints });
      restream(get(), { pathWaypoints: waypoints });
    },

    setMapPreset: (id) => {
      const preset = findPreset(id);
      set({
        mapPresetId: preset.id,
        beaconCount: preset.defaultBeaconCount,
        beaconLayoutName: preset.defaultBeaconLayout,
        beaconPositions: null,
      });
      restream(get());
    },

    setBeaconCount: (n) => {
      const clamped = Math.max(0, Math.round(n));
      set({ beaconCount: clamped, beaconPositions: null });
      restream(get());
    },

    setBeaconLayoutName: (name) => {
      set({ beaconLayoutName: name, beaconPositions: null });
      restream(get());
    },

    setBeaconPositions: (positions) => {
      set({ beaconPositions: positions });
      restream(get());
    },

    selectLesson: (lessonId) => {
      const lesson = LESSONS.find((l) => l.id === lessonId);
      const attackIds = lesson ? [...lesson.attackIds] : [FALLBACK_ATTACK];
      const key = cacheKey(attackIds, undefined);
      const cached = scenarioCache.get(key);
      if (cached) {
        scenarioCache.delete(key);
        scenarioCache.set(key, cached);
        ++activeRequestTag;
        commit(cached, attackIds, lessonId);
        return;
      }
      if (isSlamLesson(lessonId)) {
        ++activeRequestTag;
        const slice = sliceFromSlamLesson(lessonId);
        bumpCache(key, slice);
        commit(slice, attackIds, lessonId);
        return;
      }
      const tag = ++activeRequestTag;
      void loadLessonFixture(lessonId)
        .then((fixture) => {
          if (tag !== activeRequestTag) return;
          if (fixture) {
            commit(sliceFromFixture(fixture), attackIds, lessonId);
          } else {
            streamForAttacks(attackIds, undefined, lessonId);
          }
        })
        .catch(() => {
          if (tag !== activeRequestTag) return;
          streamForAttacks(attackIds, undefined, lessonId);
        });
    },

    nextLesson: () => {
      const idx = lessonIndex(get().lessonId);
      if (idx < 0 || idx >= LESSONS.length - 1) return;
      get().selectLesson(LESSONS[idx + 1]!.id);
    },

    prevLesson: () => {
      const idx = lessonIndex(get().lessonId);
      if (idx <= 0) return;
      get().selectLesson(LESSONS[idx - 1]!.id);
    },

    setAutoAdvance: (on) => set({ autoAdvance: on }),

    setTick: (index) => {
      const total = get().result?.snapshots.length ?? 0;
      if (total === 0) return;
      const clamped = Math.max(0, Math.min(total - 1, index));
      set({ tickIndex: clamped });
    },

    step: (delta) => {
      const total = get().result?.snapshots.length ?? 0;
      if (total === 0) return;
      const wasPlaying = get().isPlaying;
      const next = get().tickIndex + delta;
      const clamped = Math.max(0, Math.min(total - 1, next));
      set({ tickIndex: clamped });
      if (clamped === total - 1 && get().loadingProgress >= 1) {
        set({ isPlaying: false, endedDuringPlayback: wasPlaying });
      }
    },

    reset: () => {
      set({ tickIndex: 0, isPlaying: false, endedDuringPlayback: false });
    },

    setPlaying: (playing) => set({ isPlaying: playing }),

    clearEndedFlag: () => set({ endedDuringPlayback: false }),

    setSelectedAgent: (id) => set({ selectedAgentId: id }),

    prefetchScenarios: (idsList) => {
      for (const ids of idsList) {
        const effectiveIds = ids.length > 0 ? ids : [FALLBACK_ATTACK];
        const key = cacheKey(effectiveIds, undefined);
        if (scenarioCache.has(key)) continue;
        const snapshots: TickSnapshot[] = [];
        streamSliceInWorker(effectiveIds, undefined, {
          onChunk: (chunk) => {
            for (const s of chunk) snapshots.push(s);
          },
          onDone: (tail) => {
            bumpCache(key, {
              spec: specStub(snapshots.length, tail.attackStartTick, tail.hasAttackers, tail.attackerIds),
              result: {
                snapshots,
                rumorSubject: tail.rumorSubject,
                cliques: tail.cliques,
              } as ScenarioResult,
              detectionMap: tail.detectionMap,
              coverageGrid: tail.coverageGrid,
              mapAttacks: tail.mapAttacks,
              contactReports: tail.contactReports,
              phantomWitnesses: tail.phantomWitnesses,
              rejections: tail.rejections,
            });
          },
          onError: () => {},
        });
      }
    },

    prefetchLessons: (lessonIds) => {
      for (const lessonId of lessonIds) {
        const lesson = LESSONS.find((l) => l.id === lessonId);
        if (!lesson) continue;
        const attackIds = [...lesson.attackIds];
        const key = cacheKey(attackIds, undefined);
        if (scenarioCache.has(key)) continue;
        if (isSlamLesson(lessonId)) {
          bumpCache(key, sliceFromSlamLesson(lessonId));
          continue;
        }
        void loadLessonFixture(lessonId)
          .then((fixture) => {
            if (scenarioCache.has(key)) return;
            if (fixture) {
              bumpCache(key, sliceFromFixture(fixture));
            } else {
              get().prefetchScenarios([attackIds]);
            }
          })
          .catch(() => {
            if (!scenarioCache.has(key)) get().prefetchScenarios([attackIds]);
          });
      }
    },
  };
});

export function useCurrentSnapshot(): TickSnapshot | null {
  return useSimStore((s) => s.result?.snapshots[s.tickIndex] ?? null);
}

export function useDetectionMap(): DetectionMap {
  return useSimStore((s) => s.detectionMap);
}

export function useCoverageGrid(): CoverageGrid {
  return useSimStore((s) => s.coverageGrid);
}

export function useMapAttacks(): ReadonlyArray<MapAttack> {
  return useSimStore((s) => s.mapAttacks);
}

export function useContactReports(): ContactReport[] {
  return useSimStore((s) => s.contactReports);
}

export function useRejections(): ReadonlyArray<RejectionEvent> {
  return useSimStore((s) => s.rejections);
}

export function useSnapshots(): ReadonlyArray<TickSnapshot> {
  return useSimStore((s) => s.result?.snapshots ?? EMPTY_SNAPSHOTS);
}
const EMPTY_SNAPSHOTS: ReadonlyArray<TickSnapshot> = [];

export function useRumorSubject(): string | undefined {
  return useSimStore((s) => s.result?.rumorSubject);
}

export function useCliques(): ReadonlyArray<ReadonlyArray<string>> | undefined {
  return useSimStore((s) => s.result?.cliques);
}

export function usePhantomWitnesses(): PhantomWitnessMap {
  return useSimStore((s) => s.phantomWitnesses);
}

export function useLoadingProgress(): number {
  return useSimStore((s) => s.loadingProgress);
}
