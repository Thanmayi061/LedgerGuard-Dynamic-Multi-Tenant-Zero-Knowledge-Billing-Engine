/**
 * Usage Metering Service
 *
 * Implements scaled integer representation for continuous metrics
 * and half-up rounding for minor currency cost calculations.
 */
import { getUsageRecordModel } from "../config/db.js";

const VALID_METRIC_TYPES = ["api_requests", "compute_units", "storage"];

/**
 * Calculates total cost in minor currency units using half-up rounding.
 * (e.g. 275 / 100 * 10 = 27.5 -> 28 minor units)
 */
export function calculateUsageCostMinor(quantityScaled, quantityScale, unitPriceMinor) {
  if (!Number.isSafeInteger(quantityScaled) || quantityScaled < 0) {
    throw new Error("quantityScaled must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(quantityScale) || quantityScale < 1) {
    throw new Error("quantityScale must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new Error("unitPriceMinor must be a non-negative safe integer.");
  }

  // Exact math: (quantityScaled * unitPriceMinor) / quantityScale with half-up rounding
  const rawCost = (quantityScaled * unitPriceMinor) / quantityScale;
  return Math.round(rawCost);
}

export async function recordUsage(tenantDb, {
  organizationId,
  eventId,
  metricType,
  quantityScaled,
  quantityScale = 1,
  unit,
  unitPriceMinor,
  currency = "INR",
  recordedAt = new Date(),
  metadata = {}
}) {
  if (!eventId || typeof eventId !== "string" || !eventId.trim()) {
    throw Object.assign(new Error("eventId is required for usage records."), { statusCode: 400 });
  }

  if (!VALID_METRIC_TYPES.includes(metricType)) {
    throw Object.assign(
      new Error(`Invalid metricType '${metricType}'. Allowed types: ${VALID_METRIC_TYPES.join(", ")}.`),
      { statusCode: 400, code: "INVALID_METRIC_TYPE" }
    );
  }

  if (!Number.isSafeInteger(quantityScaled) || quantityScaled < 0) {
    throw Object.assign(new Error("quantityScaled must be a non-negative safe integer."), { statusCode: 400 });
  }

  if (!Number.isSafeInteger(quantityScale) || quantityScale < 1) {
    throw Object.assign(new Error("quantityScale must be a positive safe integer (>= 1)."), { statusCode: 400 });
  }

  if (!unit || typeof unit !== "string" || !unit.trim()) {
    throw Object.assign(new Error("unit is required (e.g. 'request', 'unit', 'GB-day')."), { statusCode: 400 });
  }

  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw Object.assign(new Error("unitPriceMinor must be a non-negative safe integer."), { statusCode: 400 });
  }

  const normalizedCurrency = String(currency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    throw Object.assign(new Error("currency must be a 3-letter uppercase code (e.g. INR, USD)."), { statusCode: 400 });
  }

  const cleanEventId = eventId.trim();
  const totalCostMinor = calculateUsageCostMinor(quantityScaled, quantityScale, unitPriceMinor);
  const Usage = getUsageRecordModel(tenantDb);

  // Check idempotency by unique eventId
  const existing = await Usage.findOne({ eventId: cleanEventId }).lean();
  if (existing) {
    return {
      replay: true,
      ...existing,
      actualQuantity: existing.quantityScaled / existing.quantityScale
    };
  }

  const record = await Usage.create({
    organizationId,
    eventId: cleanEventId,
    metricType,
    quantityScaled,
    quantityScale,
    unit: unit.trim(),
    unitPriceMinor,
    totalCostMinor,
    currency: normalizedCurrency,
    recordedAt: new Date(recordedAt),
    metadata
  });

  return {
    replay: false,
    eventId: record.eventId,
    organizationId: record.organizationId,
    metricType: record.metricType,
    quantityScaled: record.quantityScaled,
    quantityScale: record.quantityScale,
    actualQuantity: record.quantityScaled / record.quantityScale,
    unit: record.unit,
    unitPriceMinor: record.unitPriceMinor,
    totalCostMinor: record.totalCostMinor,
    currency: record.currency,
    recordedAt: record.recordedAt
  };
}

export async function aggregateUsage(tenantDb, { organizationId, metricType, from, to }) {
  const Usage = getUsageRecordModel(tenantDb);
  const match = { organizationId };

  if (metricType) match.metricType = metricType;
  if (from || to) {
    match.recordedAt = {};
    if (from) match.recordedAt.$gte = new Date(from);
    if (to) match.recordedAt.$lte = new Date(to);
  }

  const aggregation = await Usage.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$metricType",
        totalCostMinor: { $sum: "$totalCostMinor" },
        totalScaledQuantity: { $sum: "$quantityScaled" },
        eventCount: { $sum: 1 },
        currency: { $first: "$currency" },
        unit: { $first: "$unit" }
      }
    },
    { $sort: { _id: 1 } }
  ]);

  return aggregation.map(item => ({
    metricType: item._id,
    eventCount: item.eventCount,
    totalCostMinor: item.totalCostMinor,
    currency: item.currency,
    unit: item.unit
  }));
}
