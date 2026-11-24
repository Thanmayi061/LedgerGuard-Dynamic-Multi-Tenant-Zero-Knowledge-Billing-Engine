/**
 * Usage Controller
 */
import { recordUsage, aggregateUsage } from "../services/usage.service.js";
import { sendSuccess } from "../utils/response.util.js";

export async function createUsageEvent(req, res, next) {
  try {
    const {
      eventId,
      metricType,
      quantityScaled,
      quantityScale,
      unit,
      unitPriceMinor,
      currency,
      recordedAt,
      metadata
    } = req.body;
    const organizationId = req.organizationId;

    const result = await recordUsage(req.tenantDb, {
      organizationId,
      eventId,
      metricType,
      quantityScaled,
      quantityScale,
      unit,
      unitPriceMinor,
      currency,
      recordedAt,
      metadata
    });

    const statusCode = result.replay ? 200 : 201;
    const message = result.replay
      ? "Idempotent replay: Usage record already recorded."
      : "Usage event recorded successfully.";

    return sendSuccess(res, result, message, statusCode);
  } catch (error) {
    next(error);
  }
}

export async function getUsageSummary(req, res, next) {
  try {
    const { metricType, from, to } = req.query;
    const organizationId = req.organizationId;

    const summary = await aggregateUsage(req.tenantDb, {
      organizationId,
      metricType,
      from,
      to
    });

    return sendSuccess(res, summary, "Usage summary retrieved.", 200);
  } catch (error) {
    next(error);
  }
}
