/**
 * Authentication & Authorization Middleware
 */
import { verifyToken } from "../services/auth.service.js";
import { sendError } from "../utils/response.util.js";

/**
 * Validates the asymmetric JWT Bearer token in Authorization header.
 * Attaches decoded user payload to req.user: { userId, email, organizationId, role, isPlatformAdmin }
 */
export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return sendError(res, "Authentication required. Please provide a valid Bearer token.", 401, null, "UNAUTHORIZED");
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return sendError(res, "Authentication token has expired. Please log in again.", 401, null, "TOKEN_EXPIRED");
    }
    return sendError(res, "Invalid authentication token.", 401, null, "INVALID_TOKEN");
  }
}

/**
 * Role-Based Access Control (RBAC) middleware for tenant roles.
 */
export function authorizeRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return sendError(res, "Authentication required prior to authorization check.", 401, null, "UNAUTHORIZED");
    }

    if (!allowedRoles.includes(req.user.role) && !req.user.isPlatformAdmin && req.user.role !== "platform_admin") {
      return sendError(
        res,
        `Access denied. Role '${req.user.role}' is not authorized to perform this operation. Required: ${allowedRoles.join(", ")}`,
        403,
        null,
        "FORBIDDEN"
      );
    }

    next();
  };
}

/**
 * Platform Administration Guard.
 * Restricts platform-wide tenant management strictly to verified platform administrators
 * scoped to organizationId: "platform". Regular tenant administrators are strictly blocked.
 */
export function authorizePlatformAdmin(req, res, next) {
  if (!req.user) {
    return sendError(res, "Authentication required.", 401, null, "UNAUTHORIZED");
  }

  // Trusted source check: MUST be scoped to "platform" and have isPlatformAdmin: true
  const isTrustedPlatformAdmin =
    req.user.organizationId === "platform" &&
    (req.user.isPlatformAdmin === true || req.user.role === "platform_admin");

  if (!isTrustedPlatformAdmin) {
    return sendError(
      res,
      "Access denied. Trusted platform administrator privileges are required.",
      403,
      null,
      "PLATFORM_ADMIN_REQUIRED"
    );
  }

  next();
}
