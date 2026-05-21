import { runScenario } from "@specter/sim-core";
import { ATTACK_CATALOG, composeBundles } from "../src/data/scenarios";
import { AO_WORLD } from "../src/sim/world";
import { computeContactReports } from "../src/sim/contacts";
import { computeDetectionMap } from "../src/sim/detection";
import { computePhantomWitnesses } from "../src/sim/phantomWitnesses";

const targets = ["honest", "range_lie", "colluder_pair", "sensor_fuzz", "partition_gossip"];

console.log("attack            runScenario  derived  total");
console.log("───────────────── ───────────  ───────  ─────");

for (const attackId of targets) {
  const entry = ATTACK_CATALOG.find((a) => a.id === attackId)!;
  const composed = composeBundles([entry.build()]);

  const t0 = performance.now();
  const result = runScenario(composed.spec);
  const tRun = performance.now() - t0;

  const t1 = performance.now();
  const detectionMap = computeDetectionMap(result.snapshots, AO_WORLD.items, AO_WORLD.sensorRadiusM);
  computeContactReports(detectionMap, AO_WORLD.items, composed.mapAttacks, composed.spec.attackStartTick ?? 0);
  computePhantomWitnesses(result.snapshots, composed.mapAttacks, AO_WORLD.sensorRadiusM);
  const tDerived = performance.now() - t1;

  const total = tRun + tDerived;
  console.log(
    `${attackId.padEnd(18)}${tRun.toFixed(0).padStart(7)}ms ${tDerived.toFixed(0).padStart(7)}ms ${total.toFixed(0).padStart(5)}ms`,
  );
}
