import test from "node:test";
import assert from "node:assert/strict";

import {
  getPlatformConnection,
  getTenantConnection,
  closeDatabaseConnections,
  Organization,
  getUserModel,
  getBillingTransactionModel,
  getLedgerEntryModel,
  getUsageRecordModel,
  getPricingPlanModel,
  assertMatchingRequestHash,
  checkDatabaseHealth
} from "../../src/config/db.js";

test("Database Bridge: exports all required functions, models, and helpers", () => {
  assert.equal(typeof getPlatformConnection, "function", "getPlatformConnection should be a function");
  assert.equal(typeof getTenantConnection, "function", "getTenantConnection should be a function");
  assert.equal(typeof closeDatabaseConnections, "function", "closeDatabaseConnections should be a function");
  assert.equal(typeof checkDatabaseHealth, "function", "checkDatabaseHealth should be a function");

  assert.equal(typeof getUserModel, "function", "getUserModel should be a function");
  assert.equal(typeof getBillingTransactionModel, "function", "getBillingTransactionModel should be a function");
  assert.equal(typeof getLedgerEntryModel, "function", "getLedgerEntryModel should be a function");
  assert.equal(typeof getUsageRecordModel, "function", "getUsageRecordModel should be a function");
  assert.equal(typeof getPricingPlanModel, "function", "getPricingPlanModel should be a function");

  assert.ok(Organization, "Platform Organization model should be defined");
  assert.ok(Organization.schema, "Organization should have a Mongoose schema");
  assert.equal(typeof assertMatchingRequestHash, "function", "assertMatchingRequestHash should be a function");
});

test("Database Bridge: Platform Organization schema contains expected fields and indexes", () => {
  const schema = Organization.schema;
  const paths = Object.keys(schema.paths);

  assert.ok(paths.includes("organizationId"), "organizationId path must exist");
  assert.ok(paths.includes("name"), "name path must exist");
  assert.ok(paths.includes("email"), "email path must exist");
  assert.ok(paths.includes("status"), "status path must exist");
  assert.ok(paths.includes("plan"), "plan path must exist");
  assert.ok(paths.includes("databaseName"), "databaseName path must exist");
});

test("Database Bridge: assertMatchingRequestHash behaves correctly", () => {
  const hashA = "a".repeat(64);
  const hashB = "b".repeat(64);

  // Brand new key with no existing record should return true
  assert.equal(assertMatchingRequestHash(null, hashA), true);

  // Matching existing record and payload hash should return true
  assert.equal(assertMatchingRequestHash({ requestHash: hashA }, hashA), true);

  // Mismatched hash must throw 409
  assert.throws(
    () => assertMatchingRequestHash({ requestHash: hashA }, hashB),
    error => error.statusCode === 409 && error.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"
  );
});

test("Database Bridge: checkDatabaseHealth reports unconfigured when placeholder URI is used", async () => {
  const health = await checkDatabaseHealth();
  assert.ok(health);
  assert.equal(health.status, "unconfigured");
  assert.equal(health.platformDb, "platform_db");
});
