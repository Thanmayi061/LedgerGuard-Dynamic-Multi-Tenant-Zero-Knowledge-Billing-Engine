/**
 * Pricing Controller
 */
import { createPricingPlan, getActivePricingPlan, listPricingPlans } from "../services/pricing.service.js";
import { sendSuccess } from "../utils/response.util.js";

export async function createPlan(req, res, next) {
  try {
    const { planCode, version, name, rates, effectiveFrom, effectiveTo, isActive } = req.body;
    const organizationId = req.organizationId;

    const plan = await createPricingPlan(req.tenantDb, {
      organizationId,
      planCode,
      version,
      name,
      rates,
      effectiveFrom,
      effectiveTo,
      isActive
    });

    return sendSuccess(res, plan, "Pricing plan created successfully.", 201);
  } catch (error) {
    next(error);
  }
}

export async function getActivePlan(req, res, next) {
  try {
    const { planCode, atDate } = req.query;
    const plan = await getActivePricingPlan(req.tenantDb, {
      planCode,
      atDate: atDate ? new Date(atDate) : new Date()
    });

    return sendSuccess(res, plan, "Active pricing plan retrieved.", 200);
  } catch (error) {
    next(error);
  }
}

export async function listAllPlans(req, res, next) {
  try {
    const { planCode, isActive } = req.query;
    const plans = await listPricingPlans(req.tenantDb, {
      planCode,
      isActive
    });

    return sendSuccess(res, plans, "Pricing plans retrieved.", 200);
  } catch (error) {
    next(error);
  }
}
