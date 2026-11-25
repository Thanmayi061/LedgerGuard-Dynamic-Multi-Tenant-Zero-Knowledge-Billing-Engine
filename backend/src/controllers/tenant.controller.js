/**
 * Tenant Controller
 */
import { createOrganization, getOrganizationById, listOrganizations } from "../services/tenant.service.js";
import { sendSuccess } from "../utils/response.util.js";

export async function createTenant(req, res, next) {
  try {
    const { organizationId, name, email, plan, databaseName } = req.body;
    const organization = await createOrganization({
      organizationId,
      name,
      email,
      plan,
      databaseName
    });

    return sendSuccess(res, organization, "Organization registered successfully.", 201);
  } catch (error) {
    next(error);
  }
}

export async function getTenant(req, res, next) {
  try {
    const { organizationId } = req.params;
    const organization = await getOrganizationById(organizationId);
    return sendSuccess(res, organization, "Organization retrieved successfully.", 200);
  } catch (error) {
    next(error);
  }
}

export async function listAllTenants(req, res, next) {
  try {
    const organizations = await listOrganizations();
    return sendSuccess(res, organizations, "Organizations retrieved successfully.", 200);
  } catch (error) {
    next(error);
  }
}
