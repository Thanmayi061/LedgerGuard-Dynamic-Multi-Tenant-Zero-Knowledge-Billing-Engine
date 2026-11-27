/**
 * Centralized Error & 404 Handlers
 */
import { sendError } from "../utils/response.util.js";

export function notFoundHandler(req, res) {
  return sendError(
    res,
    `Route not found: ${req.method} ${req.originalUrl}`,
    404,
    null,
    "NOT_FOUND"
  );
}

export function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || "An unexpected error occurred.";
  const code = err.code || (statusCode === 500 ? "INTERNAL_SERVER_ERROR" : "ERROR");

  // Handle Mongoose validation errors
  if (err.name === "ValidationError") {
    const details = Object.values(err.errors || {}).map(e => ({
      field: e.path,
      message: e.message
    }));
    return sendError(res, "Validation Error", 400, details, "VALIDATION_ERROR");
  }

  // Handle MongoDB duplicate key error (code 11000)
  if (err.code === 11000) {
    return sendError(res, "Duplicate key error: resource already exists.", 409, err.keyValue, "DUPLICATE_KEY");
  }

  // Handle Idempotency key payload mismatch
  if (err.code === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH") {
    return sendError(res, message, 409, null, err.code);
  }

  const details = process.env.NODE_ENV === "production" ? null : (err.details || null);
  return sendError(res, message, statusCode, details, code);
}
