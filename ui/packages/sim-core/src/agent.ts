export type Agent = {
  id: string;
  x: number;
  y: number;
  theta: number;
  vx: number;
  vy: number;
  omega: number;
  phantom?: boolean;
};

export function createAgent(spec: Partial<Agent> & { id: string }): Agent {
  return {
    id: spec.id,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    theta: spec.theta ?? 0,
    vx: spec.vx ?? 0,
    vy: spec.vy ?? 0,
    omega: spec.omega ?? 0,
    phantom: spec.phantom ?? false,
  };
}

export function stepAgent(a: Agent, dt: number): void {
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.theta += a.omega * dt;
}

export function snapshotAgent(a: Agent): Agent {
  return { ...a };
}
