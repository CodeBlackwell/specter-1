import { describe, it, expect } from "vitest";
import { createAgent } from "../src/agent";
import { rangeLie, type Attacker } from "../src/attacks";
import { runScenario } from "../src/scenario";

function square(n: number, radius: number): ReturnType<typeof createAgent>[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (2 * Math.PI * i) / n;
    return createAgent({
      id: `a${i}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      theta: angle + Math.PI / 2,
    });
  });
}

const BIAS = 4.0;

describe("per-attacker scheduling (Wave 1)", () => {
  it("an attacker only biases observations inside its [startTick, endTick) window", () => {
    const attacker: Attacker = {
      ...rangeLie("a0", BIAS),
      startTick: 5,
      endTick: 10,
    };
    const result = runScenario({
      agents: square(4, 2),
      ticks: 20,
      swarmOpts: { dt: 0.1 },
      attackers: [attacker],
    });
    const a0Obs = (tick1: number) =>
      result.snapshots[tick1 - 1]!.observations.filter((o) => o.observer_id === "a0");
    const offsetAt = (tick1: number) => {
      const before = result.snapshots[0]!.observations.filter((o) => o.observer_id === "a0");
      const now = a0Obs(tick1);
      // crude proxy: max range diff vs tick 1 (when attacker is dormant)
      const beforeMax = Math.max(...before.map((o) => o.range_m));
      const nowMax = Math.max(...now.map((o) => o.range_m));
      return nowMax - beforeMax;
    };
    // Tick 1 — attacker dormant, no offset
    expect(offsetAt(1)).toBeCloseTo(0, 6);
    // Tick 4 — still dormant
    expect(offsetAt(4)).toBeCloseTo(0, 6);
    // Tick 5 — first armed tick, expect ~BIAS lift on a0's observations
    expect(offsetAt(5)).toBeGreaterThan(BIAS - 0.5);
    // Tick 9 — still armed (endTick is exclusive)
    expect(offsetAt(9)).toBeGreaterThan(BIAS - 0.5);
    // Tick 10 — endTick reached, attacker dormant again
    expect(offsetAt(10)).toBeCloseTo(0, 6);
    // Tick 15 — long since disarmed
    expect(offsetAt(15)).toBeCloseTo(0, 6);
  });

  it("two attackers with non-overlapping windows fire independently", () => {
    const att1: Attacker = { ...rangeLie("a0", BIAS), startTick: 3, endTick: 6 };
    const att2: Attacker = { ...rangeLie("a1", BIAS), startTick: 8, endTick: 12 };
    const result = runScenario({
      agents: square(4, 2),
      ticks: 14,
      swarmOpts: { dt: 0.1 },
      attackers: [att1, att2],
    });
    const baselineA0 = Math.max(
      ...result.snapshots[0]!.observations
        .filter((o) => o.observer_id === "a0")
        .map((o) => o.range_m),
    );
    const baselineA1 = Math.max(
      ...result.snapshots[0]!.observations
        .filter((o) => o.observer_id === "a1")
        .map((o) => o.range_m),
    );
    function liftAt(tick1: number, agentId: string, baseline: number): number {
      const obs = result.snapshots[tick1 - 1]!.observations.filter(
        (o) => o.observer_id === agentId,
      );
      return Math.max(...obs.map((o) => o.range_m)) - baseline;
    }
    // Tick 4 — att1 active, att2 dormant
    expect(liftAt(4, "a0", baselineA0)).toBeGreaterThan(BIAS - 0.5);
    expect(liftAt(4, "a1", baselineA1)).toBeCloseTo(0, 6);
    // Tick 7 — both dormant (gap between windows)
    expect(liftAt(7, "a0", baselineA0)).toBeCloseTo(0, 6);
    expect(liftAt(7, "a1", baselineA1)).toBeCloseTo(0, 6);
    // Tick 9 — att2 active, att1 dormant
    expect(liftAt(9, "a0", baselineA0)).toBeCloseTo(0, 6);
    expect(liftAt(9, "a1", baselineA1)).toBeGreaterThan(BIAS - 0.5);
  });

  it("two attackers with overlapping windows can both fire on the overlap tick", () => {
    const att1: Attacker = { ...rangeLie("a0", BIAS), startTick: 3, endTick: 8 };
    const att2: Attacker = { ...rangeLie("a1", BIAS), startTick: 5, endTick: 10 };
    const result = runScenario({
      agents: square(4, 2),
      ticks: 12,
      swarmOpts: { dt: 0.1 },
      attackers: [att1, att2],
    });
    const baseline = (agentId: string): number =>
      Math.max(
        ...result.snapshots[0]!.observations
          .filter((o) => o.observer_id === agentId)
          .map((o) => o.range_m),
      );
    function liftAt(tick1: number, agentId: string): number {
      const obs = result.snapshots[tick1 - 1]!.observations.filter(
        (o) => o.observer_id === agentId,
      );
      return Math.max(...obs.map((o) => o.range_m)) - baseline(agentId);
    }
    // Tick 6 — both active
    expect(liftAt(6, "a0")).toBeGreaterThan(BIAS - 0.5);
    expect(liftAt(6, "a1")).toBeGreaterThan(BIAS - 0.5);
  });

  it("an attacker with no window uses the spec-level defaults (back-compat)", () => {
    // Existing fixtures pass attackers without startTick/endTick and rely on
    // spec.attackStartTick / spec.attackEndTick. Per-attacker windows default
    // from those — confirm the legacy semantics still hold.
    const result = runScenario({
      agents: square(4, 2),
      ticks: 12,
      swarmOpts: { dt: 0.1 },
      attackStartTick: 4,
      attackEndTick: 8,
      attackers: [rangeLie("a0", BIAS)],
    });
    const baselineA0 = Math.max(
      ...result.snapshots[0]!.observations
        .filter((o) => o.observer_id === "a0")
        .map((o) => o.range_m),
    );
    function lift(tick1: number): number {
      const obs = result.snapshots[tick1 - 1]!.observations.filter(
        (o) => o.observer_id === "a0",
      );
      return Math.max(...obs.map((o) => o.range_m)) - baselineA0;
    }
    expect(lift(3)).toBeCloseTo(0, 6); // before attackStartTick
    expect(lift(4)).toBeGreaterThan(BIAS - 0.5); // first armed tick
    expect(lift(7)).toBeGreaterThan(BIAS - 0.5); // still armed (endTick exclusive)
    expect(lift(8)).toBeCloseTo(0, 6); // attackEndTick reached
  });
});
