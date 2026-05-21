import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  bytesToHex,
  hexToBytes,
  publicKeyFromPrivate,
  sign,
  verify,
} from "../src/crypto";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures/parity.json"), "utf8")) as {
  raw_sign_verify: Array<{
    label: string;
    priv_hex: string;
    pub_hex: string;
    msg_hex: string;
    sig_der_hex: string;
  }>;
};

describe("crypto parity vs Python", () => {
  it.each(fixtures.raw_sign_verify)("verifies $label", (vec) => {
    const pub = hexToBytes(vec.pub_hex);
    const msg = hexToBytes(vec.msg_hex);
    const sig = hexToBytes(vec.sig_der_hex);
    expect(verify(pub, msg, sig)).toBe(true);
  });

  it.each(fixtures.raw_sign_verify)("rejects tampered payload for $label", (vec) => {
    const pub = hexToBytes(vec.pub_hex);
    const msg = hexToBytes(vec.msg_hex);
    const sig = hexToBytes(vec.sig_der_hex);
    const tampered = new Uint8Array(msg.length + 1);
    tampered.set(msg);
    tampered[msg.length] = 0xff;
    expect(verify(pub, tampered, sig)).toBe(false);
  });

  it.each(fixtures.raw_sign_verify)("derives matching pubkey for $label", (vec) => {
    const priv = hexToBytes(vec.priv_hex);
    const derivedPub = publicKeyFromPrivate(priv);
    expect(bytesToHex(derivedPub)).toBe(vec.pub_hex);
  });

  it("round-trips a fresh TS sig through TS verify", () => {
    const vec = fixtures.raw_sign_verify[0];
    if (!vec) throw new Error("fixture missing");
    const priv = hexToBytes(vec.priv_hex);
    const pub = hexToBytes(vec.pub_hex);
    const msg = new TextEncoder().encode("ts-fresh");
    const sig = sign(priv, msg);
    expect(verify(pub, msg, sig)).toBe(true);
  });
});
