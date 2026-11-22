import mongoose from "mongoose";
import { Organization } from "./models.js";

const uri = process.env.MONGODB_URI;
const platformDb = process.env.PLATFORM_DB_NAME || "platform_db";
if (!uri) throw new Error("MONGODB_URI is required.");

let platformPromise = null;
let platformConnection = null;
// Values are promises from the instant they are created, so concurrent callers
// share one in-flight connection attempt per tenant database.
const tenantCache = new Map();

const connectionOptions = {
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 45000
};

function watchConnection(connection, onFailure) {
  connection.on("error", error => {
    console.error("MongoDB connection error:", error.message);
  });
  connection.on("disconnected", () => onFailure?.(connection));
}

export async function getPlatformConnection() {
  if (platformConnection?.readyState === 1) return platformConnection;
  if (platformPromise) return platformPromise;

  const pending = mongoose.createConnection(uri, {
    ...connectionOptions,
    dbName: platformDb
  }).asPromise();
  platformPromise = pending;

  try {
    const connection = await pending;
    if (platformPromise !== pending) {
      await connection.close().catch(() => {});
      return getPlatformConnection();
    }
    platformConnection = connection;
    watchConnection(connection, current => {
      if (platformConnection === current) platformConnection = null;
      if (platformPromise === pending) platformPromise = null;
    });
    return connection;
  } catch (error) {
    if (platformPromise === pending) platformPromise = null;
    if (platformConnection?.readyState !== 1) platformConnection = null;
    throw new Error(`Unable to connect to platform database: ${error.message}`, { cause: error });
  }
}

function getOrCreateTenantConnection(databaseName) {
  const cached = tenantCache.get(databaseName);
  if (cached) return cached;

  // Set the promise synchronously before yielding; all concurrent callers now
  // receive the exact same promise and cannot create duplicate pools.
  const pending = mongoose.createConnection(uri, {
    ...connectionOptions,
    dbName: databaseName
  }).asPromise();
  tenantCache.set(databaseName, pending);

  pending.then(connection => {
    if (tenantCache.get(databaseName) !== pending) {
      connection.close().catch(() => {});
      return;
    }
    watchConnection(connection, current => {
      if (tenantCache.get(databaseName) === pending) tenantCache.delete(databaseName);
      current.close().catch(() => {});
    });
  }).catch(() => {
    if (tenantCache.get(databaseName) === pending) tenantCache.delete(databaseName);
  });

  return pending;
}

// Pass only organizationId extracted from a JWT AFTER signature/expiry verification.
export async function getTenantConnection(verifiedOrganizationId) {
  if (typeof verifiedOrganizationId !== "string" || !verifiedOrganizationId.trim()) {
    throw new Error("Verified organizationId is required.");
  }

  const platform = await getPlatformConnection();
  const Org = platform.models.Organization || platform.model("Organization", Organization.schema);
  const org = await Org.findOne({ organizationId: verifiedOrganizationId, status: "active" }).lean();
  if (!org) throw Object.assign(new Error("Organization not found or inactive"), { statusCode: 404 });
  if (typeof org.databaseName !== "string" || !/^[a-zA-Z0-9_-]+$/.test(org.databaseName)) {
    throw new Error("Invalid tenant database mapping.");
  }

  try {
    const tenantPromise = getOrCreateTenantConnection(org.databaseName);
    const connection = await tenantPromise;
    if (connection.readyState === 1) return connection;
    // A connection can disconnect between resolution and use. Evict only the
    // exact promise this caller awaited; never delete a newer replacement.
    if (tenantCache.get(org.databaseName) === tenantPromise) tenantCache.delete(org.databaseName);
    await connection.close().catch(() => {});
    const retryPromise = getOrCreateTenantConnection(org.databaseName);
    const retry = await retryPromise;
    if (retry.readyState !== 1) throw new Error("Tenant connection is not ready.");
    return retry;
  } catch (error) {
    throw new Error(`Unable to connect to tenant database ${org.databaseName}: ${error.message}`, { cause: error });
  }
}

export async function closeDatabaseConnections() {
  const pending = [
    ...(platformPromise ? [platformPromise] : []),
    ...tenantCache.values()
  ];
  const settled = await Promise.allSettled(pending);
  const connections = new Set(settled
    .filter(result => result.status === "fulfilled")
    .map(result => result.value));
  await Promise.all([...connections].map(connection => connection.close().catch(() => {})));
  tenantCache.clear();
  platformConnection = null;
  platformPromise = null;
}
