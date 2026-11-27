/**
 * Authentication Controller
 */
import { registerUser, loginUser } from "../services/auth.service.js";
import { getUserModel } from "../config/db.js";
import { sendSuccess, sendError } from "../utils/response.util.js";

export async function register(req, res, next) {
  try {
    const { name, email, password, role } = req.body;
    const organizationId = req.organizationId;
    const creatorRole = req.user?.role || "admin";

    if (!req.tenantDb) {
      return sendError(res, "Tenant database is not connected.", 500, null, "DATABASE_ERROR");
    }

    const result = await registerUser(req.tenantDb, {
      organizationId,
      name,
      email,
      password,
      role,
      creatorRole
    });

    return sendSuccess(res, result, "User registered successfully.", 201);
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const organizationId = req.organizationId;

    if (!req.tenantDb) {
      return sendError(res, "Tenant database is not connected.", 500, null, "DATABASE_ERROR");
    }

    const result = await loginUser(req.tenantDb, {
      email,
      password,
      organizationId
    });

    return sendSuccess(res, result, "Login successful.", 200);
  } catch (error) {
    next(error);
  }
}

export async function getProfile(req, res, next) {
  try {
    if (!req.user) {
      return sendError(res, "User is not authenticated.", 401, null, "UNAUTHORIZED");
    }

    // If tenantDb is available, fetch full user profile
    if (req.tenantDb) {
      const User = getUserModel(req.tenantDb);
      const user = await User.findById(req.user.userId).lean();
      if (user) {
        return sendSuccess(res, {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
          isActive: user.isActive,
          createdAt: user.createdAt
        }, "Profile retrieved successfully.");
      }
    }

    // Fallback to token claims if database record is unqueryable
    return sendSuccess(res, req.user, "Profile retrieved from token claims.");
  } catch (error) {
    next(error);
  }
}
