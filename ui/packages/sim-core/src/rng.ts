export type Rng = {
  next(): number;
  gauss(mean: number, stddev: number): number;
};

export function createRng(seed: number): Rng {
  let state = (seed >>> 0) || 1;
  let spare: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };

  const gauss = (mean: number, stddev: number): number => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return mean + stddev * v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2.0 * Math.PI * v);
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mean + stddev * z0;
  };

  return { next, gauss };
}
