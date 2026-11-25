import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateUsageCostMinor,
  recordUsage
} from "../../src/services/usage.service.js";

test("Usage Service: calculateUsageCostMinor applies exact half-up rounding on scaled quantities", () => {
  // Zenith sample from Revision 3 specification:
  // 275 / 100 compute units * 10 minor currency units = 27.5 -> rounded half-up to 28 minor units
  const zenithCost = calculateUsageCostMinor(275, 100, 10);
  assert.equal(zenithCost, 28, "27.5 minor units must round half-up to 28");

  // Acme sample from Revision 3 specification:
  // 1000 / 1 requests * 2 minor currency units = 2000 minor units
  const acmeCost = calculateUsageCostMinor(1000, 1, 2);
  assert.equal(acmeCost, 2000);

  // Fractional round-down case:
  // 274 / 100 * 10 = 27.4 -> rounded half-up to 27
  const downCost = calculateUsageCostMinor(274, 100, 10);
  assert.equal(downCost, 27);
});

test("Usage Service: calculateUsageCostMinor validates integer types and bounds", () => {
  // Negative quantity
  assert.throws(() => calculateUsageCostMinor(-10, 1, 5), /quantityScaled must be a non-negative safe integer/);

  // Invalid scale (zero or negative)
  assert.throws(() => calculateUsageCostMinor(100, 0, 5), /quantityScale must be a positive safe integer/);
  assert.throws(() => calculateUsageCostMinor(100, -1, 5), /quantityScale must be a positive safe integer/);

  // Floating-point input prohibited
  assert.throws(() => calculateUsageCostMinor(2.75, 100, 10), /quantityScaled must be a non-negative safe integer/);
});

test("Usage Service: recordUsage rejects invalid metricType", async () => {
  const mockDb = {};

  await assert.rejects(
    () => recordUsage(mockDb, {
      organizationId: "org_acme_001",
      eventId: "evt_invalid_metric",
      metricType: "bandwidth_unsupported",
      quantityScaled: 100,
      quantityScale: 1,
      unit: "GB",
      unitPriceMinor: 5
    }),
    err => err.statusCode === 400 && err.code === "INVALID_METRIC_TYPE"
  );
});
