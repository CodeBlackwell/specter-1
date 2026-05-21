import type { Planner, VelocityCommand } from "@specter/sim-core";
import { type CoverageGrid, markCovered } from "./coverage";

export type Waypoint = { x: number; y: number };

export type WheelPlannerOpts = {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  sensorRadius: number;
  speedMs: number;
  reachTolerance: number;
  wheelRadius?: number;
  wheelTranslationSpeed?: number;
  wheelSpinRadPerSec?: number;
  launchTicks?: Record<string, number>;
  homeSlots?: Record<string, { x: number; y: number }>;
};

const DEFAULT_WHEEL_RADIUS = 25;
const DEFAULT_TRANSLATION_SPEED = 3;
const DEFAULT_SPIN_RATE = 0.1;
const FORMATION_TOLERANCE = 4;
const HOME_TOLERANCE = 0.5;
const HALT_HOLD_TICKS = 20;

type Phase = "form_up" | "sweep" | "rtb";

export function wheelPlanner(grid: CoverageGrid, opts: WheelPlannerOpts): Planner {
  const wheelRadius = opts.wheelRadius ?? DEFAULT_WHEEL_RADIUS;
  const translationSpeed = opts.wheelTranslationSpeed ?? DEFAULT_TRANSLATION_SPEED;
  const spinRate = opts.wheelSpinRadPerSec ?? DEFAULT_SPIN_RATE;
  const launchTicks = opts.launchTicks ?? {};
  const homeSlots = opts.homeSlots ?? {};
  const isLaunched = (id: string, tick: number): boolean => tick >= (launchTicks[id] ?? 0);

  const { minX, maxX, minY, maxY } = opts.bounds;
  const innerMinX = minX + wheelRadius;
  const innerMaxX = maxX - wheelRadius;
  const innerMinY = minY + wheelRadius;
  const innerMaxY = maxY - wheelRadius;

  const centerPath: Waypoint[] = [
    { x: innerMinX, y: innerMinY },
    { x: innerMaxX, y: innerMinY },
    { x: innerMaxX, y: innerMaxY },
    { x: innerMinX, y: innerMaxY },
  ];

  const wheelCenter: Waypoint = { x: centerPath[0]!.x, y: centerPath[0]!.y };
  let centerIdx = 0;
  let phase: Phase = "form_up";
  let initialized = false;
  let allHomeSinceTick: number | null = null;
  const angleByDrone = new Map<string, number>();
  const droneOrder: string[] = [];

  function setupAngles(realIds: string[]): void {
    const sorted = [...realIds].sort();
    droneOrder.length = 0;
    for (let i = 0; i < sorted.length; i++) {
      const id = sorted[i]!;
      angleByDrone.set(id, (i / sorted.length) * Math.PI * 2);
      droneOrder.push(id);
    }
  }

  function rimPosition(id: string, t: number): Waypoint {
    const base = angleByDrone.get(id) ?? 0;
    const angle = base + spinRate * t;
    return {
      x: wheelCenter.x + wheelRadius * Math.cos(angle),
      y: wheelCenter.y + wheelRadius * Math.sin(angle),
    };
  }

  function advanceWheelCenter(dt: number): void {
    if (centerIdx >= centerPath.length) return;
    const target = centerPath[centerIdx]!;
    const dx = target.x - wheelCenter.x;
    const dy = target.y - wheelCenter.y;
    const d = Math.hypot(dx, dy);
    const step = translationSpeed * dt;
    if (d <= step) {
      wheelCenter.x = target.x;
      wheelCenter.y = target.y;
      centerIdx++;
    } else {
      wheelCenter.x += (dx / d) * step;
      wheelCenter.y += (dy / d) * step;
    }
  }

  return (agents, ctx) => {
    if (!initialized) {
      setupAngles(agents.filter((a) => !a.phantom).map((a) => a.id));
      initialized = true;
    }

    for (const a of agents) {
      if (a.phantom) continue;
      if (!isLaunched(a.id, ctx.tick)) continue;
      markCovered(grid, a.x, a.y, opts.sensorRadius, ctx.tick);
    }

    if (phase !== "rtb") {
      let allLaunched = true;
      let allInFormation = true;
      for (const id of droneOrder) {
        if (!isLaunched(id, ctx.tick)) {
          allLaunched = false;
          break;
        }
      }
      if (allLaunched) {
        const agentById = new Map(agents.map((a) => [a.id, a] as const));
        for (const id of droneOrder) {
          const a = agentById.get(id);
          if (!a) continue;
          const rim = rimPosition(id, ctx.t);
          if (Math.hypot(rim.x - a.x, rim.y - a.y) > FORMATION_TOLERANCE) {
            allInFormation = false;
            break;
          }
        }
        if (phase === "form_up" && allInFormation) {
          phase = "sweep";
        }
        if (phase === "sweep" && allInFormation) {
          if (centerIdx >= centerPath.length) {
            phase = "rtb";
          } else {
            advanceWheelCenter(ctx.dt);
          }
        }
      }
    }

    const cmds: Record<string, VelocityCommand> = {};
    for (const a of agents) {
      if (a.phantom) continue;
      if (!isLaunched(a.id, ctx.tick)) {
        cmds[a.id] = { vx: 0, vy: 0, omega: 0 };
        continue;
      }
      const target =
        phase === "rtb"
          ? homeSlots[a.id] ?? rimPosition(a.id, ctx.t)
          : rimPosition(a.id, ctx.t);
      const dx = target.x - a.x;
      const dy = target.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.001) {
        cmds[a.id] = { vx: 0, vy: 0, omega: 0 };
        continue;
      }
      const s = Math.min(opts.speedMs, d / Math.max(ctx.dt, 0.0001));
      cmds[a.id] = { vx: (dx / d) * s, vy: (dy / d) * s, omega: 0 };
    }
    if (phase === "rtb") {
      let allHome = true;
      const agentById = new Map(agents.map((a) => [a.id, a] as const));
      for (const id of droneOrder) {
        const a = agentById.get(id);
        const home = homeSlots[id];
        if (!a || !home || Math.hypot(home.x - a.x, home.y - a.y) > HOME_TOLERANCE) {
          allHome = false;
          break;
        }
      }
      if (allHome) {
        if (allHomeSinceTick === null) allHomeSinceTick = ctx.tick;
        else if (ctx.tick - allHomeSinceTick >= HALT_HOLD_TICKS) ctx.requestHalt();
      } else {
        allHomeSinceTick = null;
      }
    }
    return cmds;
  };
}
