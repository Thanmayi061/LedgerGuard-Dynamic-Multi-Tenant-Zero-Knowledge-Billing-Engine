/**
 * Billing & Ledger Routes (/api/v1/billing)
 */
import { Router } from "express";
import {
  createTransaction,
  reverseTransaction,
  getTransaction,
  listTransactions
} from "../controllers/billing.controller.js";
import { authenticate, authorizeRole } from "../middleware/auth.middleware.js";
import { resolveTenant } from "../middleware/tenant.middleware.js";
import { sendError } from "../utils/response.util.js";

const router = Router();

/**
 * Validates transaction payload prior to database resolution.
 */
function validateTransactionInput(req, res, next) {
  const { amountMinor, currency, idempotencyKey } = req.body;

  if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    return sendError(res, "idempotencyKey is required for billing transactions.", 400, null, "MISSING_IDEMPOTENCY_KEY");
  }

  if (amountMinor === undefined || !Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    return sendError(res, "amountMinor must be a positive safe integer representing minor currency units (e.g. paise/cents).", 400, null, "INVALID_AMOUNT");
  }

  const curr = String(currency || "INR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(curr)) {
    return sendError(res, "currency must be a valid 3-letter uppercase currency code (e.g. INR, USD).", 400, null, "INVALID_CURRENCY");
  }

  req.body.currency = curr;
  req.body.idempotencyKey = idempotencyKey.trim();
  next();
}

// All billing endpoints require authentication
router.use(authenticate);

// Transactions endpoints
router.post("/transactions", validateTransactionInput, resolveTenant, createTransaction);
router.get("/transactions", resolveTenant, listTransactions);
router.get("/transactions/:transactionId", resolveTenant, getTransaction);

// Reversal endpoint (role authorization checked before database connection)
router.post("/transactions/:transactionId/reverse", authorizeRole("admin", "manager"), resolveTenant, reverseTransaction);

export default router;
