import test from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "../../src/middleware/rateLimiter.middleware.js";
import { getRedisClient } from "../../src/config/redis.js";

test("Rate Limiter Middleware: tracks request count and sets rate limit headers", async () => {
  const limiter = createRateLimiter({
    windowSeconds: 30,
    maxRequests: 3,
    keyPrefix: "rl:unit_test_1"
  });

  const mockReq = {
    organizationId: "org_test_rate",
    ip: "192.168.1.101"
  };

  const headers = {};
  const mockRes = {
    setHeader(name, val) { headers[name] = val; }
  };

  let nextCalled = 0;
  const next = () => { nextCalled++; };

  // First request
  await limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, 1);
  assert.equal(headers["X-RateLimit-Limit"], 3);
  assert.equal(headers["X-RateLimit-Remaining"], 2);

  // Second request
  await limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, 2);
  assert.equal(headers["X-RateLimit-Remaining"], 1);

  // Third request (limit reached)
  await limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, 3);
  assert.equal(headers["X-RateLimit-Remaining"], 0);

  // Clean up
  const redis = getRedisClient();
  await redis.del("rl:unit_test_1:org_test_rate:192.168.1.101");
});

test("Rate Limiter Middleware: returns HTTP 429 when limit is exceeded", async () => {
  const limiter = createRateLimiter({
    windowSeconds: 30,
    maxRequests: 1,
    keyPrefix: "rl:unit_test_exceed"
  });

  const mockReq = {
    organizationId: "org_exceed",
    ip: "10.0.0.5"
  };

  let statusCode = null;
  let responseData = null;
  const headers = {};

  const mockRes = {
    setHeader(name, val) { headers[name] = val; },
    status(code) {
      statusCode = code;
      return {
        json(data) { responseData = data; }
      };
    }
  };

  let nextCalled = 0;
  const next = () => { nextCalled++; };

  // Request 1: allowed
  await limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, 1);

  // Request 2: blocked with 429
  await limiter(mockReq, mockRes, next);
  assert.equal(nextCalled, 1, "next() should not be called when rate limited");
  assert.equal(statusCode, 429);
  assert.equal(responseData.code, "TOO_MANY_REQUESTS");
  assert.ok(headers["Retry-After"] !== undefined);

  // Clean up
  const redis = getRedisClient();
  await redis.del("rl:unit_test_exceed:org_exceed:10.0.0.5");
});
