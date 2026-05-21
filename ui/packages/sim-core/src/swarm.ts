import { type Agent, snapshotAgent, stepAgent } from "./agent";
import { type BeaconOptions, type BeaconReturn, rangeBeacons, rangeBeaconsExact } from "./beacons";
import { createRng, type Rng } from "./rng";

export type Tick = {
  t: number;
  agents: ReadonlyArray<Agent>;
  beacons: Record<string, ReadonlyArray<BeaconReturn>>;
};

export type SwarmOptions = {
  seed?: number;
  dt?: number;
  noisy?: boolean;
  beaconOpts?: BeaconOptions;
};

export type VelocityCommand = { vx: number; vy: number; omega?: number };

export class Swarm {
  readonly dt: number;
  private readonly _noisy: boolean;
  private readonly _beaconOpts: BeaconOptions;
  private readonly _rng: Rng;
  private _agents: Agent[];
  t = 0;

  constructor(agents: ReadonlyArray<Agent>, opts: SwarmOptions = {}) {
    this.dt = opts.dt ?? 0.05;
    this._noisy = opts.noisy ?? false;
    this._beaconOpts = opts.beaconOpts ?? {};
    this._rng = createRng(opts.seed ?? 0);
    this._agents = agents.map(snapshotAgent);
  }

  get agents(): ReadonlyArray<Agent> {
    return this._agents;
  }

  agent(id: string): Agent | undefined {
    return this._agents.find((a) => a.id === id);
  }

  commandVelocities(cmds: Record<string, VelocityCommand>): void {
    for (const a of this._agents) {
      const c = cmds[a.id];
      if (!c) continue;
      a.vx = c.vx;
      a.vy = c.vy;
      if (c.omega !== undefined) a.omega = c.omega;
    }
  }

  tick(): Tick {
    this.t += this.dt;
    for (const a of this._agents) {
      if (a.phantom) continue;
      stepAgent(a, this.dt);
    }
    const realAgents = this._agents.filter((a) => !a.phantom);
    const beacons: Record<string, ReadonlyArray<BeaconReturn>> = {};
    for (const a of realAgents) {
      beacons[a.id] = this._noisy
        ? rangeBeacons(a, realAgents, this._rng, this.t, this._beaconOpts)
        : rangeBeaconsExact(a, realAgents, this.t, this._beaconOpts.maxRangeM);
    }
    return {
      t: this.t,
      agents: this._agents.map(snapshotAgent),
      beacons,
    };
  }

  run(steps: number): Tick[] {
    const out: Tick[] = [];
    for (let i = 0; i < steps; i++) out.push(this.tick());
    return out;
  }
}
