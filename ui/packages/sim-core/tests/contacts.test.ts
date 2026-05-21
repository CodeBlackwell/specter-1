import { describe, expect, test } from "vitest";

import {
  buildCop,
  emitContactReportsThisTick,
  COP_TRUST_THRESHOLD,
  type Item,
  type MapAttack,
  type PeerLocation,
  type ContactReport,
} from "../src";

const item: Item = { id: "uxo-bravo", kind: "uxo", x: 0, y: 0 };
const fob: Item = { id: "fob-stalwart", kind: "fob", x: 1, y: 1 };
const phantom: Item = { id: "phantom-1", kind: "uxo", x: -1, y: -1 };

const peers: PeerLocation[] = [
  { id: "alpha", x: 0, y: 0 },
  { id: "bravo", x: 0.5, y: 0.5 },
  { id: "charlie", x: 1.0, y: 1.0 },
];

const ts = (n: number) => BigInt(n);

describe("emitContactReportsThisTick", () => {
  test("honest peers within radius report every visible item", () => {
    const reports = emitContactReportsThisTick(peers, [item, fob], [], 5.0, ts(100));
    expect(reports).toHaveLength(6); // 3 peers × 2 items
    expect(reports.every((r) => r.timestamp_ns === ts(100))).toBe(true);
  });

  test("peers outside sensor radius do not emit reports", () => {
    const farPeers: PeerLocation[] = [{ id: "ghost", x: 100, y: 100 }];
    const reports = emitContactReportsThisTick(farPeers, [item], [], 5.0, ts(0));
    expect(reports).toHaveLength(0);
  });

  test("MapAttack phantom_contacts inject phantom reports for the attacker only", () => {
    const attack: MapAttack = {
      reporter_id: "alpha",
      phantom_contacts: [phantom],
      suppressed_item_ids: [],
    };
    const reports = emitContactReportsThisTick(peers, [item], [attack], 5.0, ts(0));
    // 3 real reports for the uxo + 1 phantom report by alpha
    expect(reports.filter((r) => r.contact_id === phantom.id)).toHaveLength(1);
    expect(reports.find((r) => r.contact_id === phantom.id)!.reporter_id).toBe("alpha");
  });

  test("MapAttack suppressed_item_ids removes the attacker's report of that item", () => {
    const attack: MapAttack = {
      reporter_id: "alpha",
      phantom_contacts: [],
      suppressed_item_ids: [item.id],
    };
    const reports = emitContactReportsThisTick(peers, [item], [attack], 5.0, ts(0));
    expect(reports.filter((r) => r.contact_id === item.id && r.reporter_id === "alpha")).toHaveLength(0);
    expect(reports.filter((r) => r.contact_id === item.id)).toHaveLength(2);
  });
});

describe("buildCop", () => {
  test("an empty log returns an empty COP", () => {
    expect(buildCop([], {})).toEqual(new Map());
  });

  test("a contact reported by N high-rep peers survives with average reputation as weight", () => {
    const log: ContactReport[] = [
      { reporter_id: "alpha", contact_id: "x", kind: "uxo", x: 1, y: 1, timestamp_ns: ts(1) },
      { reporter_id: "bravo", contact_id: "x", kind: "uxo", x: 1, y: 1, timestamp_ns: ts(2) },
    ];
    const cop = buildCop(log, { alpha: 0.9, bravo: 0.7 });
    const entry = cop.get("x");
    expect(entry).toBeDefined();
    expect(entry!.weight).toBeCloseTo((0.9 + 0.7) / 2, 12);
    expect(entry!.reporters).toEqual(["alpha", "bravo"]);
  });

  test("a contact whose reporters' avg reputation falls below threshold is filtered out", () => {
    const log: ContactReport[] = [
      { reporter_id: "compromised", contact_id: "phantom", kind: "uxo", x: 5, y: 5, timestamp_ns: ts(1) },
    ];
    const cop = buildCop(log, { compromised: 0.1 });
    expect(cop.get("phantom")).toBeUndefined();
  });

  test("position is averaged across all reports of the same contact_id (rejects jitter)", () => {
    const log: ContactReport[] = [
      { reporter_id: "alpha", contact_id: "x", kind: "uxo", x: 0.0, y: 0.0, timestamp_ns: ts(1) },
      { reporter_id: "alpha", contact_id: "x", kind: "uxo", x: 2.0, y: 0.0, timestamp_ns: ts(2) },
      { reporter_id: "bravo", contact_id: "x", kind: "uxo", x: 0.0, y: 2.0, timestamp_ns: ts(3) },
    ];
    const cop = buildCop(log, { alpha: 0.9, bravo: 0.9 });
    const entry = cop.get("x");
    expect(entry!.x).toBeCloseTo((0.0 + 2.0 + 0.0) / 3, 12);
    expect(entry!.y).toBeCloseTo((0.0 + 0.0 + 2.0) / 3, 12);
  });

  test("distinct reporter set: duplicate reports from same reporter count once for avg weight", () => {
    const log: ContactReport[] = [
      { reporter_id: "alpha", contact_id: "x", kind: "uxo", x: 0, y: 0, timestamp_ns: ts(1) },
      { reporter_id: "alpha", contact_id: "x", kind: "uxo", x: 0, y: 0, timestamp_ns: ts(2) },
      { reporter_id: "alpha", contact_id: "x", kind: "uxo", x: 0, y: 0, timestamp_ns: ts(3) },
      { reporter_id: "bravo", contact_id: "x", kind: "uxo", x: 0, y: 0, timestamp_ns: ts(4) },
    ];
    const cop = buildCop(log, { alpha: 0.4, bravo: 1.0 });
    const entry = cop.get("x");
    // distinct reporters = {alpha, bravo}; avg = (0.4 + 1.0) / 2 = 0.7 >= 0.5
    expect(entry).toBeDefined();
    expect(entry!.weight).toBeCloseTo(0.7, 12);
    expect(entry!.reporters).toEqual(["alpha", "bravo"]);
  });

  test("default threshold matches Python COP_TRUST_THRESHOLD = 0.5", () => {
    expect(COP_TRUST_THRESHOLD).toBe(0.5);
  });
});
