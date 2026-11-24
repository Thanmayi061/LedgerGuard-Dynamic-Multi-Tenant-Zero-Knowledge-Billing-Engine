import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from backend/.env if present
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const NODE_ENV = process.env.NODE_ENV || "development";
const PORT = parseInt(process.env.PORT, 10) || 4000;
const PLATFORM_DB_NAME = process.env.PLATFORM_DB_NAME || "platform_db";
const JWT_SECRET = process.env.JWT_SECRET || "ledgerguard-development-secret-jwt-key-2026";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY || null;
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || null;
const REDIS_URL = process.env.REDIS_URL || null;

// Ensure a safe fallback for test mode so importing DB modules doesn't fail on missing URI
if (!process.env.MONGODB_URI && (NODE_ENV === "test" || !process.env.NODE_ENV)) {
  process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/ledgerguard_test_placeholder";
}

export const env = {
  PORT,
  NODE_ENV,
  MONGODB_URI: process.env.MONGODB_URI,
  PLATFORM_DB_NAME,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  JWT_PRIVATE_KEY,
  JWT_PUBLIC_KEY,
  REDIS_URL,
  isProduction: NODE_ENV === "production",
  isTest: NODE_ENV === "test"
};
