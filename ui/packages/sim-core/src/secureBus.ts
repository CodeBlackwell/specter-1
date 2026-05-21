/**
 * Signed in-process bus + replay protection — TypeScript parity to
 * `src/specter/secure_bus.py`. Used by `runSecureScenario` (see scenario.ts)
 * to round-trip every Observation/PoseReport through seal → wire → openEnvelope
 * → evaluator, so envelope-level attacks (swap_key, replay_storm,
 * forged_envelope) exercise the same code paths as the Python eval harness.
 *
 * Threat model coverage matches Python:
 *   tampering   — any modification to envelope fields invalidates signature
 *   spoofing    — receiver verifies signature against claimed sender's roster key
 *   replay      — per-sender nonce must be strictly monotonic
 */

import { canonicalJsonBytes } from "./canonicalJson";
import {
  envelopeFromWire,
  envelopeToWire,
  openEnvelope,
  seal,
  VerificationError,
  categorizeVerificationError,
  type Envelope,
  type Identity,
  type Roster,
  type RejectCategory,
  type ReplayWindow,
} from "./envelope";
import { generateKeypair, publicKeyFromPrivate } from "./crypto";
import type { ContactReport, Observation, PoseReport } from "./messages";
import { KIND_CONTACT_REPORT, KIND_OBSERVATION, KIND_POSE } from "./messages";

// Payload codec — canonical JSON of the Observation/PoseReport fields. Matches
// `src/specter/messages.py:encode` exactly: bigint timestamps serialized as
// JSON numbers without precision loss (bigint integers fit in JSON until 2^53;
// our 50-tick scenarios at 1e9 ns/s stay well under that cap).

export function encodeObservation(obs: Observation): Uint8Array {
  return canonicalJsonBytes({
    bearing_rad: obs.bearing_rad,
    observer_id: obs.observer_id,
    range_m: obs.range_m,
    subject_id: obs.subject_id,
    timestamp_ns: obs.timestamp_ns,
  });
}

export function encodePoseReport(p: PoseReport): Uint8Array {
  return canonicalJsonBytes({
    agent_id: p.agent_id,
    theta: p.theta,
    timestamp_ns: p.timestamp_ns,
    x: p.x,
    y: p.y,
  });
}

export function decodeObservation(payload: Uint8Array): Observation {
  const blob = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
  return {
    observer_id: blob.observer_id as string,
    subject_id: blob.subject_id as string,
    range_m: blob.range_m as number,
    bearing_rad: blob.bearing_rad as number,
    timestamp_ns: BigInt(blob.timestamp_ns as number | string),
  };
}

export function decodePoseReport(payload: Uint8Array): PoseReport {
  const blob = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
  return {
    agent_id: blob.agent_id as string,
    x: blob.x as number,
    y: blob.y as number,
    theta: blob.theta as number,
    timestamp_ns: BigInt(blob.timestamp_ns as number | string),
  };
}

export function encodeContactReport(cr: ContactReport): Uint8Array {
  return canonicalJsonBytes({
    contact_id: cr.contact_id,
    kind: cr.kind,
    reporter_id: cr.reporter_id,
    timestamp_ns: cr.timestamp_ns,
    x: cr.x,
    y: cr.y,
  });
}

export function decodeContactReport(payload: Uint8Array): ContactReport {
  const blob = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
  return {
    reporter_id: blob.reporter_id as string,
    contact_id: blob.contact_id as string,
    kind: blob.kind as string,
    x: blob.x as number,
    y: blob.y as number,
    timestamp_ns: BigInt(blob.timestamp_ns as number | string),
  };
}

/** Owned identities + receiver-side roster + per-sender replay window.
 * Constructed once per scenario run; the receiver's openEnvelope is called
 * for every published envelope. */
export class SecureBus {
  readonly identities = new Map<string, Identity>();
  readonly roster: Roster = new Map();
  readonly replay: ReplayWindow = new Map();

  /** Mint a keypair, install in roster, return the Identity that seals envelopes. */
  registerAgent(agentId: string): Identity {
    const kp = generateKeypair();
    const id: Identity = { agentId, privateKey: kp.privateKey, nonce: 0n };
    this.identities.set(agentId, id);
    this.roster.set(agentId, kp.publicKey);
    return id;
  }

  /** Mint an off-roster keypair for a forged emitter. Identity returned can
   * seal envelopes with a valid signature, but the roster never learns the
   * public key — openEnvelope rejects with "unknown sender". */
  registerForeignEmitter(emitterId: string): Identity {
    const kp = generateKeypair();
    const id: Identity = { agentId: emitterId, privateKey: kp.privateKey, nonce: 0n };
    this.identities.set(emitterId, id);
    return id;
  }

  /** Rotate an agent's signing keypair without updating the roster — the
   * swap_key attack. All subsequent envelopes from this agent fail signature
   * verification on the receive side. */
  rotateKeypairSecretly(agentId: string): void {
    const id = this.identities.get(agentId);
    if (!id) throw new Error(`no identity for ${agentId}`);
    const kp = generateKeypair();
    id.privateKey = kp.privateKey;
    // Roster is NOT updated — that's the point.
  }

  /** Re-publish a previously captured envelope. Replay window catches it on
   * the second-or-later publish (nonce no longer strictly monotonic). */
  publishCaptured(wire: Uint8Array): { env: Envelope } {
    return { env: envelopeFromWire(wire) };
  }
}

/** Attempt to verify a freshly-sealed envelope. Returns `{ payload }` on
 * success or `{ error, category }` on rejection. Pure wrapper around
 * openEnvelope that buckets the failure category. */
export function tryOpen(
  env: Envelope,
  roster: Roster,
  replay: ReplayWindow,
): { ok: true; payload: Uint8Array } | { ok: false; category: RejectCategory; message: string } {
  try {
    const payload = openEnvelope(env, roster, replay);
    return { ok: true, payload };
  } catch (e) {
    if (e instanceof VerificationError) {
      return { ok: false, category: categorizeVerificationError(e.message), message: e.message };
    }
    throw e;
  }
}

// Convenience helpers for round-tripping a sealed envelope (seal → wire →
// open). Used by tests and scenario.ts envelope mode.

export function sealAndOpenObservation(
  identity: Identity,
  obs: Observation,
  bus: SecureBus,
): { env: Envelope; result: ReturnType<typeof tryOpen> } {
  const env = seal(identity, KIND_OBSERVATION, encodeObservation(obs), obs.timestamp_ns);
  return { env, result: tryOpen(env, bus.roster, bus.replay) };
}

export function sealAndOpenPose(
  identity: Identity,
  p: PoseReport,
  bus: SecureBus,
): { env: Envelope; result: ReturnType<typeof tryOpen> } {
  const env = seal(identity, KIND_POSE, encodePoseReport(p), p.timestamp_ns);
  return { env, result: tryOpen(env, bus.roster, bus.replay) };
}

// Re-exports for convenience
export { envelopeToWire, envelopeFromWire, openEnvelope, seal, VerificationError, categorizeVerificationError };
export type { Envelope, Roster, ReplayWindow, Identity, RejectCategory };
