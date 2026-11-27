/**
 * Tenant Context Resolver Middleware
 *
 * Resolves the verified organizationId, establishes/retrieves the cached
 * tenant connection via getTenantConnection, attaches it to req.tenantDb,
 * and performs live database verification of active user status and role
 * to prevent trusting stale JWT claims.
 */
import { getTenantConnection, getUserModel } from "../config/db.js";
import { verifyToken } from "../services/auth.service.js";
import { sendError } from "../utils/response.util.js";

export async function resolveTenant(req, res, next) {
  // If an Authorization header is present and req.user is not yet populated, decode token
  if (!req.user && req.headers.authorization?.startsWith("Bearer ")) {
    try {
      const token = req.headers.authorization.split(" ")[1];
      req.user = verifyToken(token);
    } catch {
      // Ignore token parse errors here; authenticate middleware handles strict verification
    }
  }

  // Explicit organization specified in request
  const explicitOrgId =
    req.params.organizationId ||
    req.body?.organizationId ||
    req.headers["x-organization-id"] ||
    req.headers["x-tenant-id"];

  // Prevent cross-tenant tampering: if a client explicitly targets another tenant while authenticated
  if (explicitOrgId && req.user?.organizationId && explicitOrgId.trim() !== req.user.organizationId) {
    return sendError(
      res,
      "Cross-tenant access violation: Requested organization does not match authenticated token claim.",
      403,
      null,
      "TENANT_ACCESS_DENIED"
    );
  }

  // Final resolved tenant ID: token claim takes precedence if no explicit target, else explicit target
  const organizationId = req.user?.organizationId || explicitOrgId;

  if (!organizationId || typeof organizationId !== "string" || !organizationId.trim()) {
    return sendError(
      res,
      "Organization ID is required to resolve tenant context.",
      400,
      null,
      "MISSING_TENANT_ID"
    );
  }

  const cleanOrgId = organizationId.trim();

  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<username>") || uri.includes("placeholder")) {
    return sendError(
      res,
      `Database connection unavailable for organization '${cleanOrgId}'. MONGODB_URI is unconfigured or in placeholder mode.`,
      503,
      null,
      "DATABASE_UNAVAILABLE"
    );
  }

  try {
    const tenantDb = await getTenantConnection(cleanOrgId);
    req.tenantDb = tenantDb;
    req.organizationId = cleanOrgId;

    // Anti-Stale Token Guard: If an authenticated user is calling a tenant endpoint,
    // verify active status and synchronize role directly from the database
    if (req.user?.userId && req.user.organizationId === cleanOrgId) {
      try {
        const User = getUserModel(tenantDb);
        const freshUser = await User.findById(req.user.userId).select("role isActive organizationId").lean();
        if (freshUser) {
          if (!freshUser.isActive) {
            return sendError(res, "User account is deactivated. Access revoked.", 401, null, "ACCOUNT_DEACTIVATED");
          }
          // Synchronize role immediately from database to avoid stale elevated privileges
          req.user.role = freshUser.role;
        }
      } catch (err) {
        // If query fails, proceed with verified token claims
      }
    }

    next();
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return sendError(res, error.message, statusCode, null, statusCode === 404 ? "TENANT_NOT_FOUND" : "TENANT_CONNECTION_ERROR");
  }
}
