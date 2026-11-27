/**
 * Database Adapter & Bridge
 *
 * Imports directly from the teammate's existing MongoDB implementation
 * (ledgerguard-mongodb-db Revision 3) without duplicating schemas or
 * connection management code.
 */
import "./env.js";

import {
  getPlatformConnection,
  getTenantConnection,
  closeDatabaseConnections
} from "../../../database/src/connections.js";

import {
  Organization,
  getUserModel,
  getBillingTransactionModel,
  getLedgerEntryModel,
  getUsageRecordModel,
  getPricingPlanModel
} from "../../../database/src/models.js";

import {
  assertMatchingRequestHash
} from "../../../database/src/idempotency.js";

/**
 * Health check helper for the database tier.
 * Safely inspects the platform connection status without throwing when unconfigured.
 */
export async function checkDatabaseHealth() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<username>") || uri.includes("placeholder")) {
    return {
      status: "unconfigured",
      platformDb: process.env.PLATFORM_DB_NAME || "platform_db",
      message: "MONGODB_URI is not configured with live credentials."
    };
  }

  try {
    const platform = await getPlatformConnection();
    const readyState = platform.readyState;
    const states = { 0: "disconnected", 1: "connected", 2: "connecting", 3: "disconnecting" };

    let pingOk = false;
    let latencyMs = null;
    if (readyState === 1 && platform.db) {
      const start = Date.now();
      await platform.db.command({ ping: 1 });
      latencyMs = Date.now() - start;
      pingOk = true;
    }

    return {
      status: pingOk ? "connected" : (states[readyState] || "unknown"),
      platformDb: platform.name,
      readyState,
      ping: pingOk ? "pong" : "unresponsive",
      latencyMs
    };
  } catch (error) {
    return {
      status: "error",
      message: error.message
    };
  }
}

/**
 * Health check helper for tenant databases (e.g. Acme and Zenith).
 */
export async function checkTenantDatabasesHealth(orgIds = ["org_acme_001", "org_zenith_002"]) {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes("<username>") || uri.includes("placeholder")) {
    return {
      status: "unconfigured",
      tenants: orgIds.map(orgId => ({ organizationId: orgId, status: "unconfigured" })),
      message: "MONGODB_URI is not configured with live credentials."
    };
  }

  const results = [];
  for (const orgId of orgIds) {
    try {
      const conn = await getTenantConnection(orgId);
      const readyState = conn.readyState;
      let pingOk = false;
      let latencyMs = null;
      if (readyState === 1 && conn.db) {
        const start = Date.now();
        await conn.db.command({ ping: 1 });
        latencyMs = Date.now() - start;
        pingOk = true;
      }
      results.push({
        organizationId: orgId,
        databaseName: conn.name,
        status: pingOk ? "connected" : "unresponsive",
        readyState,
        latencyMs
      });
    } catch (err) {
      results.push({
        organizationId: orgId,
        status: "error",
        message: err.message
      });
    }
  }

  const allConnected = results.every(r => r.status === "connected");
  return {
    status: allConnected ? "connected" : "degraded",
    tenants: results
  };
}

export {
  getPlatformConnection,
  getTenantConnection,
  closeDatabaseConnections,
  Organization,
  getUserModel,
  getBillingTransactionModel,
  getLedgerEntryModel,
  getUsageRecordModel,
  getPricingPlanModel,
  assertMatchingRequestHash
};
