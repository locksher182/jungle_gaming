import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const result: Record<string, unknown> = {};

  for (const key of sortedKeys) {
    result[key] = canonicalize(obj[key]);
  }

  return result;
}

export function computeCanonicalPayloadHash(payload: unknown): string {
  const canonicalObj = canonicalize(payload);
  const jsonString = JSON.stringify(canonicalObj);
  return createHash("sha256").update(jsonString).digest("hex");
}
