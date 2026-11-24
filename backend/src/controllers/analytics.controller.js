/**
 * Analytics Controller
 */
import { getFinancialSummary, getUsageAnalytics } from "../services/analytics.service.js";
import { sendSuccess } from "../utils/response.util.js";

export async function getFinancialAnalytics(req, res, next) {
  try {
    const { from, to } = req.query;
    const organizationId = req.organizationId;

    const summary = await getFinancialSummary(req.tenantDb, {
      organizationId,
      from,
      to
    });

    return sendSuccess(res, summary, "Financial summary and trial balance retrieved.", 200);
  } catch (error) {
    next(error);
  }
}

export async function getUsageAnalyticsReport(req, res, next) {
  try {
    const { from, to } = req.query;
    const organizationId = req.organizationId;

    const summary = await getUsageAnalytics(req.tenantDb, {
      organizationId,
      from,
      to
    });

    return sendSuccess(res, summary, "Usage analytics retrieved.", 200);
  } catch (error) {
    next(error);
  }
}
