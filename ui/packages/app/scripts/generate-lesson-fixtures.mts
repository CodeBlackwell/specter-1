import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runScenario } from "@specter/sim-core";
import { ATTACK_CATALOG, composeBundles } from "../src/data/scenarios";
import { LESSONS } from "../src/data/lessons";
import { AO_WORLD } from "../src/sim/world";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../public/fixtures");
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (f.endsWith(".json")) rmSync(join(outDir, f));
}

function bundleFor(attackId: string) {
  const entry = ATTACK_CATALOG.find((a) => a.id === attackId) ?? ATTACK_CATALOG[0]!;
  return entry.build();
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Int32Array) return { $i32: Array.from(value) };
  return value;
}

// SLAM lessons (L09–L12) build their tick stream in-process from sim-core's
// pose-graph demos — no swarm fixture needed (ADR 0019).
const SLAM_LESSON_IDS = new Set(["09", "10", "11", "12"]);
const fixtureLessons = LESSONS.filter(
  (l) => l.attackIds.length === 1 && !SLAM_LESSON_IDS.has(l.id),
);
const uniqueAttacks = new Set(fixtureLessons.map((l) => l.attackIds[0]!));
const multiAttackLessons = LESSONS.filter((l) => l.attackIds.length !== 1);
const slamLessons = LESSONS.filter((l) => SLAM_LESSON_IDS.has(l.id));
for (const attackId of uniqueAttacks) {
  const composed = composeBundles([bundleFor(attackId)]);
  const result = runScenario(composed.spec);
  const fixture = {
    attackId,
    attackStartTick: composed.spec.attackStartTick ?? 0,
    hasAttackers: (composed.spec.attackers?.length ?? 0) > 0,
    sensorRadiusM: AO_WORLD.sensorRadiusM,
    snapshots: result.snapshots,
    coverageGrid: composed.grid,
    mapAttacks: composed.mapAttacks,
    rejections: composed.rejections,
    rumorSubject: composed.spec.rumorSubject,
    cliques: composed.spec.cliques,
  };
  const json = JSON.stringify(fixture, replacer);
  const path = join(outDir, `${attackId}.json`);
  writeFileSync(path, json);
  const usedBy = LESSONS.filter((l) => l.attackIds[0] === attackId && l.attackIds.length === 1)
    .map((l) => l.id)
    .join(",");
  console.log(`✓ ${attackId} → ${Math.round(json.length / 1024)} KB · lessons ${usedBy}`);
}
for (const l of multiAttackLessons) {
  console.log(`· ${l.id} (${l.attackIds.join("+")}) → streamed at runtime`);
}
for (const l of slamLessons) {
  console.log(`· ${l.id} (${l.attackIds.join("+")}) → SLAM pose-graph stages (in-process)`);
}
console.log(
  `\n${uniqueAttacks.size} swarm fixtures for ${LESSONS.length} lessons ` +
    `(${multiAttackLessons.length} streamed, ${slamLessons.length} SLAM in-process)`,
);
