/**
 * Authentication Routes (/api/v1/auth)
 */
import { Router } from "express";
import { register, login, getProfile } from "../controllers/auth.controller.js";
import { authenticate, authorizeRole } from "../middleware/auth.middleware.js";
import { resolveTenant } from "../middleware/tenant.middleware.js";
import { sendError } from "../utils/response.util.js";

const router = Router();

/**
 * Registration guard: Unauthenticated public registration into existing organizations
 * is prohibited to prevent unauthorized account injection.
 * Only authenticated tenant admins/managers or authorized onboarding processes may register users.
 */
function requireRegistrationAuthorization(req, res, next) {
  if (!req.user) {
    return sendError(
      res,
      "Unauthorized registration: Public user creation is disabled. An authorized administrator or manager must perform registration.",
      403,
      null,
      "REGISTRATION_UNAUTHORIZED"
    );
  }
  next();
}

/**
 * Privilege Escalation Guard
 * Managers are strictly restricted to creating 'member' accounts.
 */
function preventRoleEscalation(req, res, next) {
  const targetRole = String(req.body?.role || "member").trim().toLowerCase();
  if (req.user?.role === "manager" && targetRole !== "member") {
    return sendError(
      res,
      "Privilege escalation denied: Managers may only register users with the 'member' role.",
      403,
      null,
      "ROLE_ESCALATION_DENIED"
    );
  }
  next();
}

// Protected user registration (requires active tenant admin or manager authorization)
router.post(
  "/register",
  authenticate,
  requireRegistrationAuthorization,
  authorizeRole("admin", "manager"),
  preventRoleEscalation,
  resolveTenant,
  register
);

// Public tenant login
router.post("/login", resolveTenant, login);

// Authenticated user profile
router.get("/me", authenticate, getProfile);

export default router;
