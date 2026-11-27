import test from "node:test";
import assert from "node:assert/strict";

import {
  acquireLock,
  releaseLock,
  withLock
} from "../../src/services/redisLock.service.js";

import { getRedisClient } from "../../src/config/redis.js";

test("Redis Lock: acquires and releases a distributed mutex lock", async () => {
  const lockKey = "lock:test_resource_1";
  const lock = await acquireLock(lockKey, 5000);

  assert.equal(lock.acquired, true);
  assert.ok(lock.lockValue);

  const released = await releaseLock(lockKey, lock.lockValue);
  assert.equal(released, true);
});

test("Redis Lock: prevents concurrent acquisition for the same key", async () => {
  const lockKey = "lock:concurrent_test";
  const lock1 = await acquireLock(lockKey, 5000, { retries: 0 });
  assert.equal(lock1.acquired, true);

  // Second acquisition attempt without retries should fail
  const lock2 = await acquireLock(lockKey, 5000, { retries: 0 });
  assert.equal(lock2.acquired, false);
  assert.equal(lock2.lockValue, null);

  // After lock1 releases, lock2 can be acquired
  await releaseLock(lockKey, lock1.lockValue);
  const lock3 = await acquireLock(lockKey, 5000, { retries: 0 });
  assert.equal(lock3.acquired, true);

  await releaseLock(lockKey, lock3.lockValue);
});

test("Redis Lock: releasing with wrong lockValue fails (safe release guard)", async () => {
  const lockKey = "lock:safe_release_test";
  const lock = await acquireLock(lockKey, 5000);
  assert.equal(lock.acquired, true);

  // Attempt release with forged lockValue
  const releasedWrong = await releaseLock(lockKey, "wrong-uuid-value");
  assert.equal(releasedWrong, false);

  // The lock is still held
  const lockClient = getRedisClient();
  const current = await lockClient.get(lockKey);
  assert.equal(current, lock.lockValue);

  // Proper release succeeds
  const releasedOk = await releaseLock(lockKey, lock.lockValue);
  assert.equal(releasedOk, true);
});

test("Redis Lock: withLock wrapper executes task and releases lock automatically", async () => {
  const lockKey = "lock:with_lock_test";
  let executed = false;

  const result = await withLock(lockKey, async () => {
    executed = true;
    return "computed_value";
  }, 3000);

  assert.equal(executed, true);
  assert.equal(result, "computed_value");

  // Lock must be free after execution
  const lockAfter = await acquireLock(lockKey, 1000, { retries: 0 });
  assert.equal(lockAfter.acquired, true);
  await releaseLock(lockKey, lockAfter.lockValue);
});

test("Redis Lock: in-memory fallback is prohibited in production mode", async () => {
  const { env } = await import("../../src/config/env.js");
  const originalEnv = env.isProduction;

  try {
    env.isProduction = true;
    await assert.rejects(
      () => acquireLock("lock:prod_test", 1000),
      err => err.statusCode === 503 && err.code === "DISTRIBUTED_LOCK_UNAVAILABLE"
    );
  } finally {
    env.isProduction = originalEnv;
  }
});
