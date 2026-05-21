import { type Agent, createAgent } from "@specter/sim-core";

export const DRONE_COUNT = 8;
export const DRONE_SPEED_MS = 6;
export const LAUNCH_POINT = { x: 11, y: 11 };
export const LAUNCH_STAGGER_TICKS = 4;
export const LAUNCH_PAD_RADIUS = 2.5;

export type DroneSwarmConfig = {
  agents: Agent[];
  launchTicks: Record<string, number>;
  homeSlots: Record<string, { x: number; y: number }>;
};

export function droneSwarm(): DroneSwarmConfig {
  const agents: Agent[] = [];
  const launchTicks: Record<string, number> = {};
  const homeSlots: Record<string, { x: number; y: number }> = {};
  for (let i = 0; i < DRONE_COUNT; i++) {
    const angle = (i / DRONE_COUNT) * Math.PI * 2;
    const x = LAUNCH_POINT.x + Math.cos(angle) * LAUNCH_PAD_RADIUS;
    const y = LAUNCH_POINT.y + Math.sin(angle) * LAUNCH_PAD_RADIUS;
    const id = `A${i}`;
    agents.push(createAgent({ id, x, y, theta: 0 }));
    launchTicks[id] = i * LAUNCH_STAGGER_TICKS;
    homeSlots[id] = { x, y };
  }
  return { agents, launchTicks, homeSlots };
}
