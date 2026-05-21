import { describe, it, expect } from "vitest";
import { createAgent } from "../src/agent";
import { Swarm } from "../src/swarm";
import { createRng } from "../src/rng";
import {
  lawnmower,
  orbit,
  rendezvous,
  randomWalk,
} from "../src/planners";

const DT = 0.1;

function runWithPlanner(agents: ReturnType<typeof createAgent>[], planner: ReturnType<typeof lawnmower>, ticks: number) {
  const swarm = new Swarm(agents, { dt: DT });
  const trajectory: Array<{ tick: number; agents: { id: string; x: number; y: number }[] }> = [];
  for (let i = 0; i < ticks; i++) {
    const cmds = planner(swarm.agents, { tick: i, t: swarm.t, dt: DT, requestHalt: () => {} });
    if (cmds) swarm.commandVelocities(cmds);
    swarm.tick();
    trajectory.push({
      tick: i + 1,
      agents: swarm.agents.map((a) => ({ id: a.id, x: a.x, y: a.y })),
    });
  }
  return trajectory;
}

function row(n: number): ReturnType<typeof createAgent>[] {
  return Array.from({ length: n }, (_, i) => createAgent({ id: `a${i}`, x: 0, y: i }));
}

describe("lawnmower planner", () => {
  it("each agent walks +X then flips at xmax (back-and-forth across the stripe)", () => {
    const agents = row(2); // a0 at (0,0), a1 at (0,1)
    const trail = runWithPlanner(
      agents,
      lawnmower({
        bounds: { xmin: 0, ymin: 0, xmax: 5, ymax: 4 },
        stripeM: 2,
        speed: 1,
      }),
      80,
    );
    const a0Path = trail.map((t) => t.agents[0]!.x);
    // Initial dir is +1 (a0.x=0 < midpoint 2.5). a0 should reach xmax≈5 around tick 50.
    expect(Math.max(...a0Path)).toBeGreaterThan(4.9);
    expect(Math.max(...a0Path)).toBeLessThanOrEqual(5.1);
    // After reaching xmax it flips and walks back; some later tick must have x decreasing.
    const peakIdx = a0Path.indexOf(Math.max(...a0Path));
    expect(a0Path[peakIdx + 5]!).toBeLessThan(a0Path[peakIdx]!);
  });

  it("each agent steers toward its own stripe (Y separation maintained)", () => {
    const agents = row(3);
    const trail = runWithPlanner(
      agents,
      lawnmower({
        bounds: { xmin: 0, ymin: 0, xmax: 5, ymax: 6 },
        stripeM: 2,
        speed: 1,
      }),
      30,
    );
    const finalAgents = trail[trail.length - 1]!.agents;
    // Stripes targeted at y = 1, 3, 5 — final ys should be in that order.
    expect(finalAgents[0]!.y).toBeLessThan(finalAgents[1]!.y);
    expect(finalAgents[1]!.y).toBeLessThan(finalAgents[2]!.y);
  });
});

describe("orbit planner", () => {
  it("agents settle onto the requested radius around the center after one tick", () => {
    const agents = [createAgent({ id: "a0", x: 2, y: 0 })];
    const trail = runWithPlanner(
      agents,
      orbit({ center: { x: 0, y: 0 }, radius: 1, omegaRad: Math.PI / 8 }),
      40,
    );
    // The radial-correction term lands the agent on the ring in one tick.
    for (let i = 1; i < trail.length; i++) {
      const p = trail[i]!.agents[0]!;
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeCloseTo(1, 8);
    }
  });

  it("CCW omegaRad sweeps the angle in the positive direction", () => {
    const agents = [createAgent({ id: "a0", x: 1, y: 0 })];
    const trail = runWithPlanner(
      agents,
      orbit({ center: { x: 0, y: 0 }, radius: 1, omegaRad: Math.PI / 4 }),
      4,
    );
    // After 4 ticks at dt=0.1, total angle Δ = π/4 × 0.4 = π/10 ≈ 18°
    const p = trail[trail.length - 1]!.agents[0]!;
    const theta = Math.atan2(p.y, p.x);
    expect(theta).toBeCloseTo(Math.PI / 10, 8);
  });
});

describe("rendezvous planner", () => {
  it("agents converge to the target and hold", () => {
    const agents = [
      createAgent({ id: "a0", x: -5, y: 0 }),
      createAgent({ id: "a1", x: 0, y: 5 }),
    ];
    const trail = runWithPlanner(
      agents,
      rendezvous({ target: { x: 0, y: 0 }, speed: 1 }),
      120,
    );
    // After enough time both agents should be near the target and not moving.
    const finalAgents = trail[trail.length - 1]!.agents;
    for (const a of finalAgents) {
      expect(Math.hypot(a.x, a.y)).toBeLessThanOrEqual(0.15);
    }
    // Hold property: positions at tick 100 ≈ positions at tick 120.
    const tick100 = trail[99]!.agents;
    for (let i = 0; i < finalAgents.length; i++) {
      expect(finalAgents[i]!.x).toBeCloseTo(tick100[i]!.x, 4);
      expect(finalAgents[i]!.y).toBeCloseTo(tick100[i]!.y, 4);
    }
  });
});

describe("random walk planner", () => {
  it("is deterministic for a fixed seed (same trajectory on re-run)", () => {
    const agents = () => [
      createAgent({ id: "a0", x: 0, y: 0, theta: 0 }),
      createAgent({ id: "a1", x: 0, y: 0, theta: Math.PI }),
    ];
    const trailA = runWithPlanner(
      agents(),
      randomWalk({ rng: createRng(7), speed: 1, turnSigma: 0.1 }),
      50,
    );
    const trailB = runWithPlanner(
      agents(),
      randomWalk({ rng: createRng(7), speed: 1, turnSigma: 0.1 }),
      50,
    );
    for (let t = 0; t < trailA.length; t++) {
      for (let i = 0; i < trailA[t]!.agents.length; i++) {
        expect(trailA[t]!.agents[i]!.x).toBeCloseTo(trailB[t]!.agents[i]!.x, 12);
        expect(trailA[t]!.agents[i]!.y).toBeCloseTo(trailB[t]!.agents[i]!.y, 12);
      }
    }
  });

  it("speed magnitude is preserved each tick (constant cruise speed)", () => {
    const agents = [createAgent({ id: "a0", x: 0, y: 0 })];
    const planner = randomWalk({ rng: createRng(7), speed: 2, turnSigma: 0.2 });
    const swarm = new Swarm(agents, { dt: DT });
    for (let i = 0; i < 30; i++) {
      const cmds = planner(swarm.agents, { tick: i, t: swarm.t, dt: DT, requestHalt: () => {} });
      if (cmds) swarm.commandVelocities(cmds);
      const a = swarm.agents[0]!;
      expect(Math.hypot(a.vx, a.vy)).toBeCloseTo(2, 8);
      swarm.tick();
    }
  });
});
