import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";

export type Keypair = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
};

export function generateKeypair(): Keypair {
  const privateKey = p256.utils.randomPrivateKey();
  const publicKey = p256.getPublicKey(privateKey, false);
  return { privateKey, publicKey };
}

export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, false);
}

export function sign(privateKey: Uint8Array, payload: Uint8Array): Uint8Array {
  const digest = sha256(payload);
  const sig = p256.sign(digest, privateKey, { lowS: false });
  return sig.toDERRawBytes();
}

export function verify(
  publicKey: Uint8Array,
  payload: Uint8Array,
  signatureDer: Uint8Array,
): boolean {
  try {
    const digest = sha256(payload);
    return p256.verify(signatureDer, digest, publicKey, { lowS: false, format: "der" });
  } catch {
    return false;
  }
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hex must have even length: ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at offset ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
