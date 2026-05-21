export type AOBounds = { minX: number; minY: number; maxX: number; maxY: number };

export type BuildingSubtype = "residential" | "outpost" | "industrial";
export type VehicleSubtype = "truck" | "light";

export type Item =
  | { kind: "building"; id: string; label: string; subtype: BuildingSubtype; x: number; y: number; w: number; h: number }
  | { kind: "vehicle"; id: string; label: string; subtype: VehicleSubtype; x: number; y: number; w: number; h: number }
  | { kind: "uxo"; id: string; label: string; x: number; y: number }
  | { kind: "fob"; id: string; label: string; x: number; y: number; w: number; h: number };

export type AOWorld = {
  bounds: AOBounds;
  sectorSize: number;
  sensorRadiusM: number;
  items: ReadonlyArray<Item>;
};

export const AO_WORLD: AOWorld = {
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  sectorSize: 20,
  sensorRadiusM: 14,
  items: [
    { kind: "fob", id: "fob-stalwart", label: "FOB STALWART", x: 4, y: 4, w: 14, h: 14 },
    { kind: "building", id: "bldg-outpost", label: "DAMAGED OUTPOST", subtype: "outpost", x: 16, y: 72, w: 9, h: 8 },
    { kind: "building", id: "bldg-residential", label: "RESIDENTIAL BLOCK", subtype: "residential", x: 55, y: 62, w: 16, h: 11 },
    { kind: "building", id: "bldg-industrial", label: "INDUSTRIAL COMPLEX", subtype: "industrial", x: 62, y: 18, w: 22, h: 16 },
    { kind: "vehicle", id: "veh-truck-1", label: "TRUCK", subtype: "truck", x: 60, y: 38, w: 4, h: 2.5 },
    { kind: "vehicle", id: "veh-truck-2", label: "TRUCK", subtype: "truck", x: 30, y: 65, w: 4, h: 2.5 },
    { kind: "vehicle", id: "veh-light-3", label: "VEHICLE", subtype: "light", x: 42, y: 42, w: 3, h: 2.5 },
    { kind: "vehicle", id: "veh-light-4", label: "VEHICLE", subtype: "light", x: 80, y: 75, w: 3, h: 2.5 },
    { kind: "uxo", id: "uxo-alpha", label: "UXO α", x: 50, y: 60 },
    { kind: "uxo", id: "uxo-bravo", label: "UXO β", x: 55, y: 30 },
  ],
};
