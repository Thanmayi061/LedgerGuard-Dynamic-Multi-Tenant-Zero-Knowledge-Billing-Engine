/**
 * Billing & Double-Entry Ledger Service
 *
 * Manages atomic financial transactions, balanced double-entry ledger entries,
 * idempotency replay, and immutable compensating reversals using MongoDB transaction sessions.
 */
import crypto from "node:crypto";
import {
  getBillingTransactionModel,
  getLedgerEntryModel,
  assertMatchingRequestHash
} from "../config/db.js";
import { computeRequestHash } from "../utils/hash.util.js";
import { withLock } from "./redisLock.service.js";

/**
 * Creates an atomic billing transaction and balanced double-entry ledger rows.
 * Uses a Redis distributed lock to serialize concurrent requests on the same key,
 * backed by a MongoDB transaction session and unique idempotencyKey index.
 */
export async function createBillingTransaction(tenantDb, {
  organizationId,
  amountMinor,
  currency = "INR",
  idempotencyKey,
  requestPayload,
  description = "Billing transaction",
  metadata = {}
}) {
  if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw Object.assign(new Error("idempotencyKey is required for billing transactions."), { statusCode: 400 });
  }

  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    throw Object.assign(new Error("amountMinor must be a positive safe integer representing minor currency units (e.g. paise/cents)."), { statusCode: 400 });
  }

  const normalizedCurrency = String(currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw Object.assign(new Error("currency must be a valid 3-letter uppercase currency code (e.g. INR, USD)."), { statusCode: 400 });
  }

  const Tx = getBillingTransactionModel(tenantDb);
  const Ledger = getLedgerEntryModel(tenantDb);
  const cleanIdempotencyKey = idempotencyKey.trim();
  const incomingHash = computeRequestHash(requestPayload);
  const lockKey = `lock:billing:idem:${organizationId}:${cleanIdempotencyKey}`;

  return withLock(lockKey, async () => {
    // 1. Idempotency Check: Inspect if key already exists
    const existingTx = await Tx.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
    if (existingTx) {
      // Check canonical request hash mismatch (throws 409 if hash differs)
      assertMatchingRequestHash(existingTx, incomingHash);

      // If key is currently in progress, reject concurrent duplicate request
      if (existingTx.idempotency?.status === "in_progress") {
        throw Object.assign(
          new Error("A transaction with this idempotency key is currently in progress. Please retry shortly."),
          { statusCode: 409, code: "CONCURRENT_TRANSACTION_IN_PROGRESS" }
        );
      }

      // Return replayable response
      return {
        replay: true,
        transactionId: existingTx.transactionId,
        status: existingTx.status,
        amountMinor: existingTx.amountMinor,
        currency: existingTx.currency,
        reversedAt: existingTx.reversedAt,
        idempotency: existingTx.idempotency,
        createdAt: existingTx.createdAt
      };
    }

    // 2. Prepare transaction and journal identifiers
    const transactionId = `txn_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const journalId = `JRN-${transactionId}`;

    // 3. Execute atomic transaction session
    const session = await tenantDb.startSession();

    try {
      let result = null;

      await session.withTransaction(async () => {
        // Create BillingTransaction document
        const [tx] = await Tx.create([
          {
            transactionId,
            organizationId,
            amountMinor,
            currency: normalizedCurrency,
            status: "pending",
            idempotencyKey: cleanIdempotencyKey,
            requestHash: incomingHash,
            description,
            metadata,
            idempotency: {
              status: "in_progress",
              response: null,
              completedAt: null
            }
          }
        ], { session });

        // Create balanced debit and credit entries
        const debitEntry = {
          organizationId,
          transactionRef: tx._id,
          transactionId,
          journalId,
          accountType: "receivable",
          entryType: "debit",
          amountMinor,
          currency: normalizedCurrency,
          reversalOf: null,
          reversalOfJournalId: null,
          reversalOfTransactionRef: null,
          reversalReason: null
        };

        const creditEntry = {
          organizationId,
          transactionRef: tx._id,
          transactionId,
          journalId,
          accountType: "revenue",
          entryType: "credit",
          amountMinor,
          currency: normalizedCurrency,
          reversalOf: null,
          reversalOfJournalId: null,
          reversalOfTransactionRef: null,
          reversalReason: null
        };

        // In-session invariant balance verification
        const totalDebit = debitEntry.amountMinor;
        const totalCredit = creditEntry.amountMinor;
        if (totalDebit !== totalCredit) {
          throw new Error(`Double-entry balance violation: Total Debits (${totalDebit}) != Total Credits (${totalCredit}).`);
        }

        await Ledger.insertMany([debitEntry, creditEntry], { session });

        // Finalize transaction status and replayable response
        const responsePayload = {
          transactionId,
          organizationId,
          amountMinor,
          currency: normalizedCurrency,
          status: "success",
          journalId
        };

        tx.status = "success";
        tx.idempotency = {
          status: "completed",
          response: responsePayload,
          completedAt: new Date()
        };
        await tx.save({ session });

        result = {
          replay: false,
          ...responsePayload,
          createdAt: tx.createdAt
        };
      });

      return result;
    } catch (error) {
      // If MongoDB duplicate key error occurs during race condition, handle gracefully
      if (error.code === 11000) {
        const racedTx = await Tx.findOne({ idempotencyKey: cleanIdempotencyKey }).lean();
        if (racedTx) {
          assertMatchingRequestHash(racedTx, incomingHash);
          if (racedTx.idempotency?.status === "completed") {
            return { replay: true, ...racedTx.idempotency.response };
          }
        }
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }, 10000, { retries: 3, delayMs: 60 });
}

/**
 * Reverses a successful billing transaction with balanced compensating ledger entries.
 * Original entries are strictly preserved (immutable accounting).
 */
export async function reverseBillingTransaction(tenantDb, {
  transactionId,
  organizationId,
  reason = "Customer refund"
}) {
  if (!transactionId) {
    throw Object.assign(new Error("transactionId is required for reversal."), { statusCode: 400 });
  }

  const cleanTxId = String(transactionId).trim();
  const lockKey = `lock:billing:reverse:${organizationId}:${cleanTxId}`;

  return withLock(lockKey, async () => {
    const Tx = getBillingTransactionModel(tenantDb);
    const Ledger = getLedgerEntryModel(tenantDb);

    const tx = await Tx.findOne({ transactionId: cleanTxId, organizationId });
    if (!tx) {
      throw Object.assign(new Error(`Transaction '${cleanTxId}' not found.`), { statusCode: 404 });
    }

    if (tx.status === "reversed" || tx.reversedAt !== null) {
      throw Object.assign(new Error(`Transaction '${cleanTxId}' has already been reversed at ${tx.reversedAt}.`), {
        statusCode: 409,
        code: "TRANSACTION_ALREADY_REVERSED"
      });
    }

    if (tx.status !== "success") {
      throw Object.assign(new Error(`Cannot reverse transaction with status '${tx.status}'. Only successful transactions may be reversed.`), {
        statusCode: 400,
        code: "INVALID_TRANSACTION_STATUS"
      });
    }

    // Fetch original ledger rows
    const originalRows = await Ledger.find({ transactionRef: tx._id, reversalOf: null }).lean();
    if (originalRows.length === 0) {
      throw new Error(`Integrity error: No ledger rows found for transaction '${cleanTxId}'.`);
    }

    const reversalJournalId = `REV-${originalRows[0].journalId}`;
    const session = await tenantDb.startSession();

    try {
      let reversalResult = null;

      await session.withTransaction(async () => {
        // Mark transaction reversed
        const now = new Date();
        tx.status = "reversed";
        tx.reversedAt = now;
        tx.failureReason = reason.slice(0, 1000);
        await tx.save({ session });

        // Generate compensating entries (swapping debit <-> credit)
        const compensatingEntries = originalRows.map(row => ({
          organizationId: row.organizationId,
          transactionRef: row.transactionRef,
          transactionId: row.transactionId,
          journalId: reversalJournalId,
          accountType: row.accountType,
          entryType: row.entryType === "debit" ? "credit" : "debit", // Swapped!
          amountMinor: row.amountMinor,
          currency: row.currency,
          reversalOf: row._id,
          reversalOfJournalId: row.journalId,
          reversalOfTransactionRef: row.transactionRef,
          reversalReason: reason.slice(0, 500)
        }));

        // Invariant check on compensating entries
        const compDebits = compensatingEntries.filter(e => e.entryType === "debit").reduce((acc, e) => acc + e.amountMinor, 0);
        const compCredits = compensatingEntries.filter(e => e.entryType === "credit").reduce((acc, e) => acc + e.amountMinor, 0);
        if (compDebits !== compCredits) {
          throw new Error(`Reversal balance violation: Compensating Debits (${compDebits}) != Compensating Credits (${compCredits}).`);
        }

        await Ledger.insertMany(compensatingEntries, { session });

        reversalResult = {
          transactionId: tx.transactionId,
          status: "reversed",
          reversedAt: tx.reversedAt,
          reversalJournalId,
          compensatingEntriesCount: compensatingEntries.length,
          amountMinor: tx.amountMinor,
          currency: tx.currency
        };
      });

      return reversalResult;
    } finally {
      await session.endSession();
    }
  }, 10000, { retries: 2, delayMs: 60 });
}

/**
 * Retrieves a transaction and its associated ledger rows.
 */
export async function getTransactionDetails(tenantDb, { transactionId, organizationId }) {
  const Tx = getBillingTransactionModel(tenantDb);
  const Ledger = getLedgerEntryModel(tenantDb);

  const tx = await Tx.findOne({ transactionId, organizationId }).lean();
  if (!tx) {
    throw Object.assign(new Error(`Transaction '${transactionId}' not found.`), { statusCode: 404 });
  }

  const ledgerEntries = await Ledger.find({ transactionRef: tx._id }).sort({ createdAt: 1 }).lean();
  return {
    transaction: tx,
    ledgerEntries
  };
}

/**
 * Lists transactions for a tenant.
 */
export async function listTenantTransactions(tenantDb, { organizationId, status, limit = 50, skip = 0 }) {
  const Tx = getBillingTransactionModel(tenantDb);
  const query = { organizationId };
  if (status) query.status = status;

  return Tx.find(query)
    .sort({ createdAt: -1 })
    .skip(Math.max(0, parseInt(skip, 10) || 0))
    .limit(Math.min(100, Math.max(1, parseInt(limit, 10) || 50)))
    .lean();
}
