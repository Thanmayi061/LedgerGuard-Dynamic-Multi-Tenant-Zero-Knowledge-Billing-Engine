import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeValue,
  computeRequestHash
} from "../../src/utils/hash.util.js";

test("Hash Utility: canonicalizeValue sorts keys deterministically", () => {
  const unordered = {
    zebra: 1,
    apple: 2,
    nested: {
      charlie: "c",
      alpha: "a",
      bravo: "b"
    },
    list: [{ z: 1, a: 2 }]
  };

  const canonical = canonicalizeValue(unordered);
  const topKeys = Object.keys(canonical);
  assert.deepEqual(topKeys, ["apple", "list", "nested", "zebra"]);

  const nestedKeys = Object.keys(canonical.nested);
  assert.deepEqual(nestedKeys, ["alpha", "bravo", "charlie"]);
});

test("Hash Utility: computeRequestHash produces identical 64-char SHA-256 for reordered keys", () => {
  const payload1 = {
    amountMinor: 129900,
    currency: "INR",
    metadata: { orderId: "ord_100", customer: "Acme" }
  };

  const payload2 = {
    currency: "INR",
    metadata: { customer: "Acme", orderId: "ord_100" },
    amountMinor: 129900
  };

  const hash1 = computeRequestHash(payload1);
  const hash2 = computeRequestHash(payload2);

  assert.equal(typeof hash1, "string");
  assert.equal(hash1.length, 64, "Must be a 64-character SHA-256 hex digest");
  assert.match(hash1, /^[a-f0-9]{64}$/, "Must match Mongoose requestHash format");
  assert.equal(hash1, hash2, "Identical payloads with different key orders must produce the exact same hash");
});

test("Hash Utility: computeRequestHash changes when any payload value changes", () => {
  const payload1 = { amountMinor: 129900, currency: "INR" };
  const payload2 = { amountMinor: 129901, currency: "INR" };

  const hash1 = computeRequestHash(payload1);
  const hash2 = computeRequestHash(payload2);

  assert.notEqual(hash1, hash2, "Altering amountMinor must produce a different hash");
});
