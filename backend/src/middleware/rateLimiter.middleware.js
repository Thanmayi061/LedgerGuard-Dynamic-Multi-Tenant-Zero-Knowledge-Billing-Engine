/**
 * Redis-Backed Rate Limiting Middleware
 *
 * Implements a fixed-window / sliding-window counter tracking request frequency
 * scoped by tenant and client IP: rl:{tenantId || "anon"}:{ip}
 */
import { getRedisClient } from "../config/redis.js";
import { sendError } from "../utils/response.util.js";

export function createRateLimiter(options = {}) {
  const windowSeconds = options.windowSeconds || 60;
  const maxRequests = options.maxRequests || 100;
  const keyPrefix = options.keyPrefix || "rl";

  return async function rateLimiter(req, res, next) {
    const redis = getRedisClient();
    const tenantScope = req.organizationId || req.user?.organizationId || "anon";
    const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
    const lockKey = `${keyPrefix}:${tenantScope}:${clientIp}`;

    try {
      const current = await redis.incr(lockKey);
      if (current === 1) {
        await redis.expire(lockKey, windowSeconds);
      }

      const ttl = await redis.ttl(lockKey);
      const remaining = Math.max(0, maxRequests - current);
      const resetTime = Date.now() + (ttl * 1000);

      // Standard RateLimit HTTP headers
      res.setHeader("X-RateLimit-Limit", maxRequests);
      res.setHeader("X-RateLimit-Remaining", remaining);
      res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000));

      if (current > maxRequests) {
        res.setHeader("Retry-After", ttl);
        return sendError(
          res,
          `Too many requests. Rate limit of ${maxRequests} requests per ${windowSeconds}s exceeded.`,
          429,
          { retryAfterSeconds: ttl },
          "TOO_MANY_REQUESTS"
        );
      }

      next();
    } catch (err) {
      // In case of Redis error, fail open to avoid taking down API traffic
      console.warn("[RateLimiter] Redis failure, permitting request:", err.message);
      next();
    }
  };
}
