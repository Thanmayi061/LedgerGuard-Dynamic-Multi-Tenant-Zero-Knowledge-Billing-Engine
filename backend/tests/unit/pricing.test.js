import test from "node:test";
import assert from "node:assert/strict";

import {
  createPricingPlan,
  getActivePricingPlan
} from "../../src/services/pricing.service.js";

test("Pricing Service: createPricingPlan validates input requirements", async () => {
  const mockDb = {};

  // Missing planCode
  await assert.rejects(
    () => createPricingPlan(mockDb, {
      organizationId: "org_acme_001",
      planCode: "",
      name: "Plan Name",
      rates: [{ metricType: "api_requests", unit: "req", unitPriceMinor: 2, currency: "INR" }],
      effectiveFrom: new Date()
    }),
    /planCode is required/
  );

  // Missing rates
  await assert.rejects(
    () => createPricingPlan(mockDb, {
      organizationId: "org_acme_001",
      planCode: "growth",
      name: "Growth Plan",
      rates: [],
      effectiveFrom: new Date()
    }),
    /rates must be a non-empty array/
  );

  // Invalid version (negative or zero)
  await assert.rejects(
    () => createPricingPlan(mockDb, {
      organizationId: "org_acme_001",
      planCode: "growth",
      version: 0,
      name: "Growth Plan",
      rates: [{ metricType: "api_requests", unit: "req", unitPriceMinor: 2, currency: "INR" }],
      effectiveFrom: new Date()
    }),
    /version must be a positive safe integer/
  );
});

test("Pricing Service: getActivePricingPlan requires planCode", async () => {
  const mockDb = {};

  await assert.rejects(
    () => getActivePricingPlan(mockDb, { planCode: "" }),
    /planCode is required/
  );
});
