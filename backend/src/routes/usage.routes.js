/**
 * Usage Routes (/api/v1/usage)
 */
import { Router } from "express";
import { createUsageEvent, getUsageSummary } from "../controllers/usage.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { resolveTenant } from "../middleware/tenant.middleware.js";
import { sendError } from "../utils/response.util.js";

const router = Router();

function validateUsageInput(req, res, next) {
  const { eventId, metricType, quantityScaled, unit, unitPriceMinor } = req.body;
  if (!eventId || typeof eventId !== "string" || !eventId.trim()) {
    return sendError(res, "eventId is required.", 400, null, "MISSING_EVENT_ID");
  }
  if (!metricType) {
    return sendError(res, "metricType is required.", 400, null, "MISSING_METRIC_TYPE");
  }
  if (quantityScaled === undefined || !Number.isSafeInteger(quantityScaled) || quantityScaled < 0) {
    return sendError(res, "quantityScaled must be a non-negative safe integer.", 400, null, "INVALID_QUANTITY");
  }
  if (!unit) {
    return sendError(res, "unit is required.", 400, null, "MISSING_UNIT");
  }
  if (unitPriceMinor === undefined || !Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    return sendError(res, "unitPriceMinor must be a non-negative safe integer.", 400, null, "INVALID_UNIT_PRICE");
  }
  next();
}

router.use(authenticate);

router.post("/events", validateUsageInput, resolveTenant, createUsageEvent);
router.get("/summary", resolveTenant, getUsageSummary);

export default router;
