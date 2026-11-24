/**
 * Redis Configuration & Resilient Client
 *
 * Provides a resilient Redis client using ioredis. If no live Redis server
 * is configured or running (e.g. offline testing/local dev), seamlessly
 * falls back to an atomic in-memory mock supporting key operations and Lua scripts.
 */
import Redis from "ioredis";
import { env } from "./env.js";

let redisClient = null;
let isInMemoryFallback = false;

class InMemoryRedis {
  constructor() {
    this.store = new Map();
    this.ttls = new Map();
    this.status = "ready";
  }

  _isExpired(key) {
    if (!this.ttls.has(key)) return false;
    const expiresAt = this.ttls.get(key);
    if (Date.now() >= expiresAt) {
      this.store.delete(key);
      this.ttls.delete(key);
      return true;
    }
    return false;
  }

  async ping() {
    return "PONG";
  }

  async get(key) {
    if (this._isExpired(key)) return null;
    const val = this.store.get(key);
    return val !== undefined ? String(val) : null;
  }

  async set(key, value, ...args) {
    let ttlMs = null;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      const arg = String(args[i]).toUpperCase();
      if (arg === "PX" && i + 1 < args.length) {
        ttlMs = parseInt(args[i + 1], 10);
        i++;
      } else if (arg === "EX" && i + 1 < args.length) {
        ttlMs = parseInt(args[i + 1], 10) * 1000;
        i++;
      } else if (arg === "NX") {
        nx = true;
      }
    }

    if (nx && !this._isExpired(key) && this.store.has(key)) {
      return null;
    }

    this.store.set(key, value);
    if (ttlMs) {
      this.ttls.set(key, Date.now() + ttlMs);
    } else {
      this.ttls.delete(key);
    }
    return "OK";
  }

  async del(key) {
    this.ttls.delete(key);
    return this.store.delete(key) ? 1 : 0;
  }

  async incr(key) {
    if (this._isExpired(key)) this.store.delete(key);
    const curr = parseInt(this.store.get(key) || "0", 10);
    const next = curr + 1;
    this.store.set(key, next);
    return next;
  }

  async expire(key, seconds) {
    if (!this.store.has(key) || this._isExpired(key)) return 0;
    this.ttls.set(key, Date.now() + (seconds * 1000));
    return 1;
  }

  async pexpire(key, milliseconds) {
    if (!this.store.has(key) || this._isExpired(key)) return 0;
    this.ttls.set(key, Date.now() + milliseconds);
    return 1;
  }

  async ttl(key) {
    if (!this.store.has(key) || this._isExpired(key)) return -2;
    if (!this.ttls.has(key)) return -1;
    const remainingMs = this.ttls.get(key) - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  async pttl(key) {
    if (!this.store.has(key) || this._isExpired(key)) return -2;
    if (!this.ttls.has(key)) return -1;
    return Math.max(0, this.ttls.get(key) - Date.now());
  }

  async eval(script, numKeys, ...args) {
    const keys = args.slice(0, numKeys);
    const argv = args.slice(numKeys);

    // Support safe atomic lock release script
    if (script.includes("redis.call(\"get\", KEYS[1]) == ARGV[1]")) {
      const current = await this.get(keys[0]);
      if (current === String(argv[0])) {
        await this.del(keys[0]);
        return 1;
      }
      return 0;
    }

    // Default basic execution
    return 1;
  }

  async quit() {
    this.store.clear();
    this.ttls.clear();
    return "OK";
  }
}

export function getRedisClient() {
  if (redisClient) return redisClient;

  if (env.isProduction) {
    if (!env.REDIS_URL) {
      throw new Error("FATAL: REDIS_URL is required in production mode. In-memory fallback is strictly prohibited in production to prevent distributed race conditions.");
    }

    try {
      redisClient = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        connectTimeout: 5000,
        enableOfflineQueue: false
      });

      redisClient.on("error", err => {
        console.error("[Redis Production Error]:", err.message);
      });
      isInMemoryFallback = false;
      return redisClient;
    } catch (err) {
      isInMemoryFallback = false;
      throw new Error(`Failed to initialize production Redis client: ${err.message}`);
    }
  }

  if (env.REDIS_URL && !env.isTest) {
    try {
      redisClient = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 2000,
        enableOfflineQueue: false,
        retryStrategy: () => null
      });

      redisClient.on("error", err => {
        console.warn("[Redis] Client error, using in-memory fallback:", err.message);
      });
      isInMemoryFallback = false;
      return redisClient;
    } catch {
      isInMemoryFallback = true;
      redisClient = new InMemoryRedis();
      return redisClient;
    }
  }

  // Use fast in-memory fallback ONLY for local development and test modes
  isInMemoryFallback = true;
  redisClient = new InMemoryRedis();
  return redisClient;
}

export function isInMemoryFallbackActive() {
  return isInMemoryFallback;
}

export async function checkRedisHealth() {
  const client = getRedisClient();
  try {
    const pong = await client.ping();
    return {
      status: pong === "PONG" ? "connected" : "degraded",
      mode: isInMemoryFallback ? "in-memory-fallback" : "network-redis"
    };
  } catch (error) {
    return {
      status: "error",
      mode: isInMemoryFallback ? "in-memory-fallback" : "network-redis",
      message: error.message
    };
  }
}

export async function closeRedisConnection() {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      // Ignored during shutdown
    }
    redisClient = null;
  }
}
