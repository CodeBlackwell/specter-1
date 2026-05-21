import { describe, expect, test } from "vitest";

import {
  SecureBus,
  encodeObservation,
  encodePoseReport,
  tryOpen,
  decodeObservation,
  decodePoseReport,
  KIND_OBSERVATION,
  KIND_POSE,
  seal,
  envelopeFromWire,
  envelopeToWire,
  type Observation,
  type PoseReport,
} from "../src";

const ts = (n: number) => BigInt(n);

const obs: Observation = {
  observer_id: "alpha",
  subject_id: "bravo",
  range_m: 4.5,
  bearing_rad: 0.1,
  timestamp_ns: ts(100),
};

const pose: PoseReport = {
  agent_id: "alpha",
  x: 1.0,
  y: 2.0,
  theta: 0.5,
  timestamp_ns: ts(100),
};

describe("SecureBus seal → open round-trip", () => {
  test("a freshly-sealed observation verifies cleanly", () => {
    const bus = new SecureBus();
    const ident = bus.registerAgent("alpha");
    const env = seal(ident, KIND_OBSERVATION, encodeObservation(obs), obs.timestamp_ns);
    const res = tryOpen(env, bus.roster, bus.replay);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const decoded = decodeObservation(res.payload);
      expect(decoded.observer_id).toBe(obs.observer_id);
      expect(decoded.range_m).toBeCloseTo(obs.range_m, 12);
    }
  });

  test("pose-report round-trip preserves all fields", () => {
    const bus = new SecureBus();
    const ident = bus.registerAgent("alpha");
    const env = seal(ident, KIND_POSE, encodePoseReport(pose), pose.timestamp_ns);
    const res = tryOpen(env, bus.roster, bus.replay);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const decoded = decodePoseReport(res.payload);
      expect(decoded).toEqual(pose);
    }
  });
});

describe("envelope-level attacks", () => {
  test("swap_key: rotated keypair without roster update produces bad_signature reject", () => {
    const bus = new SecureBus();
    const ident = bus.registerAgent("alpha");
    // Verify a clean envelope first
    const okEnv = seal(ident, KIND_OBSERVATION, encodeObservation(obs), ts(100));
    const okRes = tryOpen(okEnv, bus.roster, bus.replay);
    expect(okRes.ok).toBe(true);

    // Now rotate the keypair without updating the roster
    bus.rotateKeypairSecretly("alpha");
    const badEnv = seal(ident, KIND_OBSERVATION, encodeObservation({ ...obs, timestamp_ns: ts(200) }), ts(200));
    const badRes = tryOpen(badEnv, bus.roster, bus.replay);
    expect(badRes.ok).toBe(false);
    if (!badRes.ok) expect(badRes.category).toBe("bad_signature");
  });

  test("replay_storm: re-publishing a captured envelope fails the replay window", () => {
    const bus = new SecureBus();
    const ident = bus.registerAgent("alpha");
    const env = seal(ident, KIND_OBSERVATION, encodeObservation(obs), ts(100));
    const wire = envelopeToWire(env);

    const first = tryOpen(env, bus.roster, bus.replay);
    expect(first.ok).toBe(true);

    const replay = envelopeFromWire(wire);
    const second = tryOpen(replay, bus.roster, bus.replay);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.category).toBe("replay");
  });

  test("forged emitter: off-roster identity produces unknown_sender reject", () => {
    const bus = new SecureBus();
    bus.registerAgent("alpha");
    const intruder = bus.registerForeignEmitter("intruder-1");
    const fake: Observation = {
      observer_id: "intruder-1",
      subject_id: "alpha",
      range_m: 7.0,
      bearing_rad: 0.0,
      timestamp_ns: ts(100),
    };
    const env = seal(intruder, KIND_OBSERVATION, encodeObservation(fake), ts(100));
    const res = tryOpen(env, bus.roster, bus.replay);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.category).toBe("unknown_sender");
  });

  test("tampering: mutating envelope payload after sealing produces bad_signature", () => {
    const bus = new SecureBus();
    const ident = bus.registerAgent("alpha");
    const env = seal(ident, KIND_OBSERVATION, encodeObservation(obs), ts(100));
    const tampered = { ...env, payload: encodeObservation({ ...obs, range_m: 99.0 }) };
    const res = tryOpen(tampered, bus.roster, bus.replay);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.category).toBe("bad_signature");
  });
});
