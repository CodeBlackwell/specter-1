export type CanonicalValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | readonly CanonicalValue[]
  | { readonly [k: string]: CanonicalValue };

export function canonicalJson(value: CanonicalValue): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as { readonly [k: string]: CanonicalValue };
    const keys = Object.keys(obj).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k] as CanonicalValue));
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`cannot canonicalize ${typeof value}`);
}

export function canonicalJsonBytes(value: CanonicalValue): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
