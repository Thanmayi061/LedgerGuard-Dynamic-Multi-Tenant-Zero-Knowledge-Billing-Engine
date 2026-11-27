/**
 * Standardized API Response Utilities
 */

export function sendSuccess(res, data = null, message = "Success", statusCode = 200, meta = undefined) {
  const payload = {
    success: true,
    message,
    data
  };
  if (meta !== undefined) {
    payload.meta = meta;
  }
  return res.status(statusCode).json(payload);
}

export function sendError(res, message = "Internal Server Error", statusCode = 500, details = null, code = null) {
  const payload = {
    success: false,
    message,
    ...(code && { code }),
    ...(details && { details })
  };
  return res.status(statusCode).json(payload);
}
