import { describe, expect, test } from "vitest";

import { createAgent } from "../src/agent";
import {
  runSecureScenario,
  rangeLie,
  type Item,
  type MapAttack,
} from "../src";

const fourPeers = () => [
  createAgent({ id: "alpha", x: 0, y: 0 }),
  createAgent({ id: "bravo", x: 1, y: 0 }),
  createAgent({ id: "charlie", x: 0, y: 1 }),
  createAgent({ id: "delta", x: 1, y: 1 }),
];

const uxo: Item = { id: "uxo-bravo", kind: "uxo", x: 0.5, y: 0.5 };
const fob: Item = { id: "fob-stalwart", kind: "fob", x: 0.7, y: 0.7 };
const phantomUxo: Item = { id: "phantom-uxo-1", kind: "uxo", x: -0.5, y: -0.5 };

describe("runSecureScenario — COP integration (ADR 0019)", () => {
  test("honest swarm produces a COP containing every real item", () => {
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 5,
      items: [uxo, fob],
      copSensorRadiusM: 5.0,
    });
    expect(result.cop.has(uxo.id)).toBe(true);
    expect(result.cop.has(fob.id)).toBe(true);
    const uxoEntry = result.cop.get(uxo.id)!;
    expect(uxoEntry.reporters.length).toBeGreaterThanOrEqual(2);
    expect(uxoEntry.weight).toBeGreaterThan(0.5);
  });

  test("cop_phantom: high-rep attacker injects a phantom that survives until rep collapses", () => {
    // Alpha lies on range (so Tier 1 drives alpha's rep down) AND simultaneously
    // plants a phantom UXO. Until Tier 1 reciprocal-range catches alpha, the
    // phantom is in the COP because its reporter has high rep. After detection,
    // alpha's rep falls and the phantom drops out.
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 80, // long enough for Tier 1 to fire
      attackers: [rangeLie("alpha")],
      attackStartTick: 1,
      items: [uxo],
      mapAttacks: [
        {
          reporter_id: "alpha",
          phantom_contacts: [phantomUxo],
          suppressed_item_ids: [],
        },
      ],
      copSensorRadiusM: 5.0,
    });

    // Alpha's rep must collapse below 0.5 by end of run (Tier 1 catches it).
    expect(result.evaluator.reputation("alpha")).toBeLessThan(0.5);

    // The phantom contact has only one reporter (alpha) — once alpha drops
    // below 0.5, avg_weight = alpha's rep < 0.5, phantom filtered out.
    expect(result.cop.has(phantomUxo.id)).toBe(false);

    // The real UXO has multiple honest reporters; survives.
    expect(result.cop.has(uxo.id)).toBe(true);
  });

  test("cop_suppress: a suppressing reporter cannot remove items that other peers also report", () => {
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 5,
      items: [uxo],
      mapAttacks: [
        {
          reporter_id: "alpha",
          phantom_contacts: [],
          suppressed_item_ids: [uxo.id],
        },
      ],
      copSensorRadiusM: 5.0,
    });
    const entry = result.cop.get(uxo.id);
    expect(entry).toBeDefined();
    expect(entry!.reporters).not.toContain("alpha");
    expect(entry!.reporters.length).toBeGreaterThanOrEqual(2);
  });

  test("emitting contact reports leaves the COP empty when no items are configured", () => {
    const result = runSecureScenario({
      agents: fourPeers(),
      ticks: 3,
    });
    expect(result.cop.size).toBe(0);
    expect(result.contactLog).toHaveLength(0);
  });
});
