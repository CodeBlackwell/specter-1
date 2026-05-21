import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { gridLandmarks } from "../src/landmarks";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  landmarks: Array<{
    label: string;
    params: { min_x: number; min_y: number; max_x: number; max_y: number; spacing_m: number };
    landmarks: Array<{ id: string; x: number; y: number }>;
  }>;
};

describe("Landmark grid parity vs Python (specter.sim.world)", () => {
  it.each(fixtures.landmarks)("gridLandmarks $label byte-equal to Python reference", (vec) => {
    const ours = gridLandmarks(
      vec.params.min_x,
      vec.params.min_y,
      vec.params.max_x,
      vec.params.max_y,
      vec.params.spacing_m,
    );
    expect(ours.length).toBe(vec.landmarks.length);
    for (let i = 0; i < ours.length; i++) {
      expect(ours[i]!.id).toBe(vec.landmarks[i]!.id);
      expect(ours[i]!.x).toBeCloseTo(vec.landmarks[i]!.x, 12);
      expect(ours[i]!.y).toBeCloseTo(vec.landmarks[i]!.y, 12);
    }
  });
});
