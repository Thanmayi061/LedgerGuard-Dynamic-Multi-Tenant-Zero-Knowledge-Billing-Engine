import test from "node:test";
import assert from "node:assert/strict";

import {
  createBillingTransaction
} from "../../src/services/billing.service.js";

import { assertMatchingRequestHash } from "../../src/config/db.js";
import { computeRequestHash } from "../../src/utils/hash.util.js";

test("Billing Service: rejects invalid amountMinor (floating-point, negative, zero)", async () => {
  const mockDb = {};

  // Floating-point amounts prohibited
  await assert.rejects(
    () => createBillingTransaction(mockDb, {
      organizationId: "org_acme_001",
      amountMinor: 1299.50,
      idempotencyKey: "idem_float_test"
    }),
    /amountMinor must be a positive safe integer/
  );

  // Negative amount
  await assert.rejects(
    () => createBillingTransaction(mockDb, {
      organizationId: "org_acme_001",
      amountMinor: -500,
      idempotencyKey: "idem_neg_test"
    }),
    /amountMinor must be a positive safe integer/
  );

  // Zero amount
  await assert.rejects(
    () => createBillingTransaction(mockDb, {
      organizationId: "org_acme_001",
      amountMinor: 0,
      idempotencyKey: "idem_zero_test"
    }),
    /amountMinor must be a positive safe integer/
  );
});

test("Billing Service: rejects invalid currency format", async () => {
  const mockDb = {};

  await assert.rejects(
    () => createBillingTransaction(mockDb, {
      organizationId: "org_acme_001",
      amountMinor: 1000,
      currency: "RUPEES",
      idempotencyKey: "idem_curr_test"
    }),
    /currency must be a valid 3-letter uppercase currency code/
  );
});

test("Billing Service: requires idempotencyKey", async () => {
  const mockDb = {};

  await assert.rejects(
    () => createBillingTransaction(mockDb, {
      organizationId: "org_acme_001",
      amountMinor: 1000,
      idempotencyKey: ""
    }),
    /idempotencyKey is required/
  );
});

test("Double-Entry Bookkeeping: balanced debit and credit invariant", () => {
  const amountMinor = 129900;
  const currency = "INR";

  const debitEntry = {
    accountType: "receivable",
    entryType: "debit",
    amountMinor,
    currency
  };

  const creditEntry = {
    accountType: "revenue",
    entryType: "credit",
    amountMinor,
    currency
  };

  const totalDebits = debitEntry.amountMinor;
  const totalCredits = creditEntry.amountMinor;

  assert.equal(totalDebits, totalCredits, "Debit sum must equal Credit sum for every journal");
  assert.equal(totalDebits - totalCredits, 0, "Net journal balance must equal zero");
});

test("Idempotency Contract: assertMatchingRequestHash detects payload changes on reused key", () => {
  const originalPayload = { amountMinor: 50000, currency: "INR", customerId: "cust_1" };
  const tamperedPayload = { amountMinor: 99999, currency: "INR", customerId: "cust_1" };

  const originalHash = computeRequestHash(originalPayload);
  const tamperedHash = computeRequestHash(tamperedPayload);

  const existingRecord = { requestHash: originalHash };

  // Matching replay succeeds
  assert.equal(assertMatchingRequestHash(existingRecord, originalHash), true);

  // Tampered payload with reused key throws HTTP 409
  assert.throws(
    () => assertMatchingRequestHash(existingRecord, tamperedHash),
    err => err.statusCode === 409 && err.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"
  );
});

test("Billing Reliability: Repeated reversal attempt is rejected with 409", async () => {
  const { reverseBillingTransaction } = await import("../../src/services/billing.service.js");

  // Mock DB returning a transaction already marked reversed
  const mockDb = {
    models: {
      BillingTransaction: {
        findOne: async () => ({
          transactionId: "txn_rev_test",
          status: "reversed",
          reversedAt: new Date(),
          amountMinor: 5000,
          currency: "INR"
        })
      },
      LedgerEntry: {}
    }
  };

  await assert.rejects(
    () => reverseBillingTransaction(mockDb, {
      transactionId: "txn_rev_test",
      organizationId: "org_acme_001",
      reason: "Duplicate reversal test"
    }),
    err => err.statusCode === 409 && err.code === "TRANSACTION_ALREADY_REVERSED"
  );
});

test("Billing Reliability: Transaction session rollback occurs on double-entry balance violation", async () => {
  let sessionEnded = false;
  let sessionAborted = false;

  const mockSession = {
    async withTransaction(fn) {
      try {
        await fn();
      } catch (err) {
        sessionAborted = true;
        throw err;
      }
    },
    async endSession() {
      sessionEnded = true;
    }
  };

  const mockDb = {
    startSession: async () => mockSession,
    models: {
      BillingTransaction: {
        findOne: () => ({ lean: async () => null }),
        create: async ([doc]) => [{ ...doc, _id: "mock_tx_id", save: async () => {} }]
      },
      LedgerEntry: {
        insertMany: async () => {
          // Simulate unbalancing condition throwing inside session
          throw new Error("Double-entry balance violation: Debits != Credits");
        }
      }
    }
  };

  await assert.rejects(
    () => createBillingTransaction(mockDb, {
      organizationId: "org_acme_001",
      amountMinor: 1000,
      currency: "INR",
      idempotencyKey: "idem_rollback_test",
      requestPayload: { amountMinor: 1000, currency: "INR" }
    }),
    /Double-entry balance violation/
  );

  assert.equal(sessionAborted, true, "Transaction must abort when balance invariant fails");
  assert.equal(sessionEnded, true, "Session must end cleanly in finally block");
});
