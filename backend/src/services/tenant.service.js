/**
 * Tenant Management Service
 *
 * Interacts with platform_db.organizations and provisions tenant databases.
 */
import { getPlatformConnection, Organization, getTenantConnection, getUserModel, getBillingTransactionModel, getLedgerEntryModel, getUsageRecordModel, getPricingPlanModel } from "../config/db.js";

function checkPlatformDbConfigured() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<username>") || uri.includes("placeholder")) {
    throw Object.assign(
      new Error("Platform database is unavailable. MONGODB_URI is unconfigured or in placeholder mode."),
      { statusCode: 503, code: "DATABASE_UNAVAILABLE" }
    );
  }
}

export async function createOrganization({ organizationId, name, email, plan = "starter", databaseName }) {
  checkPlatformDbConfigured();

  if (!organizationId || !name || !email || !databaseName) {
    throw Object.assign(new Error("organizationId, name, email, and databaseName are required."), { statusCode: 400 });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(databaseName)) {
    throw Object.assign(new Error("databaseName must contain only alphanumeric characters, underscores, and hyphens."), { statusCode: 400 });
  }

  const platform = await getPlatformConnection();
  const Org = platform.models.Organization || platform.model("Organization", Organization.schema);

  // Check for uniqueness
  const existing = await Org.findOne({
    $or: [{ organizationId }, { databaseName }]
  }).lean();

  if (existing) {
    if (existing.organizationId === organizationId) {
      throw Object.assign(new Error(`Organization with ID '${organizationId}' already exists.`), { statusCode: 409 });
    }
    throw Object.assign(new Error(`Database name '${databaseName}' is already allocated to another tenant.`), { statusCode: 409 });
  }

  const organization = await Org.create({
    organizationId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    status: "active",
    plan,
    databaseName
  });

  // Provision tenant DB indexes immediately
  try {
    const tenantDb = await getTenantConnection(organizationId);
    await Promise.all([
      getUserModel(tenantDb).createIndexes(),
      getBillingTransactionModel(tenantDb).createIndexes(),
      getLedgerEntryModel(tenantDb).createIndexes(),
      getUsageRecordModel(tenantDb).createIndexes(),
      getPricingPlanModel(tenantDb).createIndexes()
    ]);
  } catch (err) {
    console.warn(`[Tenant Service] Index pre-creation for ${organizationId} deferred or warning:`, err.message);
  }

  return organization;
}

export async function getOrganizationById(organizationId) {
  checkPlatformDbConfigured();

  if (!organizationId) {
    throw Object.assign(new Error("organizationId is required."), { statusCode: 400 });
  }

  const platform = await getPlatformConnection();
  const Org = platform.models.Organization || platform.model("Organization", Organization.schema);
  const org = await Org.findOne({ organizationId }).lean();

  if (!org) {
    throw Object.assign(new Error(`Organization '${organizationId}' not found.`), { statusCode: 404 });
  }

  return org;
}

export async function listOrganizations(filter = {}) {
  checkPlatformDbConfigured();

  const platform = await getPlatformConnection();
  const Org = platform.models.Organization || platform.model("Organization", Organization.schema);
  return Org.find(filter).select("-__v").lean();
}
