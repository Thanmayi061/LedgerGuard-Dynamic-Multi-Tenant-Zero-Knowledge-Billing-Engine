import test from "node:test";
import assert from "node:assert/strict";

import {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken
} from "../../src/services/auth.service.js";

import { authorizeRole } from "../../src/middleware/auth.middleware.js";

test("Auth Service: hashPassword generates strong bcrypt hash and rejects short passwords", async () => {
  const plain = "SuperSecretPassword123!";
  const hash = await hashPassword(plain);

  assert.ok(hash.startsWith("$2b$") || hash.startsWith("$2a$"), "Hash should follow bcrypt format");
  assert.notEqual(hash, plain, "Hash must never equal plain password");

  // Rejects invalid passwords
  await assert.rejects(() => hashPassword("123"), /at least 6 characters/);
  await assert.rejects(() => hashPassword(""), /at least 6 characters/);
  await assert.rejects(() => hashPassword(null), /at least 6 characters/);
});

test("Auth Service: comparePassword correctly verifies matches and rejects mismatches", async () => {
  const plain = "ValidPassword987#";
  const hash = await hashPassword(plain);

  const isValid = await comparePassword(plain, hash);
  assert.equal(isValid, true, "Correct password must return true");

  const isInvalid = await comparePassword("WrongPassword!", hash);
  assert.equal(isInvalid, false, "Incorrect password must return false");

  assert.equal(await comparePassword(null, hash), false);
  assert.equal(await comparePassword(plain, null), false);
});

test("Auth Service: generateToken and verifyToken lifecycle", () => {
  const payload = {
    userId: "usr_mock_12345",
    email: "dev@acme.example",
    organizationId: "org_acme_001",
    role: "admin"
  };

  const token = generateToken(payload);
  assert.equal(typeof token, "string", "Token must be a string");
  assert.equal(token.split(".").length, 3, "JWT must have 3 segments");

  const decoded = verifyToken(token);
  assert.equal(decoded.userId, payload.userId);
  assert.equal(decoded.email, payload.email);
  assert.equal(decoded.organizationId, payload.organizationId);
  assert.equal(decoded.role, payload.role);
  assert.equal(decoded.iss, "ledgerguard-api");
});

test("Auth Service: verifyToken rejects tampered or malformed tokens", () => {
  assert.throws(() => verifyToken("invalid.token.string"), /jwt malformed|invalid token/i);

  const validToken = generateToken({ userId: "u1", organizationId: "o1", role: "member" });
  const tamperedToken = validToken.slice(0, -6) + "abcdef";
  assert.throws(() => verifyToken(tamperedToken), /invalid signature/i);
});

test("Auth Middleware: authorizeRole enforces role boundaries", () => {
  const adminGuard = authorizeRole("admin");
  const multiGuard = authorizeRole("admin", "manager");

  // Success case: role matches
  let nextCalled = false;
  const adminReq = { user: { role: "admin" } };
  adminGuard(adminReq, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  // Failure case: insufficient role
  let errorStatus = null;
  let errorBody = null;
  const mockRes = {
    status(code) {
      errorStatus = code;
      return {
        json(data) { errorBody = data; }
      };
    }
  };

  const memberReq = { user: { role: "member" } };
  adminGuard(memberReq, mockRes, () => {});
  assert.equal(errorStatus, 403);
  assert.equal(errorBody.code, "FORBIDDEN");
  assert.match(errorBody.message, /Access denied/);

  // Multi-role guard permits manager
  let managerPassed = false;
  const managerReq = { user: { role: "manager" } };
  multiGuard(managerReq, {}, () => { managerPassed = true; });
  assert.equal(managerPassed, true);
});
