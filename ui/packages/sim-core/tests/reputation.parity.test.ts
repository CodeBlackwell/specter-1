import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { decay, newReputation, observe, score } from "../src/reputation";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  decay: Array<{
    elapsed_ns: number;
    half_life_ns: number;
    alpha_start: number;
    beta_start: number;
    alpha_after: number;
    beta_after: number;
    score_after: number;
  }>;
};

const EPS = 1e-12;

describe("reputation parity vs Python", () => {
  it.each(fixtures.decay)("decay matches Python at elapsed=$elapsed_ns ns", (vec) => {
    const rep = newReputation();
    rep.alpha = vec.alpha_start;
    rep.beta = vec.beta_start;
    rep.lastUpdateNs = 0n;
    decay(rep, BigInt(vec.elapsed_ns), BigInt(vec.half_life_ns));
    expect(rep.alpha).toBeCloseTo(vec.alpha_after, 12);
    expect(rep.beta).toBeCloseTo(vec.beta_after, 12);
    expect(score(rep)).toBeCloseTo(vec.score_after, 12);
  });

  it("score on prior is 0.5", () => {
    expect(score(newReputation())).toBeCloseTo(0.5, EPS);
  });

  it("observe applies alpha and beta with decay first", () => {
    const rep = newReputation();
    rep.alpha = 5.0;
    rep.beta = 2.0;
    rep.lastUpdateNs = 0n;
    observe(rep, { alpha: 1.0 }, 10_000_000_000n, 10_000_000_000n);
    expect(rep.alpha).toBeCloseTo(1.0 + (5.0 - 1.0) * 0.5 + 1.0, 12);
    expect(rep.beta).toBeCloseTo(1.0 + (2.0 - 1.0) * 0.5, 12);
  });
});
