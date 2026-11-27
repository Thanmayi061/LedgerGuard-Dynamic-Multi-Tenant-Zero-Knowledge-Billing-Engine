/**
 * Backend service helper: a key may only be replayed for the same canonical request.
 * The caller is responsible for storing the first requestHash atomically with the
 * transaction/idempotency record and for returning the saved response on a match.
 */
export function assertMatchingRequestHash(existingRecord, incomingRequestHash) {
  if (!existingRecord) return true;
  if (!incomingRequestHash || existingRecord.requestHash !== incomingRequestHash) {
    const error = new Error("Idempotency key was already used with a different request payload.");
    error.statusCode = 409;
    error.code = "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH";
    throw error;
  }
  return true;
}
