/**
 * Redis Distributed Lock Service (Mutex)
 *
 * Implements a distributed lock pattern for serializing sensitive operations
 * (e.g. PricingPlan temporal overlap updates, concurrent billing claims).
 *
 * Uses:
 * 1. SET key uuid PX ttl NX (atomic acquire)
 * 2. Lua script (atomic release only if value matches uuid)
 */
import crypto from "node:crypto";
import { getRedisClient, isInMemoryFallbackActive } from "../config/redis.js";
import { env } from "../config/env.js";

const DEFAULT_TTL_MS = 10000;
const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 50;

// Lua script ensuring only the lock creator can delete the lock
const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function acquireLock(
  lockKey,
  ttlMs = DEFAULT_TTL_MS,
  options = { retries: DEFAULT_RETRIES, delayMs: DEFAULT_RETRY_DELAY_MS }
) {
  // Production security guard: Never silently acquire local in-memory lock in production
  if (env.isProduction && isInMemoryFallbackActive()) {
    const error = new Error("Distributed locking unavailable: In-memory fallback is prohibited in production mode.");
    error.statusCode = 503;
    error.code = "DISTRIBUTED_LOCK_UNAVAILABLE";
    throw error;
  }

  const redis = getRedisClient();
  const lockValue = crypto.randomUUID();
  const retries = options.retries ?? DEFAULT_RETRIES;
  const delayMs = options.delayMs ?? DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await redis.set(lockKey, lockValue, "PX", ttlMs, "NX");
    if (result === "OK" || result === 1) {
      return {
        acquired: true,
        lockKey,
        lockValue,
        expiresAt: Date.now() + ttlMs
      };
    }

    if (attempt < retries) {
      // Exponential backoff with jitter
      const jitter = Math.floor(Math.random() * 20);
      const waitTime = delayMs * Math.pow(1.5, attempt) + jitter;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return {
    acquired: false,
    lockKey,
    lockValue: null
  };
}

export async function releaseLock(lockKey, lockValue) {
  if (!lockKey || !lockValue) return false;
  const redis = getRedisClient();
  try {
    const result = await redis.eval(RELEASE_LOCK_LUA, 1, lockKey, lockValue);
    return result === 1;
  } catch (error) {
    console.error(`[RedisLock] Error releasing lock ${lockKey}:`, error.message);
    return false;
  }
}

/**
 * Executes an async task safely inside a distributed lock.
 */
export async function withLock(lockKey, taskFn, ttlMs = DEFAULT_TTL_MS, options = {}) {
  const lock = await acquireLock(lockKey, ttlMs, options);
  if (!lock.acquired) {
    const error = new Error(`Failed to acquire distributed lock for resource: ${lockKey}`);
    error.statusCode = 409;
    error.code = "LOCK_ACQUISITION_TIMEOUT";
    throw error;
  }

  try {
    return await taskFn();
  } finally {
    await releaseLock(lock.lockKey, lock.lockValue);
  }
}
