import app from "./app.js";
import { env } from "./config/env.js";
import { closeDatabaseConnections } from "./config/db.js";
import { closeRedisConnection } from "./config/redis.js";

const server = app.listen(env.PORT, () => {
  console.log(`[LedgerGuard Backend] Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

// Graceful shutdown handling
const handleGracefulShutdown = async (signal) => {
  console.log(`[LedgerGuard Backend] Received ${signal}. Closing HTTP server and database/Redis connections...`);
  server.close(async () => {
    try {
      await Promise.allSettled([
        closeDatabaseConnections(),
        closeRedisConnection()
      ]);
      console.log("[LedgerGuard Backend] Database and Redis connections closed cleanly.");
      process.exit(0);
    } catch (err) {
      console.error("[LedgerGuard Backend] Error during graceful shutdown:", err);
      process.exit(1);
    }
  });

  // Force exit if hanging
  setTimeout(() => {
    console.error("[LedgerGuard Backend] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));

export default server;
