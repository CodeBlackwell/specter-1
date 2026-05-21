import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { createAgent, stepAgent, snapshotAgent } from "../src/agent";
import { rangeBeaconsExact } from "../src/beacons";
import { Swarm } from "../src/swarm";
import { createRng } from "../src/rng";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  beacons_exact: Array<{ obs: [number, number, number]; peer: [number, number]; range_m: number; bearing_rad: number }>;
};

describe("agent", () => {
  it("step advances position and heading deterministically", () => {
    const a = createAgent({ id: "a0", x: 0, y: 0, theta: 0, vx: 1.0, vy: 0.5, omega: 0.1 });
    stepAgent(a, 0.5);
    expect(a.x).toBeCloseTo(0.5, 12);
    expect(a.y).toBeCloseTo(0.25, 12);
    expect(a.theta).toBeCloseTo(0.05, 12);
  });

  it("snapshot returns a detached copy", () => {
    const a = createAgent({ id: "a0", x: 1, y: 2, theta: 0.5 });
    const s = snapshotAgent(a);
    a.x = 99;
    expect(s.x).toBe(1);
  });
});

describe("beacons noise-free parity vs Python", () => {
  it.each(fixtures.beacons_exact)("obs=$obs peer=$peer", (vec) => {
    const obs = createAgent({ id: "o", x: vec.obs[0], y: vec.obs[1], theta: vec.obs[2] });
    const peer = createAgent({ id: "p", x: vec.peer[0], y: vec.peer[1] });
    const [out] = rangeBeaconsExact(obs, [peer], 0.0, 100);
    if (!out) throw new Error("expected one return");
    expect(out.range_m).toBeCloseTo(vec.range_m, 12);
    expect(out.bearing_rad).toBeCloseTo(vec.bearing_rad, 12);
  });

  it("returns empty when peer is out of range", () => {
    const obs = createAgent({ id: "o", x: 0, y: 0, theta: 0 });
    const peer = createAgent({ id: "p", x: 100, y: 100 });
    expect(rangeBeaconsExact(obs, [peer], 0.0, 8)).toEqual([]);
  });

  it("skips self", () => {
    const obs = createAgent({ id: "o", x: 0, y: 0, theta: 0 });
    expect(rangeBeaconsExact(obs, [obs], 0.0, 8)).toEqual([]);
  });
});

describe("swarm", () => {
  it("tick advances all agents and emits beacons", () => {
    const swarm = new Swarm(
      [
        createAgent({ id: "a", x: 0, y: 0, vx: 1 }),
        createAgent({ id: "b", x: 0, y: 1 }),
        createAgent({ id: "c", x: 5, y: 5 }),
      ],
      { dt: 0.1 },
    );
    const tick = swarm.tick();
    expect(tick.t).toBeCloseTo(0.1, 12);
    expect(swarm.agent("a")?.x).toBeCloseTo(0.1, 12);
    expect(tick.beacons["a"]?.length).toBeGreaterThan(0);
  });

  it("run is deterministic across two identical seeds", () => {
    const make = () =>
      new Swarm(
        [createAgent({ id: "a", x: 0, y: 0, vx: 1 }), createAgent({ id: "b", x: 0, y: 1 })],
        { dt: 0.1, seed: 42, noisy: true },
      );
    const a = make().run(20);
    const b = make().run(20);
    expect(a.map((t) => t.agents[0]?.x)).toEqual(b.map((t) => t.agents[0]?.x));
    expect(a.map((t) => t.beacons["a"]?.[0]?.range_m)).toEqual(
      b.map((t) => t.beacons["a"]?.[0]?.range_m),
    );
  });

  it("noisy run differs from exact run", () => {
    const exact = new Swarm(
      [createAgent({ id: "a", x: 0, y: 0 }), createAgent({ id: "b", x: 0, y: 1 })],
      { dt: 0.1 },
    );
    const noisy = new Swarm(
      [createAgent({ id: "a", x: 0, y: 0 }), createAgent({ id: "b", x: 0, y: 1 })],
      { dt: 0.1, seed: 7, noisy: true },
    );
    const exactTick = exact.tick();
    const noisyTick = noisy.tick();
    expect(exactTick.beacons["a"]?.[0]?.range_m).toBeCloseTo(1.0, 12);
    expect(noisyTick.beacons["a"]?.[0]?.range_m).not.toBeCloseTo(1.0, 6);
  });
});

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = createRng(99);
    const b = createRng(99);
    expect(a.next()).toBe(b.next());
    expect(a.gauss(0, 1)).toBe(b.gauss(0, 1));
  });
});
