/**
 * Billing Controller
 */
import {
  createBillingTransaction,
  reverseBillingTransaction,
  getTransactionDetails,
  listTenantTransactions
} from "../services/billing.service.js";
import { sendSuccess } from "../utils/response.util.js";

export async function createTransaction(req, res, next) {
  try {
    const { amountMinor, currency, idempotencyKey, description, metadata } = req.body;
    const organizationId = req.organizationId;

    const result = await createBillingTransaction(req.tenantDb, {
      organizationId,
      amountMinor,
      currency,
      idempotencyKey,
      requestPayload: req.body,
      description,
      metadata
    });

    const statusCode = result.replay ? 200 : 201;
    const message = result.replay
      ? "Idempotent replay: Transaction already completed."
      : "Billing transaction created and balanced in ledger.";

    return sendSuccess(res, result, message, statusCode);
  } catch (error) {
    next(error);
  }
}

export async function reverseTransaction(req, res, next) {
  try {
    const { transactionId } = req.params;
    const { reason } = req.body;
    const organizationId = req.organizationId;

    const result = await reverseBillingTransaction(req.tenantDb, {
      transactionId,
      organizationId,
      reason
    });

    return sendSuccess(res, result, "Transaction reversed successfully with balanced compensating entries.", 200);
  } catch (error) {
    next(error);
  }
}

export async function getTransaction(req, res, next) {
  try {
    const { transactionId } = req.params;
    const organizationId = req.organizationId;

    const result = await getTransactionDetails(req.tenantDb, {
      transactionId,
      organizationId
    });

    return sendSuccess(res, result, "Transaction details retrieved.", 200);
  } catch (error) {
    next(error);
  }
}

export async function listTransactions(req, res, next) {
  try {
    const { status, limit, skip } = req.query;
    const organizationId = req.organizationId;

    const transactions = await listTenantTransactions(req.tenantDb, {
      organizationId,
      status,
      limit,
      skip
    });

    return sendSuccess(res, transactions, "Transactions retrieved.", 200);
  } catch (error) {
    next(error);
  }
}
