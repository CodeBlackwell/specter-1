/**
 * Per-scenario parity gate (SYSTEM_ASSESSMENT.md §9 rec 5 + ADR 0014 audit
 * surface). Asserts that the TS adversarial battery produces the same
 * outcomes as the Python eval harness on deterministic envelope-attack
 * scenarios: integer-exact reject counts by category, reputation curves
 * to 6 decimals, and exact-float COP filter results.
 *
 * Regenerate the fixture with:
 *   uv run python ui/packages/sim-core/tests/fixtures/_generate_scenarios.py
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { generateKeypair } from "../src/crypto";
import {
  buildCop,
  encodeContactReport,
  encodePoseReport,
  KIND_CONTACT_REPORT,
  KIND_POSE,
  REPLAY_REPETITIONS,
  envelopeFromWire,
  envelopeToWire,
  seal,
  tryOpen,
  BetaTrustEvaluator,
  type ContactReport,
  type Identity,
  type Roster,
  type ReplayWindow,
} from "../src";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "fixtures/scenarios.parity.json");

type TickResult = {
  accepts: number;
  rejects: number;
  rejects_by_category: Record<string, number>;
  reputations: Record<string, number>;
};

type ScenarioFixture = {
  name: string;
  n_peers?: number;
  ticks?: TickResult[];
  final_reputations?: Record<string, number>;
  swap_key_tick?: number;
  replay_start_tick?: number;
  replay_repetitions?: number;
  foreign_emitter?: string;
  // COP fixture fields
  real_item?: { id: string; kind: string; x: number; y: number };
  phantom_item?: { id: string; kind: string; x: number; y: number };
  peers?: string[];
  case_high_rep?: { reputations: Record<string, number>; cop: Record<string, CopFixtureEntry> };
  case_low_rep?: { reputations: Record<string, number>; cop: Record<string, CopFixtureEntry> };
};

type CopFixtureEntry = {
  contact_id: string;
  kind: string;
  x: number;
  y: number;
  weight: number;
  reporters: string[];
};

type FixtureFile = {
  version: number;
  format: string;
  note: string;
  scenarios: Record<string, ScenarioFixture>;
};

const FIXTURE: FixtureFile = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

function makeWorld(nPeers: number): {
  agentIds: string[];
  identities: Map<string, Identity>;
  roster: Roster;
  replay: ReplayWindow;
  evaluator: BetaTrustEvaluator;
} {
  const agentIds = Array.from({ length: nPeers }, (_, i) => `a${i}`);
  const identities = new Map<string, Identity>();
  const roster: Roster = new Map();
  for (const aid of agentIds) {
    const kp = generateKeypair();
    identities.set(aid, { agentId: aid, privateKey: kp.privateKey, nonce: 0n });
    roster.set(aid, kp.publicKey);
  }
  return { agentIds, identities, roster, replay: new Map(), evaluator: new BetaTrustEvaluator() };
}

function encodePoseLike(aid: string, ts: bigint): Uint8Array {
  return encodePoseReport({ agent_id: aid, x: 0.0, y: 0.0, theta: 0.0, timestamp_ns: ts });
}

function tryOpenAndAccount(
  env: ReturnType<typeof seal>,
  roster: Roster,
  replay: ReplayWindow,
  evaluator: BetaTrustEvaluator,
): { ok: boolean; category?: string } {
  const result = tryOpen(env, roster, replay);
  if (result.ok) {
    evaluator.recordAccept(env.senderId, env.timestampNs);
    return { ok: true };
  }
  evaluator.recordReject(env.senderId, env.timestampNs, env.nonce, result.category, result.message);
  return { ok: false, category: result.category };
}

function runHonestBaseline(nPeers: number, nTicks: number): TickResult[] {
  const { agentIds, identities, roster, replay, evaluator } = makeWorld(nPeers);
  const results: TickResult[] = [];
  for (let t = 1; t <= nTicks; t++) {
    const ts = BigInt(t * 1_000_000_000);
    let accepts = 0;
    let rejects = 0;
    const rbc: Record<string, number> = {};
    for (const aid of agentIds) {
      const env = seal(identities.get(aid)!, KIND_POSE, encodePoseLike(aid, ts), ts);
      const r = tryOpenAndAccount(env, roster, replay, evaluator);
      if (r.ok) accepts++;
      else {
        rejects++;
        rbc[r.category!] = (rbc[r.category!] ?? 0) + 1;
      }
    }
    const reputations: Record<string, number> = {};
    for (const a of agentIds) reputations[a] = round6(evaluator.reputation(a));
    results.push({ accepts, rejects, rejects_by_category: rbc, reputations });
  }
  return results;
}

function runSwapKeyScenario(nPeers: number, nTicks: number, swapAt: number): TickResult[] {
  const { agentIds, identities, roster, replay, evaluator } = makeWorld(nPeers);
  const results: TickResult[] = [];
  for (let t = 1; t <= nTicks; t++) {
    const ts = BigInt(t * 1_000_000_000);
    if (t === swapAt) {
      const kp = generateKeypair();
      const ident = identities.get("a0")!;
      ident.privateKey = kp.privateKey;
      // roster NOT updated
    }
    let accepts = 0;
    let rejects = 0;
    const rbc: Record<string, number> = {};
    for (const aid of agentIds) {
      const env = seal(identities.get(aid)!, KIND_POSE, encodePoseLike(aid, ts), ts);
      const r = tryOpenAndAccount(env, roster, replay, evaluator);
      if (r.ok) accepts++;
      else {
        rejects++;
        rbc[r.category!] = (rbc[r.category!] ?? 0) + 1;
      }
    }
    const reputations: Record<string, number> = {};
    for (const a of agentIds) reputations[a] = round6(evaluator.reputation(a));
    results.push({ accepts, rejects, rejects_by_category: rbc, reputations });
  }
  return results;
}

function runReplayStormScenario(nPeers: number, nTicks: number, replayStart: number): TickResult[] {
  const { agentIds, identities, roster, replay, evaluator } = makeWorld(nPeers);
  const results: TickResult[] = [];
  let capturedWire: Uint8Array | null = null;
  for (let t = 1; t <= nTicks; t++) {
    const ts = BigInt(t * 1_000_000_000);
    let accepts = 0;
    let rejects = 0;
    const rbc: Record<string, number> = {};
    for (const aid of agentIds) {
      const env = seal(identities.get(aid)!, KIND_POSE, encodePoseLike(aid, ts), ts);
      if (aid === "a0" && !capturedWire) capturedWire = envelopeToWire(env);
      const r = tryOpenAndAccount(env, roster, replay, evaluator);
      if (r.ok) accepts++;
      else {
        rejects++;
        rbc[r.category!] = (rbc[r.category!] ?? 0) + 1;
      }
    }
    if (t >= replayStart && capturedWire) {
      for (let i = 0; i < REPLAY_REPETITIONS; i++) {
        const env = envelopeFromWire(capturedWire);
        const r = tryOpenAndAccount(env, roster, replay, evaluator);
        if (r.ok) accepts++;
        else {
          rejects++;
          rbc[r.category!] = (rbc[r.category!] ?? 0) + 1;
        }
      }
    }
    const reputations: Record<string, number> = {};
    for (const a of agentIds) reputations[a] = round6(evaluator.reputation(a));
    results.push({ accepts, rejects, rejects_by_category: rbc, reputations });
  }
  return results;
}

function runForgedEmitterScenario(nPeers: number, nTicks: number): {
  ticks: TickResult[];
  intruderRep: number;
} {
  const { agentIds, identities, roster, replay, evaluator } = makeWorld(nPeers);
  // Build an intruder identity NOT in the roster.
  const intrKp = generateKeypair();
  const intruder: Identity = {
    agentId: "intruder",
    privateKey: intrKp.privateKey,
    nonce: 0n,
  };
  const results: TickResult[] = [];
  for (let t = 1; t <= nTicks; t++) {
    const ts = BigInt(t * 1_000_000_000);
    let accepts = 0;
    let rejects = 0;
    const rbc: Record<string, number> = {};
    for (const aid of agentIds) {
      const env = seal(identities.get(aid)!, KIND_POSE, encodePoseLike(aid, ts), ts);
      const r = tryOpenAndAccount(env, roster, replay, evaluator);
      if (r.ok) accepts++;
      else {
        rejects++;
        rbc[r.category!] = (rbc[r.category!] ?? 0) + 1;
      }
    }
    // Intruder
    const env = seal(intruder, KIND_POSE, encodePoseLike("intruder", ts), ts);
    const r = tryOpenAndAccount(env, roster, replay, evaluator);
    if (r.ok) accepts++;
    else {
      rejects++;
      rbc[r.category!] = (rbc[r.category!] ?? 0) + 1;
    }
    const reputations: Record<string, number> = {};
    for (const a of agentIds) reputations[a] = round6(evaluator.reputation(a));
    reputations["intruder"] = round6(evaluator.reputation("intruder"));
    results.push({ accepts, rejects, rejects_by_category: rbc, reputations });
  }
  return { ticks: results, intruderRep: round6(evaluator.reputation("intruder")) };
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

function expectTicksEqual(got: TickResult[], want: TickResult[], scenarioName: string): void {
  expect(got.length).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    const g = got[i]!;
    const w = want[i]!;
    expect(g.accepts, `${scenarioName} tick ${i + 1} accepts`).toBe(w.accepts);
    expect(g.rejects, `${scenarioName} tick ${i + 1} rejects`).toBe(w.rejects);
    expect(g.rejects_by_category, `${scenarioName} tick ${i + 1} rejects_by_category`).toEqual(
      w.rejects_by_category,
    );
    for (const peer of Object.keys(w.reputations)) {
      expect(g.reputations[peer], `${scenarioName} tick ${i + 1} rep[${peer}]`).toBeCloseTo(
        w.reputations[peer]!,
        6,
      );
    }
  }
}

describe("per-scenario parity (envelope round-trip)", () => {
  test("honest_baseline matches Python tick-by-tick", () => {
    const fx = FIXTURE.scenarios["honest_baseline"]!;
    const got = runHonestBaseline(fx.n_peers!, fx.ticks!.length);
    expectTicksEqual(got, fx.ticks!, "honest_baseline");
  });

  test("swap_key matches Python tick-by-tick", () => {
    const fx = FIXTURE.scenarios["swap_key"]!;
    const got = runSwapKeyScenario(fx.n_peers!, fx.ticks!.length, fx.swap_key_tick!);
    expectTicksEqual(got, fx.ticks!, "swap_key");
  });

  test("replay_storm matches Python tick-by-tick", () => {
    const fx = FIXTURE.scenarios["replay_storm"]!;
    expect(fx.replay_repetitions).toBe(REPLAY_REPETITIONS);
    const got = runReplayStormScenario(fx.n_peers!, fx.ticks!.length, fx.replay_start_tick!);
    expectTicksEqual(got, fx.ticks!, "replay_storm");
  });

  test("forged_emitter matches Python tick-by-tick", () => {
    const fx = FIXTURE.scenarios["forged_emitter"]!;
    const { ticks, intruderRep } = runForgedEmitterScenario(fx.n_peers!, fx.ticks!.length);
    expectTicksEqual(ticks, fx.ticks!, "forged_emitter");
    expect(intruderRep).toBeCloseTo(fx.final_reputations!["intruder"]!, 6);
  });
});

describe("per-scenario parity (COP filter)", () => {
  test("cop_phantom_static high-rep case matches Python build_cop exactly", () => {
    const fx = FIXTURE.scenarios["cop_phantom_static"]!;
    const reports = buildContactLog(fx);
    const cop = buildCop(reports, fx.case_high_rep!.reputations);
    expectCopEqual(cop, fx.case_high_rep!.cop, "cop_high_rep");
  });

  test("cop_phantom_static low-rep case filters the phantom out", () => {
    const fx = FIXTURE.scenarios["cop_phantom_static"]!;
    const reports = buildContactLog(fx);
    const cop = buildCop(reports, fx.case_low_rep!.reputations);
    expectCopEqual(cop, fx.case_low_rep!.cop, "cop_low_rep");
  });
});

function buildContactLog(fx: ScenarioFixture): ContactReport[] {
  const log: ContactReport[] = [];
  const real = fx.real_item!;
  const phantom = fx.phantom_item!;
  for (let t = 1; t <= 3; t++) {
    const ts = BigInt(t * 1_000_000_000);
    for (const peer of fx.peers!) {
      if (peer === "delta") continue;
      log.push({
        reporter_id: peer,
        contact_id: real.id,
        kind: real.kind,
        x: real.x,
        y: real.y,
        timestamp_ns: ts,
      });
    }
    log.push({
      reporter_id: "delta",
      contact_id: phantom.id,
      kind: phantom.kind,
      x: phantom.x,
      y: phantom.y,
      timestamp_ns: ts,
    });
  }
  return log;
}

function expectCopEqual(
  got: Map<string, { contact_id: string; kind: string; x: number; y: number; weight: number; reporters: ReadonlyArray<string> }>,
  want: Record<string, CopFixtureEntry>,
  label: string,
): void {
  const wantIds = Object.keys(want).sort();
  const gotIds = [...got.keys()].sort();
  expect(gotIds, `${label} contact IDs`).toEqual(wantIds);
  for (const cid of wantIds) {
    const g = got.get(cid)!;
    const w = want[cid]!;
    expect(g.kind, `${label} ${cid} kind`).toBe(w.kind);
    expect(g.x, `${label} ${cid} x`).toBeCloseTo(w.x, 6);
    expect(g.y, `${label} ${cid} y`).toBeCloseTo(w.y, 6);
    expect(g.weight, `${label} ${cid} weight`).toBeCloseTo(w.weight, 6);
    expect([...g.reporters].sort(), `${label} ${cid} reporters`).toEqual([...w.reporters].sort());
  }
}
