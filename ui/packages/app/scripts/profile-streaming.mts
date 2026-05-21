import { runScenario } from "@specter/sim-core";
import { ATTACK_CATALOG, composeBundles } from "../src/data/scenarios";

const composed = composeBundles([ATTACK_CATALOG.find((a) => a.id === "honest")!.build()]);

let chunks = 0;
let firstChunkMs: number | null = null;
const T0 = performance.now();

runScenario(composed.spec, {
  chunkSize: 50,
  onChunk: (chunk, soFar, total) => {
    chunks++;
    if (firstChunkMs === null) firstChunkMs = performance.now() - T0;
    if (chunks === 1 || chunks % 5 === 0 || soFar === total) {
      const elapsed = performance.now() - T0;
      console.log(
        `  chunk ${chunks.toString().padStart(2)}: +${chunk.length} ticks, ` +
          `${soFar}/${total} @ ${elapsed.toFixed(0)}ms`,
      );
    }
  },
});

const total = performance.now() - T0;
console.log(`\ntotal: ${total.toFixed(0)}ms · ${chunks} chunks · first chunk @ ${firstChunkMs?.toFixed(0)}ms`);
