/**
 * Tenant Management Routes (/api/v1/tenants)
 */
import { Router } from "express";
import { createTenant, getTenant, listAllTenants } from "../controllers/tenant.controller.js";
import { authenticate, authorizePlatformAdmin } from "../middleware/auth.middleware.js";

const router = Router();

// Platform admin endpoints (strictly protected: regular tenant admins are denied)
router.post("/", authenticate, authorizePlatformAdmin, createTenant);
router.get("/", authenticate, authorizePlatformAdmin, listAllTenants);
router.get("/:organizationId", authenticate, getTenant);

export default router;
