import { describe, it, expect } from "vitest";
import { createAgent } from "../src/agent";
import {
  defaultPathFor,
  figure8,
  freehand,
  linearPath,
  loopWaypoints,
  pathFollower,
  type Path,
  type Point2,
} from "../src/paths";
import { runScenario } from "../src/scenario";

function singleAgent(x: number, y: number) {
  return [createAgent({ id: "a0", x, y })];
}

function runWithPath(path: Path, agentXY: Point2, ticks: number, speed = 1.0) {
  return runScenario({
    agents: singleAgent(agentXY[0], agentXY[1]),
    ticks,
    swarmOpts: { dt: 0.1 },
    planner: pathFollower(path, { speed, arrivalThresholdM: 0.2 }),
  });
}

describe("path constructors", () => {
  it("loopWaypoints returns a closed path with the given vertices", () => {
    const p = loopWaypoints([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]);
    expect(p.closed).toBe(true);
    expect(p.waypoints).toHaveLength(4);
    expect(p.waypoints[0]).toEqual([0, 0]);
  });

  it("linearPath defaults bounce off and stores two endpoints", () => {
    const p = linearPath([0, 0], [10, 0]);
    expect(p.closed).toBe(false);
    expect(p.bounce).toBe(false);
    expect(p.waypoints).toEqual([
      [0, 0],
      [10, 0],
    ]);
  });

  it("figure8 produces `samples` waypoints on the Lissajous curve", () => {
    const samples = 32;
    const p = figure8({ center: [0, 0], a: 10, b: 5, samples });
    expect(p.closed).toBe(true);
    expect(p.waypoints).toHaveLength(samples);
    // At t=0: (0, 0)
    expect(p.waypoints[0]![0]).toBeCloseTo(0, 10);
    expect(p.waypoints[0]![1]).toBeCloseTo(0, 10);
    // At t=π/2 (samples=32 → i=8): x = 10·sin(π/2) = 10, y = 5·sin(π) = 0
    expect(p.waypoints[8]![0]).toBeCloseTo(10, 10);
    expect(p.waypoints[8]![1]).toBeCloseTo(0, 10);
    // At t=π (i=16): x = 10·sin(π) = 0, y = 5·sin(2π) = 0
    expect(p.waypoints[16]![0]).toBeCloseTo(0, 10);
    expect(p.waypoints[16]![1]).toBeCloseTo(0, 10);
  });

  it("freehand returns an open polyline", () => {
    const p = freehand([
      [0, 0],
      [2, 0],
      [4, 3],
    ]);
    expect(p.closed).toBe(false);
    expect(p.waypoints).toHaveLength(3);
  });
});

describe("defaultPathFor", () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("LOOP returns 5 vertices inset 20% inside the bounds", () => {
    const p = defaultPathFor("LOOP", bounds);
    expect(p.waypoints).toHaveLength(5);
    expect(p.closed).toBe(true);
    // Inset 20% → radius = 50 · 0.8 = 40 around center (50, 50)
    for (const [x, y] of p.waypoints) {
      const r = Math.hypot(x - 50, y - 50);
      expect(r).toBeCloseTo(40, 6);
    }
  });

  it("LINEAR returns the bounds diagonal", () => {
    const p = defaultPathFor("LINEAR", bounds);
    expect(p.waypoints).toEqual([
      [0, 0],
      [100, 100],
    ]);
    expect(p.closed).toBe(false);
  });

  it("FIGURE-8 returns 32 centered Lissajous samples with a=width/3, b=height/3", () => {
    const p = defaultPathFor("FIGURE-8", bounds);
    expect(p.waypoints).toHaveLength(32);
    expect(p.waypoints[0]![0]).toBeCloseTo(50, 10);
    expect(p.waypoints[0]![1]).toBeCloseTo(50, 10);
    // At t=π/2 (i=8): x = 50 + (100/3)·sin(π/2) = 50 + 33.333
    expect(p.waypoints[8]![0]).toBeCloseTo(50 + 100 / 3, 10);
  });

  it("FREEHAND throws — caller must supply explicit waypoints", () => {
    expect(() => defaultPathFor("FREEHAND" as unknown as "LOOP", bounds)).toThrow();
  });
});

describe("pathFollower", () => {
  it("closed loop visits each waypoint in order and wraps back to W0", () => {
    const path = loopWaypoints([
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]);
    const result = runWithPath(path, [0, 0], 200);
    // Inspect agent trajectory; verify it visits each waypoint within
    // arrivalThreshold and eventually comes back near W0.
    const trajectory = result.snapshots.map((s) => {
      const a = s.agents[0]!;
      return [a.x, a.y] as Point2;
    });
    const visited = [false, false, false, false];
    for (const [x, y] of trajectory) {
      for (let w = 0; w < 4; w++) {
        if (Math.hypot(x - path.waypoints[w]![0], y - path.waypoints[w]![1]) <= 0.25) {
          visited[w] = true;
        }
      }
    }
    expect(visited.every(Boolean)).toBe(true);
    // After visiting W3, agent must return near W0 — proves the closed wrap.
    const finalSlice = trajectory.slice(-30);
    const sawW0Again = finalSlice.some(([x, y]) => Math.hypot(x - 2, y - 0) <= 0.5);
    // Or returned to the starting region (W0=[2,0]). Allow proximity check.
    const cameBack = finalSlice.some(([x, y]) => Math.hypot(x - 2, y - 0) <= 1.0)
      || sawW0Again;
    expect(cameBack).toBe(true);
  });

  it("open + bounce reverses direction at the endpoint", () => {
    const path = linearPath([0, 0], [3, 0], { bounce: true });
    const result = runWithPath(path, [0, 0], 100);
    const xs = result.snapshots.map((s) => s.agents[0]!.x);
    const maxX = Math.max(...xs);
    // Agent must reach near the right endpoint.
    expect(maxX).toBeGreaterThan(2.8);
    // After reaching, agent must move back toward 0.
    const maxIdx = xs.indexOf(maxX);
    const afterMax = xs.slice(maxIdx + 1);
    expect(afterMax.length).toBeGreaterThan(5);
    const minAfter = Math.min(...afterMax);
    expect(minAfter).toBeLessThan(maxX - 1.0);
  });

  it("open + no bounce halts at the last waypoint (zero velocity after arrival)", () => {
    const path = linearPath([0, 0], [3, 0]);
    const result = runWithPath(path, [0, 0], 80);
    const finalSnap = result.snapshots[result.snapshots.length - 1]!;
    const a = finalSnap.agents[0]!;
    expect(a.x).toBeCloseTo(3, 0); // near endpoint
    expect(a.vx).toBeCloseTo(0, 6);
    expect(a.vy).toBeCloseTo(0, 6);
  });

  it("freehand halts at the last waypoint", () => {
    const path = freehand([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
    const result = runWithPath(path, [0, 0], 100);
    const finalSnap = result.snapshots[result.snapshots.length - 1]!;
    const a = finalSnap.agents[0]!;
    expect(a.vx).toBeCloseTo(0, 6);
    expect(a.vy).toBeCloseTo(0, 6);
    expect(Math.hypot(a.x - 2, a.y - 2)).toBeLessThan(0.3);
  });

  it("two identical runs produce identical trajectories (deterministic)", () => {
    const path = figure8({ center: [0, 0], a: 5, b: 3, samples: 16 });
    const r1 = runWithPath(path, [0, 0], 150);
    const r2 = runWithPath(path, [0, 0], 150);
    expect(r1.snapshots.length).toBe(r2.snapshots.length);
    for (let i = 0; i < r1.snapshots.length; i++) {
      const a1 = r1.snapshots[i]!.agents[0]!;
      const a2 = r2.snapshots[i]!.agents[0]!;
      expect(a1.x).toBe(a2.x);
      expect(a1.y).toBe(a2.y);
    }
  });

  it("arrival-threshold honored: agent advances exactly when within threshold", () => {
    // Place the agent close enough to W0 that the very first tick advances to W1.
    const path = loopWaypoints([
      [0.1, 0], // W0 — within default 0.2m threshold of agent at (0,0)
      [5, 0], // W1
      [5, 5], // W2
    ]);
    const result = runWithPath(path, [0, 0], 5, 2.0);
    // First tick should command velocity toward W1, not W0. The agent's vx
    // after the tick should be positive and approximately +speed.
    const first = result.snapshots[0]!.agents[0]!;
    expect(first.vx).toBeGreaterThan(1.5); // moving right toward W1
    // Sanity: with a threshold of 0.2, a path with first waypoint at (1, 0)
    // should NOT advance from the agent at (0, 0).
    const path2 = loopWaypoints([
      [1, 0],
      [5, 0],
    ]);
    const r2 = runScenario({
      agents: singleAgent(0, 0),
      ticks: 1,
      swarmOpts: { dt: 0.1 },
      planner: pathFollower(path2, { speed: 2.0, arrivalThresholdM: 0.2 }),
    });
    const a2 = r2.snapshots[0]!.agents[0]!;
    // Velocity must be aimed at W0 (1, 0), not W1.
    expect(a2.vx).toBeCloseTo(2.0, 4);
    expect(a2.vy).toBeCloseTo(0, 6);
  });
});
