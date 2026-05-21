import { describe, it, expect } from "vitest";
import {
  landmarkInformation,
  PoseGraphTS,
  SINGLETON_INFO_SCALE,
  T_CORROBORATE,
  T_FADE,
  type LandmarkFactor,
} from "../src/poseGraph";

/** ADR 0022 — singleton cap + stale-singleton fade (TS port). Mirrors
 * tests/test_pose_graph_singleton.py. Cap and fade are opt-in; default
 * behavior is byte-exact unchanged (gated by the broader sim-core parity
 * suite still passing). */

function buildSingletonLieGraph(insertionTick = 0) {
  const pg = new PoseGraphTS();
  pg.addPose("p0", { x: 0, y: 0, theta: 0 });

  // Shared landmark — 3 honest + liar, all consistent
  pg.addLandmark("lm_shared", [4, 0]);
  let honestShared: LandmarkFactor | null = null;
  for (let i = 0; i < 3; i++) {
    const f: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm_shared",
      rangeM: 5,
      bearingRad: 0,
      info: landmarkInformation(5),
      sourceId: `honest_${i}`,
      nlos: false,
    };
    pg.addLandmarkFactor(f, { tick: insertionTick });
    if (honestShared === null) honestShared = f;
  }
  const liarShared: LandmarkFactor = {
    kind: "landmark",
    poseId: "p0",
    landmarkId: "lm_shared",
    rangeM: 5,
    bearingRad: 0,
    info: landmarkInformation(5),
    sourceId: "liar",
    nlos: false,
  };
  pg.addLandmarkFactor(liarShared, { tick: insertionTick });

  // Singleton — only the liar observes it
  pg.addLandmark("lm_singleton", [0, 8]);
  const singleton: LandmarkFactor = {
    kind: "landmark",
    poseId: "p0",
    landmarkId: "lm_singleton",
    rangeM: 10,
    bearingRad: Math.PI / 2,
    info: landmarkInformation(10),
    sourceId: "liar",
    nlos: false,
  };
  pg.addLandmarkFactor(singleton, { tick: insertionTick });

  return { pg, singleton, honestShared: honestShared! };
}

describe("ADR 0022 — singleton substrate + cap + fade", () => {
  it("records provenance on add when tick is supplied", () => {
    const pg = new PoseGraphTS();
    pg.addPose("p0", { x: 0, y: 0, theta: 0 });
    pg.addLandmark("lm", [5, 0]);
    pg.setReputationSource(() => 0.42);
    const f: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm",
      rangeM: 5,
      bearingRad: 0,
      info: landmarkInformation(5),
      sourceId: "liar",
      nlos: false,
    };
    pg.addLandmarkFactor(f, { tick: 10 });
    const prov = pg.factorProvenance(f)!;
    expect(prov.insertionTick).toBe(10);
    expect(prov.reporterId).toBe("liar");
    expect(prov.reputationAtInsertion).toBeCloseTo(0.42, 10);
  });

  it("caps singleton landmarks but not shared ones", () => {
    const { pg, singleton, honestShared } = buildSingletonLieGraph();
    pg.enableSingletonCap(true);
    pg.setReputationSource(() => 1.0);
    pg.optimize();

    expect(pg.factorWeight(singleton)).toBeLessThanOrEqual(SINGLETON_INFO_SCALE * 1.05);
    expect(pg.factorWeight(honestShared)).toBeGreaterThanOrEqual(0.9);
  });

  it("fades a stale singleton to zero past T_CORROBORATE + T_FADE", () => {
    const { pg, singleton } = buildSingletonLieGraph(0);
    pg.enableSingletonCap(true);
    pg.enableSingletonFade(true);
    pg.setCurrentTick(T_CORROBORATE + T_FADE + 100);
    pg.setReputationSource(() => 1.0);
    pg.optimize();
    expect(pg.factorWeight(singleton)).toBeLessThan(1.0e-9);
  });

  it("fades linearly at the half-decay point", () => {
    const { pg, singleton } = buildSingletonLieGraph(0);
    pg.enableSingletonCap(true);
    pg.enableSingletonFade(true);
    pg.setCurrentTick(T_CORROBORATE + Math.floor(T_FADE / 2));
    pg.setReputationSource(() => 1.0);
    pg.optimize();
    const expected = 0.5 * SINGLETON_INFO_SCALE;
    expect(Math.abs(pg.factorWeight(singleton) - expected)).toBeLessThan(0.05);
  });

  it("composes singleton cap multiplicatively with reputation collapse", () => {
    const { pg, singleton } = buildSingletonLieGraph();
    pg.enableSingletonCap(true);
    const rep: Record<string, number> = {
      liar: 0.01,
      honest_0: 1.0,
      honest_1: 1.0,
      honest_2: 1.0,
    };
    pg.setReputationSource((sid) => rep[sid] ?? 1.0);
    pg.optimize();
    const expectedMax = SINGLETON_INFO_SCALE * (rep.liar ?? 1.0) * 1.1;
    expect(pg.factorWeight(singleton)).toBeLessThanOrEqual(expectedMax);
  });

  it("cap is opt-in: default-off preserves pre-ADR-0022 weight", () => {
    const { pg, singleton } = buildSingletonLieGraph();
    pg.setReputationSource(() => 1.0);
    pg.optimize();
    expect(pg.factorWeight(singleton)).toBeGreaterThanOrEqual(0.9);
  });

  it("a second reporter lifts the singleton cap", () => {
    const { pg, singleton } = buildSingletonLieGraph(0);
    pg.enableSingletonCap(true);
    pg.setReputationSource(() => 1.0);
    pg.optimize();
    expect(pg.factorWeight(singleton)).toBeLessThanOrEqual(SINGLETON_INFO_SCALE * 1.05);

    const corroborator: LandmarkFactor = {
      kind: "landmark",
      poseId: "p0",
      landmarkId: "lm_singleton",
      rangeM: 10,
      bearingRad: Math.PI / 2,
      info: landmarkInformation(10),
      sourceId: "late_arriver",
      nlos: false,
    };
    pg.addLandmarkFactor(corroborator, { tick: 100 });
    pg.optimize();
    expect(pg.factorWeight(singleton)).toBeGreaterThanOrEqual(0.9);
  });
});
