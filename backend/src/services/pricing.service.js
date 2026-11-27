/**
 * Pricing Engine Service
 *
 * Implements versioned pricing plans with Redis-locked temporal overlap guards
 * protecting the database's [effectiveFrom, effectiveTo) non-overlap invariant.
 */
import { getPricingPlanModel } from "../config/db.js";
import { withLock } from "./redisLock.service.js";

/**
 * Creates a versioned pricing plan.
 * Serialized via a Redis distributed lock to prevent concurrent date-range race conditions.
 */
export async function createPricingPlan(tenantDb, {
  organizationId,
  planCode,
  version = 1,
  name,
  rates,
  effectiveFrom,
  effectiveTo = null,
  isActive = true
}) {
  if (!planCode || typeof planCode !== "string" || !planCode.trim()) {
    throw Object.assign(new Error("planCode is required."), { statusCode: 400 });
  }

  if (!Number.isSafeInteger(version) || version < 1) {
    throw Object.assign(new Error("version must be a positive safe integer (>= 1)."), { statusCode: 400 });
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    throw Object.assign(new Error("name is required."), { statusCode: 400 });
  }

  if (!Array.isArray(rates) || rates.length === 0) {
    throw Object.assign(new Error("rates must be a non-empty array of rate definitions."), { statusCode: 400 });
  }

  const cleanPlanCode = planCode.trim();
  const lockKey = `lock:pricing:${organizationId}:${cleanPlanCode}`;

  return withLock(lockKey, async () => {
    const Plan = getPricingPlanModel(tenantDb);

    // Validate that { planCode, version } is unique
    const existingVersion = await Plan.findOne({ planCode: cleanPlanCode, version }).lean();
    if (existingVersion) {
      throw Object.assign(
        new Error(`Pricing plan '${cleanPlanCode}' version ${version} already exists.`),
        { statusCode: 409, code: "DUPLICATE_PLAN_VERSION" }
      );
    }

    // Instantiating Mongoose document triggers pre("validate") validateNoOverlappingPricingPeriods hook
    const plan = new Plan({
      planCode: cleanPlanCode,
      version,
      name: name.trim(),
      rates,
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      isActive
    });

    await plan.save();
    return plan.toObject();
  }, 10000, { retries: 3, delayMs: 80 });
}

export async function getActivePricingPlan(tenantDb, { planCode, atDate = new Date() }) {
  if (!planCode) {
    throw Object.assign(new Error("planCode is required."), { statusCode: 400 });
  }

  const Plan = getPricingPlanModel(tenantDb);
  const targetDate = new Date(atDate);

  const plan = await Plan.findOne({
    planCode: planCode.trim(),
    isActive: true,
    effectiveFrom: { $lte: targetDate },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gt: targetDate } }
    ]
  }).sort({ version: -1 }).lean();

  if (!plan) {
    throw Object.assign(
      new Error(`No active pricing plan found for '${planCode}' at ${targetDate.toISOString()}.`),
      { statusCode: 404, code: "PRICING_PLAN_NOT_FOUND" }
    );
  }

  return plan;
}

export async function listPricingPlans(tenantDb, { planCode, isActive }) {
  const Plan = getPricingPlanModel(tenantDb);
  const query = {};
  if (planCode) query.planCode = planCode.trim();
  if (isActive !== undefined) query.isActive = Boolean(isActive);

  return Plan.find(query).sort({ planCode: 1, version: -1 }).lean();
}
