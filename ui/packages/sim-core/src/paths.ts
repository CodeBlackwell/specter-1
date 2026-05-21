/**
 * Wave 3 — Path / waypoint geometry for Free Play.
 *
 * Paths sit *under* flight patterns: a `Path` is an ordered sequence of
 * waypoints with a `closed` flag (wrap to W0 at the last waypoint) and an
 * optional `bounce` flag (reverse direction at endpoints, only meaningful on
 * open paths). `pathFollower(path, opts)` returns a sim-core `Planner` that
 * commands per-agent velocity toward the current waypoint and advances when
 * within `arrivalThresholdM`.
 *
 * Math constants here must stay byte-equivalent to `src/specter/sim/paths.py`
 * — the Wave 5 Composer reads `defaultPathFor(preset, bounds)` from both
 * languages and the lessons need identical trajectories.
 */
import type { Agent } from "./agent";
import type { Planner } from "./scenario";
import type { VelocityCommand } from "./swarm";

export type Point2 = readonly [number, number];

export type Path = {
  waypoints: ReadonlyArray<Point2>;
  closed: boolean;
  bounce?: boolean;
};

export type PathPreset = "LOOP" | "LINEAR" | "FIGURE-8";

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const DEFAULT_ARRIVAL_M = 0.2;
const FIGURE8_DEFAULT_SAMPLES = 32;
const LOOP_INSET_FRACTION = 0.2;

/** Closed loop through the given waypoints. */
export function loopWaypoints(points: ReadonlyArray<Point2>): Path {
  return { waypoints: points.map((p) => [p[0], p[1]] as const), closed: true };
}

/** Open path from `start` to `end`. With `bounce: true`, the follower reverses
 * direction when it reaches either endpoint. */
export function linearPath(
  start: Point2,
  end: Point2,
  opts?: { bounce?: boolean },
): Path {
  return {
    waypoints: [
      [start[0], start[1]],
      [end[0], end[1]],
    ],
    closed: false,
    bounce: opts?.bounce ?? false,
  };
}

/** Lissajous figure-8: `x = cx + a·sin(t)`, `y = cy + b·sin(2t)`, t evenly
 * spaced over [0, 2π) at `samples` points. Closed. */
export function figure8(spec: {
  center: Point2;
  a: number;
  b: number;
  samples?: number;
}): Path {
  const samples = spec.samples ?? FIGURE8_DEFAULT_SAMPLES;
  const [cx, cy] = spec.center;
  const waypoints: Point2[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (2 * Math.PI * i) / samples;
    waypoints.push([cx + spec.a * Math.sin(t), cy + spec.b * Math.sin(2 * t)]);
  }
  return { waypoints, closed: true };
}

/** Open polyline. The follower halts (zero velocity) at the last waypoint. */
export function freehand(points: ReadonlyArray<Point2>): Path {
  return { waypoints: points.map((p) => [p[0], p[1]] as const), closed: false };
}

/** Built-in preset path geometry derived from world bounds.
 *  - LOOP: inset regular pentagon (5 vertices, 20% inset)
 *  - LINEAR: bounds.min → bounds.max diagonal
 *  - FIGURE-8: centered Lissajous, a = width/3, b = height/3, 32 samples
 * FREEHAND throws — caller must supply explicit waypoints. */
export function defaultPathFor(preset: PathPreset, bounds: Bounds): Path {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  if (preset === "LOOP") {
    const rx = (width / 2) * (1 - LOOP_INSET_FRACTION);
    const ry = (height / 2) * (1 - LOOP_INSET_FRACTION);
    const waypoints: Point2[] = [];
    for (let i = 0; i < 5; i++) {
      // Pentagon vertex i: start at top (theta = -π/2) and go CCW.
      const theta = -Math.PI / 2 + (2 * Math.PI * i) / 5;
      waypoints.push([cx + rx * Math.cos(theta), cy + ry * Math.sin(theta)]);
    }
    return { waypoints, closed: true };
  }
  if (preset === "LINEAR") {
    return linearPath([bounds.minX, bounds.minY], [bounds.maxX, bounds.maxY]);
  }
  if (preset === "FIGURE-8") {
    return figure8({
      center: [cx, cy],
      a: width / 3,
      b: height / 3,
      samples: FIGURE8_DEFAULT_SAMPLES,
    });
  }
  throw new Error(`defaultPathFor: preset "${preset}" has no default geometry — supply explicit waypoints`);
}

type FollowerState = { idx: number; direction: 1 | -1 };

/** Per-agent path-follower Planner.
 *  - Closed paths wrap idx → 0 after the last waypoint.
 *  - Open + bounce reverses direction at endpoints.
 *  - Open without bounce commands zero velocity once the last waypoint is
 *    reached (so the agent stops cleanly instead of overshooting). */
export function pathFollower(
  path: Path,
  opts: { speed: number; arrivalThresholdM?: number },
): Planner {
  const speed = opts.speed;
  const arrival = opts.arrivalThresholdM ?? DEFAULT_ARRIVAL_M;
  const state = new Map<string, FollowerState>();
  const waypoints = path.waypoints;
  const last = waypoints.length - 1;

  const advance = (s: FollowerState): void => {
    if (path.closed) {
      s.idx = (s.idx + 1) % waypoints.length;
      return;
    }
    if (path.bounce) {
      const next = s.idx + s.direction;
      if (next < 0 || next > last) {
        s.direction = (s.direction === 1 ? -1 : 1) as 1 | -1;
        s.idx = s.idx + s.direction;
      } else {
        s.idx = next;
      }
      return;
    }
    if (s.idx < last) s.idx += 1;
  };

  return (agents: ReadonlyArray<Agent>): Record<string, VelocityCommand> => {
    const cmds: Record<string, VelocityCommand> = {};
    if (waypoints.length === 0) return cmds;
    for (const a of agents) {
      if (a.phantom) continue;
      let s = state.get(a.id);
      if (!s) {
        s = { idx: 0, direction: 1 };
        state.set(a.id, s);
      }
      const target = waypoints[s.idx]!;
      const dx = target[0] - a.x;
      const dy = target[1] - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= arrival) {
        const halted = !path.closed && !path.bounce && s.idx === last;
        advance(s);
        if (halted) {
          cmds[a.id] = { vx: 0, vy: 0 };
          continue;
        }
        const next = waypoints[s.idx]!;
        const ndx = next[0] - a.x;
        const ndy = next[1] - a.y;
        const ndist = Math.hypot(ndx, ndy);
        if (ndist === 0) {
          cmds[a.id] = { vx: 0, vy: 0 };
        } else {
          cmds[a.id] = { vx: (ndx / ndist) * speed, vy: (ndy / ndist) * speed };
        }
        continue;
      }
      cmds[a.id] = { vx: (dx / dist) * speed, vy: (dy / dist) * speed };
    }
    return cmds;
  };
}
