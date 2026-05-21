import { describe, expect, it } from "vitest";
import {
  MAP_PRESETS,
  beaconLayout,
  mapBounds,
  type MapPreset,
} from "../src/maps";

const TOL = 1e-9;

function within(b: { xmin: number; ymin: number; xmax: number; ymax: number }, p: [number, number]): boolean {
  return p[0] >= b.xmin - TOL && p[0] <= b.xmax + TOL && p[1] >= b.ymin - TOL && p[1] <= b.ymax + TOL;
}

describe("MAP_PRESETS", () => {
  it("exposes the three Wave 4 presets in order", () => {
    expect(MAP_PRESETS.map((p) => p.id)).toEqual([
      "WAREHOUSE_40x40",
      "WAREHOUSE_60x40",
      "OPEN_FIELD_100x100",
    ]);
  });

  it.each(MAP_PRESETS as ReadonlyArray<MapPreset>)(
    "default layout beacons fall within bounds for $id",
    (preset) => {
      const bounds = mapBounds(preset);
      const beacons = beaconLayout(
        preset.defaultBeaconLayout,
        preset.sizeM,
        preset.defaultBeaconCount,
      );
      expect(beacons.length).toBe(preset.defaultBeaconCount);
      for (const b of beacons) expect(within(bounds, b)).toBe(true);
    },
  );
});

describe("mapBounds", () => {
  it("is centered on (0, 0)", () => {
    for (const p of MAP_PRESETS) {
      const b = mapBounds(p);
      expect(b.xmin + b.xmax).toBeCloseTo(0, 12);
      expect(b.ymin + b.ymax).toBeCloseTo(0, 12);
      expect(b.xmax - b.xmin).toBeCloseTo(p.sizeM.width, 12);
      expect(b.ymax - b.ymin).toBeCloseTo(p.sizeM.height, 12);
    }
  });
});

function perimeterArcLength(p: [number, number], w: number, h: number): number {
  // Distance walked clockwise from top-left corner along the perimeter.
  const halfW = w / 2;
  const halfH = h / 2;
  const eps = 1e-9;
  if (Math.abs(p[1] - halfH) < eps && p[0] >= -halfW - eps && p[0] <= halfW + eps) {
    return p[0] - -halfW; // top edge
  }
  if (Math.abs(p[0] - halfW) < eps) return w + (halfH - p[1]); // right edge
  if (Math.abs(p[1] - -halfH) < eps) return w + h + (halfW - p[0]); // bottom edge
  return 2 * w + h + (p[1] - -halfH); // left edge
}

describe("beaconLayout perimeter", () => {
  it("produces consecutive arc-length gaps equal within float tolerance", () => {
    const sizeM = { width: 60, height: 40 };
    const count = 8;
    const pts = beaconLayout("perimeter", sizeM, count);
    expect(pts.length).toBe(count);
    const perim = 2 * (sizeM.width + sizeM.height);
    const arcs = pts.map((p) => perimeterArcLength(p, sizeM.width, sizeM.height));
    const gaps: number[] = [];
    for (let i = 0; i < arcs.length; i++) {
      const next = i + 1 < arcs.length ? arcs[i + 1]! : arcs[0]! + perim;
      gaps.push(next - arcs[i]!);
    }
    const expected = perim / count;
    for (const g of gaps) expect(g).toBeCloseTo(expected, 9);
  });

  it("starts at the top-left corner", () => {
    const sizeM = { width: 40, height: 40 };
    const pts = beaconLayout("perimeter", sizeM, 4);
    expect(pts[0]![0]).toBeCloseTo(-20, 12);
    expect(pts[0]![1]).toBeCloseTo(20, 12);
  });

  it("with count=4 on a square places one beacon per side at corner mid-distance", () => {
    // Sanity: 4 beacons, perimeter 160, step 40 → corners exactly.
    const pts = beaconLayout("perimeter", { width: 40, height: 40 }, 4);
    expect(pts).toEqual([
      [-20, 20],
      [20, 20],
      [20, -20],
      [-20, -20],
    ]);
  });
});

describe("beaconLayout corners", () => {
  it("returns four points at the four corners regardless of count", () => {
    const sizeM = { width: 60, height: 40 };
    for (const count of [1, 4, 9, 99]) {
      const pts = beaconLayout("corners", sizeM, count);
      expect(pts.length).toBe(4);
      const set = new Set(pts.map(([x, y]) => `${x},${y}`));
      expect(set.has("-30,20")).toBe(true);
      expect(set.has("30,20")).toBe(true);
      expect(set.has("30,-20")).toBe(true);
      expect(set.has("-30,-20")).toBe(true);
    }
  });
});

describe("beaconLayout dense", () => {
  it("with count=9 produces a 3x3 grid inset 10% from edges", () => {
    const sizeM = { width: 100, height: 100 };
    const pts = beaconLayout("dense", sizeM, 9);
    expect(pts.length).toBe(9);
    // inset 10% → xmin=-40, xmax=40; step = 40 over m-1=2 → 40
    const expectedXs = [-40, 0, 40];
    const expectedYs = [-40, 0, 40];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const p = pts[row * 3 + col]!;
        expect(p[0]).toBeCloseTo(expectedXs[col]!, 9);
        expect(p[1]).toBeCloseTo(expectedYs[row]!, 9);
      }
    }
  });

  it("stays within bounds for count=5 (5 of 9 grid slots)", () => {
    const sizeM = { width: 40, height: 40 };
    const pts = beaconLayout("dense", sizeM, 5);
    expect(pts.length).toBe(5);
    const bounds = { xmin: -20, ymin: -20, xmax: 20, ymax: 20 };
    for (const p of pts) expect(within(bounds, p)).toBe(true);
  });
});

describe("beaconLayout custom", () => {
  it("throws because positions must be supplied externally", () => {
    expect(() => beaconLayout("custom", { width: 40, height: 40 }, 4)).toThrowError(
      "custom layout requires explicit positions",
    );
  });
});
