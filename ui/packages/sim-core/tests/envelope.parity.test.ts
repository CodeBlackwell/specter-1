import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { bytesToHex, hexToBytes, verify } from "../src/crypto";
import {
  envelopeFromWire,
  envelopeToWire,
  openEnvelope,
  signedBlob,
  VerificationError,
  type Envelope,
  type ReplayWindow,
  type Roster,
} from "../src/envelope";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  envelope: Array<{
    label: string;
    sender_pub_hex: string;
    envelope: {
      version: number;
      sender_id: string;
      nonce: number;
      timestamp_ns: number;
      kind: string;
      payload_hex: string;
      signature_der_hex: string;
    };
    signed_blob_hex: string;
    wire_hex: string;
  }>;
};

describe("envelope parity vs Python", () => {
  it.each(fixtures.envelope)("signed_blob is byte-exact for $label", (vec) => {
    const blob = signedBlob(
      vec.envelope.version,
      vec.envelope.sender_id,
      BigInt(vec.envelope.nonce),
      BigInt(vec.envelope.timestamp_ns),
      vec.envelope.kind,
      hexToBytes(vec.envelope.payload_hex),
    );
    expect(bytesToHex(blob)).toBe(vec.signed_blob_hex);
  });

  it.each(fixtures.envelope)("signature verifies against signed_blob for $label", (vec) => {
    const pub = hexToBytes(vec.sender_pub_hex);
    const blob = hexToBytes(vec.signed_blob_hex);
    const sig = hexToBytes(vec.envelope.signature_der_hex);
    expect(verify(pub, blob, sig)).toBe(true);
  });

  it.each(fixtures.envelope)("envelopeToWire matches Python wire for $label", (vec) => {
    const env: Envelope = {
      version: vec.envelope.version,
      senderId: vec.envelope.sender_id,
      nonce: BigInt(vec.envelope.nonce),
      timestampNs: BigInt(vec.envelope.timestamp_ns),
      kind: vec.envelope.kind,
      payload: hexToBytes(vec.envelope.payload_hex),
      signature: hexToBytes(vec.envelope.signature_der_hex),
    };
    expect(bytesToHex(envelopeToWire(env))).toBe(vec.wire_hex);
  });

  it.each(fixtures.envelope)("envelopeFromWire round-trips for $label", (vec) => {
    const env = envelopeFromWire(hexToBytes(vec.wire_hex));
    expect(env.senderId).toBe(vec.envelope.sender_id);
    expect(env.nonce).toBe(BigInt(vec.envelope.nonce));
    expect(env.timestampNs).toBe(BigInt(vec.envelope.timestamp_ns));
    expect(env.kind).toBe(vec.envelope.kind);
    expect(bytesToHex(env.payload)).toBe(vec.envelope.payload_hex);
    expect(bytesToHex(env.signature)).toBe(vec.envelope.signature_der_hex);
  });

  it("openEnvelope accepts a valid envelope and rejects replay", () => {
    const vec = fixtures.envelope[0];
    if (!vec) throw new Error("fixture missing");
    const env = envelopeFromWire(hexToBytes(vec.wire_hex));
    const roster: Roster = new Map([[env.senderId, hexToBytes(vec.sender_pub_hex)]]);
    const replay: ReplayWindow = new Map();
    expect(openEnvelope(env, roster, replay)).toEqual(env.payload);
    expect(() => openEnvelope(env, roster, replay)).toThrow(VerificationError);
  });

  it("openEnvelope rejects unknown sender", () => {
    const vec = fixtures.envelope[0];
    if (!vec) throw new Error("fixture missing");
    const env = envelopeFromWire(hexToBytes(vec.wire_hex));
    const roster: Roster = new Map();
    const replay: ReplayWindow = new Map();
    expect(() => openEnvelope(env, roster, replay)).toThrow(/unknown sender/);
  });

  it("openEnvelope rejects tampered payload", () => {
    const vec = fixtures.envelope[0];
    if (!vec) throw new Error("fixture missing");
    const env = envelopeFromWire(hexToBytes(vec.wire_hex));
    const tampered: Envelope = { ...env, payload: new Uint8Array([...env.payload, 0xff]) };
    const roster: Roster = new Map([[env.senderId, hexToBytes(vec.sender_pub_hex)]]);
    const replay: ReplayWindow = new Map();
    expect(() => openEnvelope(tampered, roster, replay)).toThrow(/bad signature/);
  });
});
