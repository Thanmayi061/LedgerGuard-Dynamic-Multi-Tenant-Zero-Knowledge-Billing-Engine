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
