/**
 * Motion planners — Wave 2 of the Free Play Compose-then-Watch redesign.
 *
 * Each factory returns a `Planner` (see scenario.ts) that maps the current
 * agent set + tick context → per-agent velocity commands. Planners are
 * pure-functional given fixed config + RNG state; closure-held state (lawnmower
 * direction, randomWalk heading) is deterministic from initial conditions.
 *
 * Python parity: src/specter/sim/planners.py uses identical math and constants.
 */

import type { Planner } from "./scenario";
import type { Rng } from "./rng";
import type { VelocityCommand } from "./swarm";

// ---------------------------------------------------------------------------
// Lawnmower — agents sweep parallel stripes inside a rectangular field.
// Each agent is assigned a stripe index by its position in `agents` ordering;
// stripes are stacked along Y. Within a stripe the agent walks +X to xmax,
// flips, walks back to xmin, flips, repeat.
// ---------------------------------------------------------------------------

export type LawnmowerOpts = {
  bounds: { xmin: number; ymin: number; xmax: number; ymax: number };
  stripeM: number;
  speed: number;
};

export function lawnmower(opts: LawnmowerOpts): Planner {
  const { bounds, stripeM, speed } = opts;
  const dir = new Map<string, 1 | -1>();
  return (agents) => {
    const cmds: Record<string, VelocityCommand> = {};
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      if (a.phantom) continue;
      let d = dir.get(a.id);
      if (d === undefined) {
        // First tick: choose direction from agent's current x relative to bounds
        // — left half → +1 (sweep right), right half → -1.
        d = a.x <= (bounds.xmin + bounds.xmax) / 2 ? 1 : -1;
        dir.set(a.id, d);
      }
      // Flip direction at stripe ends.
      if (d === 1 && a.x >= bounds.xmax) {
        d = -1;
        dir.set(a.id, d);
      } else if (d === -1 && a.x <= bounds.xmin) {
        d = 1;
        dir.set(a.id, d);
      }
      // Stripe Y target: stripeIndex × stripeM offset from ymin.
      const stripeY = bounds.ymin + (i + 0.5) * stripeM;
      const clampedY = Math.min(stripeY, bounds.ymax);
      // Steer toward stripe Y with proportional gain (one-tick correction).
      const ey = clampedY - a.y;
      cmds[a.id] = { vx: d * speed, vy: ey, omega: 0 };
    }
    return cmds;
  };
}

// ---------------------------------------------------------------------------
// Orbit — agents trace a circle around `center` at `radius`, angular velocity
// `omegaRad` (rad/s, signed: + = CCW, - = CW). The next-step closed form is
// `desired = center + radius·(cos(θ+ωdt), sin(θ+ωdt))`; velocity = (desired -
// current) / dt. Self-corrects radial error in one tick.
// ---------------------------------------------------------------------------

export type OrbitOpts = {
  center: { x: number; y: number };
  radius: number;
  omegaRad: number;
};

export function orbit(opts: OrbitOpts): Planner {
  const { center, radius, omegaRad } = opts;
  return (agents, ctx) => {
    const cmds: Record<string, VelocityCommand> = {};
    for (const a of agents) {
      if (a.phantom) continue;
      const dx = a.x - center.x;
      const dy = a.y - center.y;
      const theta = Math.atan2(dy, dx);
      const nextTheta = theta + omegaRad * ctx.dt;
      const desiredX = center.x + radius * Math.cos(nextTheta);
      const desiredY = center.y + radius * Math.sin(nextTheta);
      cmds[a.id] = {
        vx: (desiredX - a.x) / ctx.dt,
        vy: (desiredY - a.y) / ctx.dt,
        omega: omegaRad,
      };
    }
    return cmds;
  };
}

// ---------------------------------------------------------------------------
// Rendezvous — agents converge to `target` at `speed`, then hold. An agent
// within one `speed·dt` step of the target commands zero velocity.
// ---------------------------------------------------------------------------

export type RendezvousOpts = {
  target: { x: number; y: number };
  speed: number;
};

export function rendezvous(opts: RendezvousOpts): Planner {
  const { target, speed } = opts;
  return (agents, ctx) => {
    const cmds: Record<string, VelocityCommand> = {};
    const stopThreshold = speed * ctx.dt;
    for (const a of agents) {
      if (a.phantom) continue;
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= stopThreshold) {
        cmds[a.id] = { vx: 0, vy: 0, omega: 0 };
      } else {
        cmds[a.id] = { vx: (dx / dist) * speed, vy: (dy / dist) * speed, omega: 0 };
      }
    }
    return cmds;
  };
}

// ---------------------------------------------------------------------------
// Random walk — each agent maintains a heading that diffuses by a Gaussian
// step every tick (turnSigma rad). Velocity = speed in the current heading.
// The RNG is consumed in agent order so trajectories are deterministic for a
// fixed `agents` ordering and RNG seed.
// ---------------------------------------------------------------------------

export type RandomWalkOpts = {
  rng: Rng;
  speed: number;
  turnSigma: number;
};

export function randomWalk(opts: RandomWalkOpts): Planner {
  const { rng, speed, turnSigma } = opts;
  const heading = new Map<string, number>();
  return (agents) => {
    const cmds: Record<string, VelocityCommand> = {};
    for (const a of agents) {
      if (a.phantom) continue;
      let h = heading.get(a.id);
      if (h === undefined) h = a.theta;
      h += rng.gauss(0, turnSigma);
      heading.set(a.id, h);
      cmds[a.id] = { vx: speed * Math.cos(h), vy: speed * Math.sin(h), omega: 0 };
    }
    return cmds;
  };
}

// ---------------------------------------------------------------------------
// Catalog — string-keyed factory used by simStore.flightPattern.
// ---------------------------------------------------------------------------

export type FlightPattern = "LAWNMOWER" | "ORBIT" | "RENDEZVOUS" | "RANDOM_WALK";

export type FlightPatternConfig =
  | ({ kind: "LAWNMOWER" } & LawnmowerOpts)
  | ({ kind: "ORBIT" } & OrbitOpts)
  | ({ kind: "RENDEZVOUS" } & RendezvousOpts)
  | ({ kind: "RANDOM_WALK" } & RandomWalkOpts);

export function makePlanner(config: FlightPatternConfig): Planner {
  switch (config.kind) {
    case "LAWNMOWER":
      return lawnmower(config);
    case "ORBIT":
      return orbit(config);
    case "RENDEZVOUS":
      return rendezvous(config);
    case "RANDOM_WALK":
      return randomWalk(config);
  }
}

// Convenience helper: derive a default config from a bounds rectangle so a
// caller (worker / lesson fixture / UI) only needs the pattern name.
export type DefaultPlannerOpts = {
  bounds: { xmin: number; ymin: number; xmax: number; ymax: number };
  agentCount: number;
  seed: number;
};

export function defaultPlannerFor(
  pattern: FlightPattern,
  opts: DefaultPlannerOpts,
): FlightPatternConfig {
  const { bounds } = opts;
  const cx = (bounds.xmin + bounds.xmax) / 2;
  const cy = (bounds.ymin + bounds.ymax) / 2;
  const width = bounds.xmax - bounds.xmin;
  const height = bounds.ymax - bounds.ymin;
  switch (pattern) {
    case "LAWNMOWER":
      return {
        kind: "LAWNMOWER",
        bounds,
        stripeM: height / Math.max(1, opts.agentCount),
        speed: 1.0,
      };
    case "ORBIT":
      return {
        kind: "ORBIT",
        center: { x: cx, y: cy },
        radius: Math.min(width, height) / 3,
        omegaRad: 0.3,
      };
    case "RENDEZVOUS":
      return { kind: "RENDEZVOUS", target: { x: cx, y: cy }, speed: 1.0 };
    case "RANDOM_WALK": {
      throw new Error("RANDOM_WALK default requires explicit rng; use makePlanner directly");
    }
  }
}
