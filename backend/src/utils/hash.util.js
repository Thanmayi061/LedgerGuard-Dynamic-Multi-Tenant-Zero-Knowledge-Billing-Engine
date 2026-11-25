/**
 * Canonical Request Hashing Utility
 *
 * Produces deterministic SHA-256 hex digests (64 characters) from request payloads
 * regardless of key ordering, whitespace, or object property sequence.
 */
import crypto from "node:crypto";

/**
 * Recursively canonicalizes an object by sorting its keys alphabetically.
 */
export function canonicalizeValue(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }

  const sortedObj = {};
  const keys = Object.keys(value).sort();
  for (const key of keys) {
    sortedObj[key] = canonicalizeValue(value[key]);
  }
  return sortedObj;
}

/**
 * Computes a deterministic 64-character SHA-256 hex digest of a canonical payload.
 */
export function computeRequestHash(payload) {
  if (payload === undefined || payload === null) {
    return null;
  }
  const canonical = canonicalizeValue(payload);
  const jsonString = JSON.stringify(canonical);
  return crypto.createHash("sha256").update(jsonString).digest("hex");
}
