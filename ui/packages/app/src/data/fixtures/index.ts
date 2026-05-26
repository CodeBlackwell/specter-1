import type { TickSnapshot } from "@specter/sim-core";
import { newCoverageGrid } from "../../sim/coverage";
import type { CoverageGrid } from "../../sim/coverage";
import type { MapAttack } from "../../sim/contacts";
import type { RejectionEvent } from "../../sim/rejections";
import { AO_WORLD } from "../../sim/world";
import { LESSONS } from "../lessons";

export type LessonFixture = {
  attackId: string;
  attackStartTick: number;
  hasAttackers: boolean;
  sensorRadiusM: number;
  snapshots: TickSnapshot[];
  coverageGrid: CoverageGrid;
  mapAttacks: ReadonlyArray<MapAttack>;
  rejections: ReadonlyArray<RejectionEvent>;
  rumorSubject?: string;
  cliques?: ReadonlyArray<ReadonlyArray<string>>;
};

const SLAM_TRUNKS: ReadonlySet<string> = new Set(["09", "10", "11", "12"]);

const KNOWN_ATTACK_IDS: ReadonlySet<string> = new Set(
  LESSONS
    .filter((l) => l.attackIds.length === 1 && !SLAM_TRUNKS.has(l.id))
    .map((l) => l.attackIds[0]!),
);

const MULTI_ATTACK_LESSON_IDS: ReadonlySet<string> = new Set(
  LESSONS
    .filter((l) => l.attackIds.length > 1 && !SLAM_TRUNKS.has(l.id))
    .map((l) => l.id),
);

const cache = new Map<string, Promise<LessonFixture>>();

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$bigint === "string") return BigInt(obj.$bigint);
    if (Array.isArray(obj.$i32)) return new Int32Array(obj.$i32 as number[]);
  }
  return value;
}

function fixtureUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}fixtures/${slug}.json`;
}

async function loadFixtureBySlug(slug: string): Promise<LessonFixture> {
  const existing = cache.get(slug);
  if (existing) return existing;
  const promise = fetch(fixtureUrl(slug))
    .then((res) => {
      if (!res.ok) throw new Error(`Fixture ${slug} → HTTP ${res.status}`);
      return res.text();
    })
    .then((raw) => JSON.parse(raw, reviver) as LessonFixture);
  cache.set(slug, promise);
  return promise;
}

export async function loadLessonFixture(lessonId: string): Promise<LessonFixture | null> {
  const lesson = LESSONS.find((l) => l.id === lessonId);
  if (!lesson) return null;
  if (SLAM_TRUNKS.has(lesson.id)) return null;
  if (lesson.attackIds.length === 1) {
    const attackId = lesson.attackIds[0]!;
    if (!KNOWN_ATTACK_IDS.has(attackId)) return null;
    return loadFixtureBySlug(attackId);
  }
  if (MULTI_ATTACK_LESSON_IDS.has(lesson.id)) {
    return loadFixtureBySlug(`lesson_${lesson.id}`);
  }
  return null;
}

export function warmFixtureCache(): void {
  for (const attackId of KNOWN_ATTACK_IDS) {
    void loadFixtureBySlug(attackId).catch(() => {});
  }
  for (const lessonId of MULTI_ATTACK_LESSON_IDS) {
    void loadFixtureBySlug(`lesson_${lessonId}`).catch(() => {});
  }
}

export const EMPTY_COVERAGE_GRID: CoverageGrid = newCoverageGrid(AO_WORLD.bounds, 2.5);
