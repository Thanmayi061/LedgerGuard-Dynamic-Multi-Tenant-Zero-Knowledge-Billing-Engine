/**
 * Pricing Routes (/api/v1/pricing)
 */
import { Router } from "express";
import { createPlan, getActivePlan, listAllPlans } from "../controllers/pricing.controller.js";
import { authenticate, authorizeRole } from "../middleware/auth.middleware.js";
import { resolveTenant } from "../middleware/tenant.middleware.js";
import { sendError } from "../utils/response.util.js";

const router = Router();

function validatePlanInput(req, res, next) {
  const { planCode, name, rates, effectiveFrom } = req.body;
  if (!planCode || typeof planCode !== "string" || !planCode.trim()) {
    return sendError(res, "planCode is required.", 400, null, "MISSING_PLAN_CODE");
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return sendError(res, "name is required.", 400, null, "MISSING_PLAN_NAME");
  }
  if (!Array.isArray(rates) || rates.length === 0) {
    return sendError(res, "rates must be a non-empty array.", 400, null, "MISSING_RATES");
  }
  if (!effectiveFrom) {
    return sendError(res, "effectiveFrom is required.", 400, null, "MISSING_EFFECTIVE_FROM");
  }
  next();
}

router.use(authenticate);

// Creation requires admin role
router.post("/plans", authorizeRole("admin"), validatePlanInput, resolveTenant, createPlan);
router.get("/plans/active", resolveTenant, getActivePlan);
router.get("/plans", resolveTenant, listAllPlans);

export default router;
