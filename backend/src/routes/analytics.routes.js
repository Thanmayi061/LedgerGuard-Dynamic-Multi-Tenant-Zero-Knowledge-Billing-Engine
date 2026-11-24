/**
 * Analytics Routes (/api/v1/analytics)
 */
import { Router } from "express";
import { getFinancialAnalytics, getUsageAnalyticsReport } from "../controllers/analytics.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { resolveTenant } from "../middleware/tenant.middleware.js";

const router = Router();

router.use(authenticate);
router.use(resolveTenant);

router.get("/financial", getFinancialAnalytics);
router.get("/usage", getUsageAnalyticsReport);

export default router;
