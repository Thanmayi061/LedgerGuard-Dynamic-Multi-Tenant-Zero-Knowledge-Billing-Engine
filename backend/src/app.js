import express from "express";
import { env } from "./config/env.js";
import { checkDatabaseHealth } from "./config/db.js";
import { checkRedisHealth } from "./config/redis.js";
import { sendSuccess } from "./utils/response.util.js";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware.js";
import { createRateLimiter } from "./middleware/rateLimiter.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import tenantRoutes from "./routes/tenant.routes.js";
import billingRoutes from "./routes/billing.routes.js";
import usageRoutes from "./routes/usage.routes.js";
import pricingRoutes from "./routes/pricing.routes.js";
import analyticsRoutes from "./routes/analytics.routes.js";

const app = express();

// Global body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Attach request timestamp
app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  next();
});

// Global API rate limiting
const globalRateLimiter = createRateLimiter({
  windowSeconds: 60,
  maxRequests: 200,
  keyPrefix: "rl:global"
});
app.use("/api/", globalRateLimiter);

// Health check endpoints
const handleHealthCheck = async (req, res, next) => {
  try {
    const [dbHealth, redisHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth()
    ]);
    const isDbReady = dbHealth.status === "connected";

    return sendSuccess(res, {
      status: isDbReady ? "healthy" : "degraded",
      application: {
        status: "up",
        service: "ledgerguard-backend",
        version: "1.0.0",
        environment: env.NODE_ENV,
        uptime: process.uptime(),
        timestamp: req.requestTime
      },
      database: {
        readiness: isDbReady ? "ready" : "not_ready",
        ...dbHealth
      },
      redis: redisHealth
    }, isDbReady ? "All systems operational" : "Application running with degraded database connectivity");
  } catch (error) {
    next(error);
  }
};

app.get("/health", handleHealthCheck);
app.get("/api/v1/health", handleHealthCheck);

// API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tenants", tenantRoutes);
app.use("/api/v1/billing", billingRoutes);
app.use("/api/v1/usage", usageRoutes);
app.use("/api/v1/pricing", pricingRoutes);
app.use("/api/v1/analytics", analyticsRoutes);

// 404 Fallback
app.use(notFoundHandler);

// Centralized Error Handling
app.use(errorHandler);

export default app;
