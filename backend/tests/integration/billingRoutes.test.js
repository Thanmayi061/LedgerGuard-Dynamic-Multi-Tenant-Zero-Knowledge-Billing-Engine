import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import app from "../../src/app.js";
import { generateToken } from "../../src/services/auth.service.js";

test("Billing Routes: unauthenticated requests are rejected with 401", async () => {
  const res = await request(app)
    .post("/api/v1/billing/transactions")
    .send({
      amountMinor: 1000,
      currency: "INR",
      idempotencyKey: "idem_unauth_1"
    });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "UNAUTHORIZED");
});

test("Billing Routes: POST /transactions validates required fields and integer amounts", async () => {
  const token = generateToken({
    userId: "usr_bill_test",
    email: "billing@acme.example",
    organizationId: "org_acme_001",
    role: "admin"
  });

  // Missing idempotency key
  const resNoKey = await request(app)
    .post("/api/v1/billing/transactions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      amountMinor: 1000,
      currency: "INR"
    });

  assert.equal(resNoKey.status, 400);
  assert.match(resNoKey.body.message, /idempotencyKey is required/);

  // Invalid floating point amount
  const resFloat = await request(app)
    .post("/api/v1/billing/transactions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      amountMinor: 1299.99,
      currency: "INR",
      idempotencyKey: "idem_float_key"
    });

  assert.equal(resFloat.status, 400);
  assert.match(resFloat.body.message, /amountMinor must be a positive safe integer/);

  // Invalid currency
  const resBadCurr = await request(app)
    .post("/api/v1/billing/transactions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      amountMinor: 1000,
      currency: "INDIAN_RUPEE",
      idempotencyKey: "idem_curr_key"
    });

  assert.equal(resBadCurr.status, 400);
  assert.match(resBadCurr.body.message, /currency must be a valid 3-letter uppercase/);
});

test("Billing Routes: Reversal endpoint rejects member role with 403 Forbidden", async () => {
  const memberToken = generateToken({
    userId: "usr_member_bill",
    email: "member@acme.example",
    organizationId: "org_acme_001",
    role: "member"
  });

  const res = await request(app)
    .post("/api/v1/billing/transactions/txn_sample_001/reverse")
    .set("Authorization", `Bearer ${memberToken}`)
    .send({ reason: "Customer requested" });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, "FORBIDDEN");
});

test("Billing Routes: Cross-tenant billing access violation is blocked", async () => {
  const token = generateToken({
    userId: "usr_org1_bill",
    email: "user@org1.example",
    organizationId: "org_acme_001",
    role: "admin"
  });

  const res = await request(app)
    .post("/api/v1/billing/transactions")
    .set("Authorization", `Bearer ${token}`)
    .send({
      organizationId: "org_zenith_002", // Cross-tenant target
      amountMinor: 5000,
      currency: "INR",
      idempotencyKey: "idem_cross_bill"
    });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, "TENANT_ACCESS_DENIED");
});
