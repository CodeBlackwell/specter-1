import { bytesToHex, hexToBytes, sign, verify } from "./crypto";
import { canonicalJsonBytes } from "./canonicalJson";

export const WIRE_VERSION = 1;

export type Envelope = {
  version: number;
  senderId: string;
  nonce: bigint;
  timestampNs: bigint;
  kind: string;
  payload: Uint8Array;
  signature: Uint8Array;
};

export class VerificationError extends Error {
  override name = "VerificationError";
}

export type RejectCategory =
  | "bad_signature"
  | "replay"
  | "unknown_sender"
  | "version_mismatch"
  | "unknown";

export function categorizeVerificationError(message: string): RejectCategory {
  if (message.startsWith("bad signature")) return "bad_signature";
  if (message.startsWith("replay")) return "replay";
  if (message.startsWith("unknown sender")) return "unknown_sender";
  if (message.startsWith("unsupported version")) return "version_mismatch";
  return "unknown";
}

export function signedBlob(
  version: number,
  senderId: string,
  nonce: bigint,
  timestampNs: bigint,
  kind: string,
  payload: Uint8Array,
): Uint8Array {
  return canonicalJsonBytes({
    version,
    sender_id: senderId,
    nonce,
    timestamp_ns: timestampNs,
    kind,
    payload: bytesToHex(payload),
  });
}

export function envelopeToWire(env: Envelope): Uint8Array {
  return canonicalJsonBytes({
    version: env.version,
    sender_id: env.senderId,
    nonce: env.nonce,
    timestamp_ns: env.timestampNs,
    kind: env.kind,
    payload: bytesToHex(env.payload),
    signature: bytesToHex(env.signature),
  });
}

export function envelopeFromWire(data: Uint8Array): Envelope {
  const text = new TextDecoder().decode(data);
  const blob = JSON.parse(text) as {
    version: number;
    sender_id: string;
    nonce: number | string;
    timestamp_ns: number | string;
    kind: string;
    payload: string;
    signature: string;
  };
  return {
    version: blob.version,
    senderId: blob.sender_id,
    nonce: BigInt(blob.nonce),
    timestampNs: BigInt(blob.timestamp_ns),
    kind: blob.kind,
    payload: hexToBytes(blob.payload),
    signature: hexToBytes(blob.signature),
  };
}

export type Identity = {
  agentId: string;
  privateKey: Uint8Array;
  nonce: bigint;
};

export function newIdentity(agentId: string, privateKey: Uint8Array): Identity {
  return { agentId, privateKey, nonce: 0n };
}

export function seal(
  identity: Identity,
  kind: string,
  payload: Uint8Array,
  timestampNs: bigint,
): Envelope {
  identity.nonce += 1n;
  const blob = signedBlob(WIRE_VERSION, identity.agentId, identity.nonce, timestampNs, kind, payload);
  const signature = sign(identity.privateKey, blob);
  return {
    version: WIRE_VERSION,
    senderId: identity.agentId,
    nonce: identity.nonce,
    timestampNs,
    kind,
    payload,
    signature,
  };
}

export type Roster = Map<string, Uint8Array>;
export type ReplayWindow = Map<string, bigint>;

export function openEnvelope(env: Envelope, roster: Roster, replay: ReplayWindow): Uint8Array {
  if (env.version !== WIRE_VERSION) {
    throw new VerificationError(`unsupported version ${env.version}`);
  }
  const pub = roster.get(env.senderId);
  if (!pub) throw new VerificationError(`unknown sender ${env.senderId}`);
  const blob = signedBlob(env.version, env.senderId, env.nonce, env.timestampNs, env.kind, env.payload);
  if (!verify(pub, blob, env.signature)) {
    throw new VerificationError(`bad signature from ${env.senderId}`);
  }
  const lastSeen = replay.get(env.senderId) ?? 0n;
  if (env.nonce <= lastSeen) {
    throw new VerificationError(`replay from ${env.senderId} nonce=${env.nonce}`);
  }
  replay.set(env.senderId, env.nonce);
  return env.payload;
}
