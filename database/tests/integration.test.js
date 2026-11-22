import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { assertMatchingRequestHash } from "../src/idempotency.js";

const atlasUri = process.env.MONGODB_URI;
const enabled = Boolean(atlasUri && process.env.LEDGERGUARD_TEST_PLATFORM_DB_NAME);
const suffix = `${process.pid}_${Date.now()}`;
const platformDbName = process.env.LEDGERGUARD_TEST_PLATFORM_DB_NAME || `ledgerguard_test_platform_${suffix}`;
const orgA = `test_org_a_${suffix}`;
const orgB = `test_org_b_${suffix}`;
const dbA = `lg_test_a_${suffix}`;
const dbB = `lg_test_b_${suffix}`;
let platform;
let tenantA;
let tenantB;
let Organization;
let PlatformOrganization;
let getTenantConnection;
let closeDatabaseConnections;
let getBillingTransactionModel;
let getLedgerEntryModel;
let getUserModel;
let getPricingPlanModel;

before(async () => {
  if (!enabled) return;
  process.env.PLATFORM_DB_NAME = platformDbName;
  const connections = await import("../src/connections.js");
  const models = await import("../src/models.js");
  ({ getTenantConnection, closeDatabaseConnections } = connections);
  ({ Organization, getBillingTransactionModel, getLedgerEntryModel, getUserModel, getPricingPlanModel } = models);
  platform = await connections.getPlatformConnection();
  PlatformOrganization = platform.models.Organization || platform.model("Organization", Organization.schema);
  await PlatformOrganization.createIndexes();
  await PlatformOrganization.create([
    { organizationId: orgA, name: "Test A", email: `${orgA}@example.test`, status: "active", plan: "test", databaseName: dbA },
    { organizationId: orgB, name: "Test B", email: `${orgB}@example.test`, status: "active", plan: "test", databaseName: dbB }
  ]);
  [tenantA, tenantB] = await Promise.all([getTenantConnection(orgA), getTenantConnection(orgB)]);
  await Promise.all([
    getUserModel(tenantA).createIndexes(), getUserModel(tenantB).createIndexes(),
    getBillingTransactionModel(tenantA).createIndexes(), getBillingTransactionModel(tenantB).createIndexes(),
    getLedgerEntryModel(tenantA).createIndexes(), getLedgerEntryModel(tenantB).createIndexes(),
    getPricingPlanModel(tenantA).createIndexes()
  ]);
});

after(async () => {
  if (!enabled) return;
  await Promise.allSettled([
    platform.dropDatabase(),
    tenantA?.dropDatabase(),
    tenantB?.dropDatabase()
  ]);
  await closeDatabaseConnections();
});

test("idempotency rejects reuse of a key with a different request hash", () => {
  assert.equal(assertMatchingRequestHash(null, "a".repeat(64)), true);
  assert.equal(assertMatchingRequestHash({ requestHash: "a".repeat(64) }, "a".repeat(64)), true);
  assert.throws(
    () => assertMatchingRequestHash({ requestHash: "a".repeat(64) }, "b".repeat(64)),
    error => error.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" && error.statusCode === 409
  );
});

test("Atlas integration: simultaneous tenant requests reuse one connection", { skip: !enabled }, async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => getTenantConnection(orgA)));
  for (const connection of results) assert.strictEqual(connection, results[0]);
});

test("Atlas integration: tenant data remains isolated", { skip: !enabled }, async () => {
  const UserA = getUserModel(tenantA);
  const UserB = getUserModel(tenantB);
  await UserA.create({ organizationId: orgA, name: "Only A", email: `${suffix}@only-a.test`, passwordHash: "test-hash", role: "admin" });
  assert.equal(await UserA.countDocuments({ email: `${suffix}@only-a.test` }), 1);
  assert.equal(await UserB.countDocuments({ email: `${suffix}@only-a.test` }), 0);
});

test("Atlas integration: idempotency key is unique within a tenant", { skip: !enabled }, async () => {
  const Tx = getBillingTransactionModel(tenantA);
  const key = `idem_${suffix}`;
  const base = { transactionId: `tx_${suffix}`, organizationId: orgA, amountMinor: 100, currency: "INR", status: "pending", idempotencyKey: key, requestHash: "c".repeat(64) };
  await Tx.create(base);
  await assert.rejects(Tx.create({ ...base, transactionId: `tx2_${suffix}` }), error => error?.code === 11000);
});

test("Atlas integration: transaction rollback removes all writes", { skip: !enabled }, async () => {
  const Tx = getBillingTransactionModel(tenantA);
  const Ledger = getLedgerEntryModel(tenantA);
  const transactionId = `rollback_${suffix}`;
  const session = await tenantA.startSession();
  try {
    await assert.rejects(session.withTransaction(async () => {
      const [tx] = await Tx.create([{ transactionId, organizationId: orgA, amountMinor: 500, currency: "INR", status: "success", idempotencyKey: `rollback_idem_${suffix}`, requestHash: "d".repeat(64) }], { session });
      await Ledger.create([{ organizationId: orgA, transactionRef: tx._id, transactionId, journalId: `JRN_${transactionId}`, accountType: "cash", entryType: "debit", amountMinor: 500, currency: "INR" }], { session });
      throw new Error("intentional rollback test");
    }), /intentional rollback test/);
    assert.equal(await Tx.countDocuments({ transactionId }), 0);
    assert.equal(await Ledger.countDocuments({ transactionId }), 0);
  } finally {
    await session.endSession();
  }
});

test("Atlas integration: pricing version is unique and overlaps fail on create and update", { skip: !enabled }, async () => {
  const Plan = getPricingPlanModel(tenantA);
  const start = new Date("2035-01-01T00:00:00.000Z");
  const mid = new Date("2035-02-01T00:00:00.000Z");
  const end = new Date("2035-03-01T00:00:00.000Z");
  await Plan.create({ planCode: `testplan_${suffix}`, version: 1, name: "One", rates: [{ metricType: "compute_units", unit: "unit", unitPriceMinor: 1, currency: "INR" }], effectiveFrom: start, effectiveTo: mid });
  await assert.rejects(Plan.create({ planCode: `testplan_${suffix}`, version: 1, name: "Duplicate version", rates: [{ metricType: "compute_units", unit: "unit", unitPriceMinor: 1, currency: "INR" }], effectiveFrom: end }), error => error?.code === 11000);
  await assert.rejects(Plan.create({ planCode: `testplan_${suffix}`, version: 2, name: "Overlap", rates: [{ metricType: "compute_units", unit: "unit", unitPriceMinor: 1, currency: "INR" }], effectiveFrom: new Date("2035-01-15T00:00:00.000Z"), effectiveTo: end }), /overlaps/);
  const next = await Plan.create({ planCode: `testplan_${suffix}`, version: 2, name: "Non-overlap", rates: [{ metricType: "compute_units", unit: "unit", unitPriceMinor: 1, currency: "INR" }], effectiveFrom: mid, effectiveTo: end });
  await assert.rejects(Plan.updateOne({ _id: next._id }, { $set: { effectiveFrom: new Date("2035-01-20T00:00:00.000Z") } }), /overlaps/);
});
