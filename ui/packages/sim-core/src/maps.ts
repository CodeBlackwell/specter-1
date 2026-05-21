/**
 * Wave 4 — Map presets + beacon layout factory.
 *
 * Named arenas with bounds + beacon-placement helpers. The Free Play Compose
 * card's ENVIRONMENT block reads from these (MAP dropdown / BEACONS selector).
 * Bounds are centered on (0, 0) so a single `sizeM` describes the playing
 * field: `xmin = -width/2`, `xmax = +width/2`, same for y.
 *
 * Parity contract: mirrored constant-for-constant in `src/specter/sim/maps.py`.
 * Each preset's default-layout beacons must fall inside `mapBounds(preset)`
 * (asserted in tests/maps.test.ts and tests/test_maps.py).
 */

export type BeaconLayoutName = "perimeter" | "corners" | "dense" | "custom";

export type MapSize = { width: number; height: number };

export type MapPreset = {
  id: string;
  label: string;
  sizeM: MapSize;
  defaultBeaconLayout: BeaconLayoutName;
  defaultBeaconCount: number;
};

export type MapBounds = {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
};

export const MAP_PRESETS: ReadonlyArray<MapPreset> = [
  {
    id: "WAREHOUSE_40x40",
    label: "WAREHOUSE · 40×40m",
    sizeM: { width: 40, height: 40 },
    defaultBeaconLayout: "perimeter",
    defaultBeaconCount: 4,
  },
  {
    id: "WAREHOUSE_60x40",
    label: "WAREHOUSE · 60×40m",
    sizeM: { width: 60, height: 40 },
    defaultBeaconLayout: "perimeter",
    defaultBeaconCount: 6,
  },
  {
    id: "OPEN_FIELD_100x100",
    label: "OPEN FIELD · 100×100m",
    sizeM: { width: 100, height: 100 },
    defaultBeaconLayout: "perimeter",
    defaultBeaconCount: 8,
  },
];

export function mapBounds(preset: MapPreset): MapBounds {
  const halfW = preset.sizeM.width / 2;
  const halfH = preset.sizeM.height / 2;
  return { xmin: -halfW, ymin: -halfH, xmax: halfW, ymax: halfH };
}

const DENSE_INSET_FRACTION = 0.1;

/**
 * Compute beacon coordinates for the given layout. Returns `[x, y]` pairs in
 * world meters, centered on (0, 0) to match `mapBounds`.
 *
 * - `"perimeter"` — evenly spaced along the rectangle perimeter. Step
 *   `s = 2(w+h)/count`, walked clockwise from top-left corner.
 * - `"corners"` — always exactly 4 points at the corners regardless of
 *   `count` (count is ignored; documented per Wave 4 spec).
 * - `"dense"` — m×m interior grid where `m = ceil(sqrt(count))`, then take
 *   the first `count` in row-major order. Inset 10% from each edge.
 * - `"custom"` — throws; positions must be supplied explicitly by the caller.
 */
export function beaconLayout(
  name: BeaconLayoutName,
  sizeM: MapSize,
  count: number,
): Array<[number, number]> {
  switch (name) {
    case "perimeter":
      return perimeterLayout(sizeM, count);
    case "corners":
      return cornersLayout(sizeM);
    case "dense":
      return denseLayout(sizeM, count);
    case "custom":
      throw new Error("custom layout requires explicit positions");
  }
}

function perimeterLayout(sizeM: MapSize, count: number): Array<[number, number]> {
  if (count <= 0) return [];
  const w = sizeM.width;
  const h = sizeM.height;
  const halfW = w / 2;
  const halfH = h / 2;
  const perimeter = 2 * (w + h);
  const step = perimeter / count;
  const out: Array<[number, number]> = [];
  // Clockwise from top-left: top edge (x increases), right edge (y decreases),
  // bottom edge (x decreases), left edge (y increases).
  for (let i = 0; i < count; i++) {
    const d = i * step;
    out.push(perimeterPoint(d, w, h, halfW, halfH));
  }
  return out;
}

function perimeterPoint(
  d: number,
  w: number,
  h: number,
  halfW: number,
  halfH: number,
): [number, number] {
  // d in [0, 2(w+h)) walked clockwise from top-left corner (-halfW, +halfH).
  if (d < w) return [-halfW + d, halfH];
  if (d < w + h) return [halfW, halfH - (d - w)];
  if (d < 2 * w + h) return [halfW - (d - w - h), -halfH];
  return [-halfW, -halfH + (d - 2 * w - h)];
}

function cornersLayout(sizeM: MapSize): Array<[number, number]> {
  const halfW = sizeM.width / 2;
  const halfH = sizeM.height / 2;
  return [
    [-halfW, halfH],
    [halfW, halfH],
    [halfW, -halfH],
    [-halfW, -halfH],
  ];
}

function denseLayout(sizeM: MapSize, count: number): Array<[number, number]> {
  if (count <= 0) return [];
  const m = Math.ceil(Math.sqrt(count));
  const insetX = sizeM.width * DENSE_INSET_FRACTION;
  const insetY = sizeM.height * DENSE_INSET_FRACTION;
  const xmin = -sizeM.width / 2 + insetX;
  const xmax = sizeM.width / 2 - insetX;
  const ymin = -sizeM.height / 2 + insetY;
  const ymax = sizeM.height / 2 - insetY;
  const stepX = m >= 2 ? (xmax - xmin) / (m - 1) : 0;
  const stepY = m >= 2 ? (ymax - ymin) / (m - 1) : 0;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / m);
    const col = i % m;
    const x = m >= 2 ? xmin + col * stepX : 0;
    const y = m >= 2 ? ymin + row * stepY : 0;
    out.push([x, y]);
  }
  return out;
}
