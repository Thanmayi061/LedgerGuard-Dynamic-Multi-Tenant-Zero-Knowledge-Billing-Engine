# LedgerGuard — Backend Architecture & Learning Notes

This document is the official architectural record, technical breakdown, and viva examination guide for the **LedgerGuard** backend platform. It documents the entire codebase, request flows, database integration mechanics, security hardening, billing reliability, and defense questions across all implementation phases.

---

## 1. Project Directory Structure

```
LedgerGuard/
├── docs/
│   ├── BACKEND_LEARNING_NOTES.md          # Architecture, API flows, integration notes & viva Q&As
│   └── daily-progress/
│       └── 2026-11-23.md                  # Daily team progress logs
├── database/                              # EXISTING (v1.3.0) — TEAM DATABASE LAYER
│   ├── .env.example                       # DB environment template
│   ├── .gitignore
│   ├── README.md                          # Schema specifications & Atlas contract notes
│   ├── package.json                       # Dependencies: mongoose, dotenv
│   ├── scripts/
│   │   └── seed.js                        # Multi-tenant seeder (Acme & Zenith sample orgs)
│   ├── src/
│   │   ├── connections.js                 # Central pool & tenant connection manager
│   │   ├── idempotency.js                 # Request-hash comparison validation helper
│   │   └── models.js                      # Schemas & tenant-scoped model getters
│   └── tests/
│       └── integration.test.js            # Database unit & Atlas integration tests
├── frontend/                              # TEAM FRONTEND FOUNDATION (Vite + React/TS)
└── backend/                               # COMPLETE BACKEND APPLICATION
    ├── .env.example                       # Application environment template (JWT, Redis & Mongo)
    ├── .gitignore
    ├── package.json                       # Express, Mongoose, JWT, Bcrypt, ioredis, Supertest
    ├── src/
    │   ├── app.js                         # Global rate limiter, health, auth, tenant, billing, usage, pricing, analytics routes
    │   ├── server.js                      # Server startup & graceful shutdown (DB + Redis pools)
    │   ├── config/
    │   │   ├── env.js                     # Validated configuration (PORT, JWT_KEYS, REDIS_URL)
    │   │   ├── db.js                      # Direct adapter bridge to ../../../database
    │   │   └── redis.js                   # Resilient Redis client (production guard + in-memory fallback)
    │   ├── middleware/
    │   │   ├── auth.middleware.js         # RS256 JWT verification, RBAC & platform admin guards
    │   │   ├── tenant.middleware.js       # Tenant resolver, cross-tenant & anti-stale token checks
    │   │   ├── rateLimiter.middleware.js  # Redis-backed rate limiting per tenant & IP (429 handling)
    │   │   └── error.middleware.js        # Centralized 404, Mongoose, MongoDB 11000, & error handler
    │   ├── utils/
    │   │   ├── hash.util.js               # Canonical JSON sorting & SHA-256 request payload hashing
    │   │   └── response.util.js           # Standardized JSON response envelope (sendSuccess, sendError)
    │   ├── services/
    │   │   ├── auth.service.js            # Bcrypt hashing, RS256 key management & anti-escalation guards
    │   │   ├── tenant.service.js          # Platform DB queries & tenant lifecycle management
    │   │   ├── redisLock.service.js       # Distributed mutex with atomic Lua release & production guards
    │   │   ├── billing.service.js         # Redis-locked atomic sessions, balanced ledger entries, reversals & idempotency
    │   │   ├── usage.service.js           # Scaled integer arithmetic, half-up rounding & usage aggregation
    │   │   ├── pricing.service.js         # Redis-locked pricing plan mutations & temporal overlap validation
    │   │   └── analytics.service.js       # Double-entry ledger trial balances, account balances & usage reports
    │   ├── controllers/
    │   │   ├── auth.controller.js         # Register, login, and profile handlers
    │   │   ├── tenant.controller.js       # Tenant creation, retrieval & listing handlers
    │   │   ├── billing.controller.js      # Billing transaction creation, reversal, and query handlers
    │   │   ├── usage.controller.js        # Usage event ingestion and summary handlers
    │   │   ├── pricing.controller.js      # Pricing plan creation, active plan query & listing handlers
    │   │   └── analytics.controller.js    # Financial trial balances and usage analytics handlers
    │   └── routes/
    │       ├── auth.routes.js             # /api/v1/auth (register, login, me)
    │       ├── tenant.routes.js           # /api/v1/tenants (create, list, getById)
    │       ├── billing.routes.js          # /api/v1/billing (transactions, reversals)
    │       ├── usage.routes.js            # /api/v1/usage (events, summary)
    │       ├── pricing.routes.js          # /api/v1/pricing (plans, active)
    │       └── analytics.routes.js        # /api/v1/analytics (financial, usage)
    └── tests/
        ├── unit/
        │   ├── auth.test.js               # Password hashing, RS256 JWT lifecycle & RBAC unit tests
        │   ├── dbBridge.test.js           # Database exports, schemas, idempotency & health probes
        │   ├── redisLock.test.js          # Distributed lock acquisition, concurrency & production guard tests
        │   ├── rateLimiter.test.js        # Rate limiting counter, header checks & HTTP 429 tests
        │   ├── hash.test.js               # Canonical JSON key sorting & SHA-256 determinism tests
        │   ├── billing.test.js            # Integer amounts, currency, double-entry balance, idempotency, repeated reversals & rollback tests
        │   ├── usage.test.js              # Scaled integer arithmetic, half-up rounding (Zenith 28 minor units), and metric validation tests
        │   └── pricing.test.js            # Pricing plan validations, version checks & active plan query tests
        └── integration/
            ├── app.test.js                # Supertest checks for /health, /api/v1/health & 404 handler
            ├── authRoutes.test.js         # Supertest checks for auth, tenant guards, anti-escalation & admin guards
            ├── billingRoutes.test.js      # Supertest checks for billing input validation, reversal RBAC & tenant checks
            └── phase5Routes.test.js       # Supertest checks for usage, pricing, and analytics route protection & validation
```

---

## 2. Billing Reliability & Concurrency Architecture

### 2.1 Multi-Tier Concurrency Protection

```
                                [ Incoming Billing Request ]
                                              │
                                              ▼
                        ┌───────────────────────────────────────────┐
                        │      Layer 1: Input & Route Validation    │
                        │ - Safe integer amountMinor >= 1           │
                        │ - 3-letter currency code                  │
                        │ - Non-empty idempotencyKey                │
                        └─────────────────────┬─────────────────────┘
                                              │
                                              ▼
                        ┌───────────────────────────────────────────┐
                        │      Layer 2: Redis Distributed Lock      │
                        │ lock:billing:idem:{tenantId}:{key}        │
                        │ - Serializes concurrent in-flight requests│
                        │ - Atomic Lua release                      │
                        └─────────────────────┬─────────────────────┘
                                              │
                                              ▼
                        ┌───────────────────────────────────────────┐
                        │      Layer 3: Canonical Hash Idempotency  │
                        │ - Computes SHA-256 canonical requestHash  │
                        │ - If matches completed: returns replay    │
                        │ - If payload differs: rejects HTTP 409    │
                        └─────────────────────┬─────────────────────┘
                                              │
                                              ▼
                        ┌───────────────────────────────────────────┐
                        │      Layer 4: MongoDB Atomic Transaction  │
                        │ - Multi-document session.withTransaction  │
                        │ - Writes BillingTransaction + Ledger rows │
                        │ - Enforces: sum(Debits) == sum(Credits)   │
                        └─────────────────────┬─────────────────────┘
                                              │
                                              ▼
                        ┌───────────────────────────────────────────┐
                        │      Layer 5: Unique Compound Index       │
                        │ billingTransactions: { idempotencyKey: 1 }│
                        │ - Final database-level ACID safeguard     │
                        │ - Rejection with code 11000 on race       │
                        └───────────────────────────────────────────┘
```

### 2.2 Redis Locks Integrated into Billing and Reversals
- **Billing Creation:** `createBillingTransaction` acquires `lock:billing:idem:${organizationId}:${cleanIdempotencyKey}`. If an identical request arrives while the first is being processed, it serializes behind the lock. When the second request acquires the lock, it queries the database, sees the completed transaction with matching `requestHash`, and returns the cached response with `{ replay: true }` without creating duplicate records.
- **Reversals:** `reverseBillingTransaction` acquires `lock:billing:reverse:${organizationId}:${cleanTxId}`. Simultaneous reversal attempts are strictly serialized. The first execution marks `tx.status = "reversed"` and inserts compensating entries. The second execution acquires the lock, sees `status === "reversed"`, and throws HTTP 409 `TRANSACTION_ALREADY_REVERSED`.
- **Session Cleanup:** Every database session is explicitly terminated inside a `finally { await session.endSession(); }` block, preventing orphaned cursors or memory leaks.

---

## 3. Phase 5: Usage Metering, Pricing Engine & Analytics

### 3.1 Scaled Integer Usage Representation
To prevent floating-point calculation drift, all continuous quantities are represented as a pair of integers:
$$\text{Actual Quantity} = \frac{\text{quantityScaled}}{\text{quantityScale}}$$

#### Exact Half-Up Cost Calculation
$$\text{totalCostMinor} = \text{Math.round}\left(\frac{\text{quantityScaled} \times \text{unitPriceMinor}}{\text{quantityScale}}\right)$$

**Verification against Revision 3 Specification:**
- **Zenith Sample:** $275 / 100$ compute units $\times$ $10$ minor units per unit = $27.5$ minor units.
- Half-up rounding produces exactly **$28$ minor units** (`totalCostMinor: 28`).
- **Acme Sample:** $1000 / 1$ requests $\times$ $2$ minor units = **$2000$ minor units**.

### 3.2 Pricing Engine & Redis-Locked Temporal Overlap Validation
- Pricing plans use half-open intervals: `[effectiveFrom, effectiveTo)` (where `null` `effectiveTo` represents infinity).
- Mongoose's `pre("validate")` hook enforces that no two plan versions for the same `planCode` and `metricType` have overlapping active dates.
- **Concurrency Serialization:** Mongoose validation is an application-level guard. Two concurrent writers could race between checking and writing. LedgerGuard wraps plan mutations inside `withLock("lock:pricing:" + organizationId + ":" + planCode, ...)`. Writes are serialized across all backend instances, allowing the Mongoose hook to accurately detect overlapping ranges and reject invalid updates.

### 3.3 Financial Analytics & Double-Entry Trial Balances
`getFinancialSummary` executes aggregation pipelines over `ledgerEntries` and `billingTransactions`:
1. **Trial Balance:** Calculates $\sum \text{Debits}$ and $\sum \text{Credits}$ across all journal entries and asserts `isBalanced: totalDebits === totalCredits`.
2. **Account Balances:**
   - $\text{Receivables Balance} = \text{Debits} - \text{Credits}$
   - $\text{Revenue Balance} = \text{Credits} - \text{Debits}$
   - $\text{Cash Balance} = \text{Debits} - \text{Credits}$
3. **Transaction Status Distribution:** Aggregates transaction volumes and counts across `success`, `reversed`, `failed`, and `pending`.

---

## 4. Test Verification Summary

Running `npm test` inside `backend/`:

```
> ledgerguard-backend@1.0.0 test
> node --test tests/**/*.test.js

✔ App Integration: GET /health returns 200 with distinguishable app and db status
✔ App Integration: GET /api/v1/health returns identical operational details
✔ App Integration: Unknown route returns 404 with structured error response
✔ Auth Routes: POST /api/v1/auth/register rejects unauthenticated public registration
✔ Auth Routes: POST /api/v1/auth/register requires admin/manager role
✔ Auth Routes: Manager cannot escalate privileges by creating an admin
✔ Auth Routes: POST /api/v1/auth/login fails with 400 when organizationId is missing
✔ Auth Routes: GET /api/v1/auth/me requires valid RS256 Bearer token
✔ Tenant Routes: POST /api/v1/tenants rejects regular tenant admin and forged claims
✔ Tenant Middleware: Cross-tenant access violation is prevented with HTTP 403
✔ Billing Routes: unauthenticated requests are rejected with 401
✔ Billing Routes: POST /transactions validates required fields and integer amounts
✔ Billing Routes: Reversal endpoint rejects member role with 403 Forbidden
✔ Billing Routes: Cross-tenant billing access violation is blocked
✔ Usage Routes: POST /api/v1/usage/events validates required fields
✔ Pricing Routes: POST /api/v1/pricing/plans requires admin role
✔ Pricing Routes: POST /api/v1/pricing/plans validates planCode and rates
✔ Analytics Routes: GET /api/v1/analytics/financial requires authentication
✔ Auth Service: hashPassword generates strong bcrypt hash and rejects short passwords
✔ Auth Service: comparePassword correctly verifies matches and rejects mismatches
✔ Auth Service: generateToken and verifyToken lifecycle
✔ Auth Service: verifyToken rejects tampered or malformed tokens
✔ Auth Middleware: authorizeRole enforces role boundaries
✔ Billing Service: rejects invalid amountMinor (floating-point, negative, zero)
✔ Billing Service: rejects invalid currency format
✔ Billing Service: requires idempotencyKey
✔ Double-Entry Bookkeeping: balanced debit and credit invariant
✔ Idempotency Contract: assertMatchingRequestHash detects payload changes on reused key
✔ Billing Reliability: Repeated reversal attempt is rejected with 409
✔ Billing Reliability: Transaction session rollback occurs on double-entry balance violation
✔ Database Bridge: exports all required functions, models, and helpers
✔ Database Bridge: Platform Organization schema contains expected fields and indexes
✔ Database Bridge: assertMatchingRequestHash behaves correctly
✔ Database Bridge: checkDatabaseHealth reports unconfigured when placeholder URI is used
✔ Hash Utility: canonicalizeValue sorts keys deterministically
✔ Hash Utility: computeRequestHash produces identical 64-char SHA-256 for reordered keys
✔ Hash Utility: computeRequestHash changes when any payload value changes
✔ Pricing Service: createPricingPlan validates input requirements
✔ Pricing Service: getActivePricingPlan requires planCode
✔ Rate Limiter Middleware: tracks request count and sets rate limit headers
✔ Rate Limiter Middleware: returns HTTP 429 when limit is exceeded
✔ Redis Lock: acquires and releases a distributed mutex lock
✔ Redis Lock: prevents concurrent acquisition for the same key
✔ Redis Lock: releasing with wrong lockValue fails (safe release guard)
✔ Redis Lock: withLock wrapper executes task and releases lock automatically
✔ Redis Lock: in-memory fallback is prohibited in production mode
✔ Usage Service: calculateUsageCostMinor applies exact half-up rounding on scaled quantities
✔ Usage Service: calculateUsageCostMinor validates integer types and bounds
✔ Usage Service: recordUsage rejects invalid metricType

ℹ tests 49 | pass 49 | fail 0 | cancelled 0 | skipped 0 | duration_ms ~999ms
```

Running `npm test` inside `ledgerguard-mongodb-db/`:
- `idempotency rejects reuse of a key with a different request hash` passed.
- 5 Atlas tests skipped safely pending live cluster credentials.

---

## 5. Operational Transparency on Testing

- **Local Verification (49/49 Passed):** All schema constraints, input validations, canonical hashing, RS256 token signing, role hierarchies, Redis locking semantics, scaled integer arithmetic (Zenith 28 minor units), and double-entry invariants are fully verified locally.
- **Live Atlas ACID Tests (Skipped Locally):** Standalone local MongoDB instances cannot execute multi-document transactions. Complete verification of live rollback on network drop and cross-shard transaction consistency requires running `npm run test:integration` inside `ledgerguard-mongodb-db` against a live Atlas replica-set deployment with `MONGODB_URI` and `LEDGERGUARD_TEST_PLATFORM_DB_NAME` configured.

---

## 6. Five Essential Viva Examination Questions & In-Depth Answers (Phase 5 & Final Review)

### Question 1: Why does LedgerGuard represent usage quantities as scaled integers (`quantityScaled` and `quantityScale`) rather than floating-point numbers?
**Answer:**
Standard IEEE 754 floating-point arithmetic is prone to binary representation errors (e.g. $0.1 + 0.2 = 0.30000000000000004$), which can compound into significant financial discrepancies when aggregating millions of usage events. LedgerGuard completely eliminates floating-point drift by storing quantities as rational fractions represented by two safe integers: `quantityScaled` (the numerator) and `quantityScale` (the denominator). For example, $2.75$ compute units is stored exactly as $275 / 100$. All cost evaluations are computed in integer minor currency units using deterministic half-up rounding:
$$\text{totalCostMinor} = \text{Math.round}\left(\frac{\text{quantityScaled} \times \text{unitPriceMinor}}{\text{quantityScale}}\right)$$
This yields exact, reproducible billing results across all platforms.

### Question 2: How does the application ensure that Redis distributed locks and MongoDB unique indexes work together rather than competing?
**Answer:**
Redis locks and MongoDB unique indexes operate as complementary defense-in-depth layers:
1. **Redis Distributed Lock (Performance & Contention Minimizer):** Acts as the frontline coordinator across multi-instance backends. It serializes concurrent requests attempting to use the same idempotency key or reverse the same transaction, preventing unnecessary database load and avoiding dirty write conflicts.
2. **MongoDB Unique Index & Transactions (ACID Foundation):** Acts as the absolute, uncompromising safety net. If Redis fails, restarts, or a lock TTL expires during an unexpectedly slow database operation, MongoDB's unique compound index `{ idempotencyKey: 1 }` rejects any duplicate insert with error code `11000` at the storage layer. Thus, distributed locks optimize throughput, but database-level constraints guarantee ACID correctness.

### Question 3: How does the pricing engine prevent overlapping effective periods for the same plan code and metric type?
**Answer:**
Pricing periods in LedgerGuard are half-open intervals $[ \text{effectiveFrom}, \text{effectiveTo} )$. The Mongoose `pre("validate")` hook executes a query checking if any other plan version for the same `planCode` and `metricType` has an overlapping interval. Because Mongoose validation occurs at the application level and could race under concurrent writes, `createPricingPlan` wraps write operations in a tenant-scoped Redis lock (`lock:pricing:${org}:${planCode}`). This ensures that concurrent plan creations are serialized, allowing the validation hook to detect any temporal collisions and reject the second write.

### Question 4: How does `getFinancialSummary` calculate trial balance and account balances in double-entry bookkeeping?
**Answer:**
In double-entry bookkeeping, every financial transaction produces balanced debits and credits. The `getFinancialSummary` aggregation pipeline groups `ledgerEntries` by `accountType` and `entryType`:
- **Trial Balance Verification:** It sums all debits and all credits across the tenant's ledger and asserts that $\sum \text{Debits} == \sum \text{Credits}$. If they are equal, `isBalanced` is `true`.
- **Account Balances:**
  - Asset/Receivables: $\text{Debits} - \text{Credits}$ (debits increase receivables; credits decrease them).
  - Revenue: $\text{Credits} - \text{Debits}$ (credits increase revenue; debits decrease it, e.g., on reversal).
  - Cash: $\text{Debits} - \text{Credits}$.
This gives a real-time, mathematically balanced snapshot of the tenant's financial standing.

### Question 5: What is the exact sequence of events when a billing transaction is reversed?
**Answer:**
1. The client sends `POST /api/v1/billing/transactions/:id/reverse`.
2. Middleware verifies the caller's JWT, validates that their role is `admin` or `manager`, and resolves the tenant database.
3. The service acquires a Redis lock `lock:billing:reverse:${org}:${id}` to prevent simultaneous reversal races.
4. It verifies that the transaction exists, has `status === "success"`, and has not already been reversed (`reversedAt === null`). If already reversed, it throws HTTP 409 `TRANSACTION_ALREADY_REVERSED`.
5. It starts a MongoDB transaction session (`session.withTransaction`).
6. It updates the transaction document: `status = "reversed"` and `reversedAt = new Date()`.
7. It reads the original ledger entries and creates compensating entries swapping entry types (`debit` becomes `credit`, `credit` becomes `debit`) with `reversalOf` pointing to the original entry IDs.
8. It verifies that compensating debits equal compensating credits, commits the transaction session, and releases the Redis lock. Original ledger entries remain completely untouched.

---

## 7. Frontend Integration Guide (Endpoints, Auth & Payloads)

This section provides the frontend team with complete API contracts, authentication headers, and request/response payloads to integrate the UI client with the LedgerGuard backend.

### 7.1 Authentication & Base Configuration
- **Base URL:** `http://localhost:4000/api/v1`
- **Authentication Scheme:** `Authorization: Bearer <RS256_JWT_TOKEN>`
- **Tenant Context Header:** `x-tenant-id: <organizationId>` (required on all tenant-scoped routes)

### 7.2 Core API Endpoints

#### 1. System Health
- `GET /health` and `GET /api/v1/health`
- **Response (200 OK):**
```json
{
  "status": "ok",
  "service": "ledgerguard-backend",
  "uptime": 124.5,
  "database": {
    "status": "connected",
    "readyState": 1,
    "ping": "pong",
    "latencyMs": 4
  },
  "redis": {
    "status": "ready"
  }
}
```

#### 2. Authentication
- `POST /api/v1/auth/login`
- **Request Body:**
```json
{
  "organizationId": "org_acme_001",
  "email": "admin@acme.com",
  "password": "SecurePassword123!"
}
```
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "6741b2...",
      "email": "admin@acme.com",
      "role": "admin",
      "organizationId": "org_acme_001"
    }
  }
}
```

#### 3. Billing & Transactions
- `POST /api/v1/billing/transactions`
- **Headers:** `Authorization: Bearer <token>`, `x-tenant-id: org_acme_001`
- **Request Body:**
```json
{
  "idempotencyKey": "tx_req_001_unique_hash",
  "amountMinor": 25000,
  "currency": "USD",
  "sourceAccountId": "acc_cust_101",
  "destinationAccountId": "acc_rev_202",
  "description": "Monthly Enterprise Subscription",
  "metadata": { "invoiceRef": "INV-2026-11-001" }
}
```
- **Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "transaction": {
      "transactionId": "tx_req_001_unique_hash",
      "amountMinor": 25000,
      "currency": "USD",
      "status": "success",
      "createdAt": "2026-11-24T16:00:00.000Z"
    },
    "ledgerEntries": [
      { "entryType": "debit", "accountType": "asset", "amountMinor": 25000 },
      { "entryType": "credit", "accountType": "revenue", "amountMinor": 25000 }
    ]
  }
}
```

#### 4. Usage Metering
- `POST /api/v1/usage/events`
- **Headers:** `Authorization: Bearer <token>`, `x-tenant-id: org_zenith_002`
- **Request Body:**
```json
{
  "metricType": "compute_hours",
  "quantityScaled": 275,
  "quantityScale": 100,
  "customerId": "cust_zenith_99"
}
```

#### 5. Financial Analytics & Trial Balances
- `GET /api/v1/analytics/financial`
- **Headers:** `Authorization: Bearer <token>`, `x-tenant-id: org_acme_001`
- **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "organizationId": "org_acme_001",
    "currency": "USD",
    "trialBalance": {
      "totalDebits": 250000,
      "totalCredits": 250000,
      "isBalanced": true
    },
    "balances": {
      "asset": 250000,
      "revenue": 250000,
      "liability": 0,
      "expense": 0
    }
  }
}
```

---

## 8. Git Architecture & Team Collaboration Workflow (24 November 2026)

- **Dedicated Backend Branch:** `maithli-backend`
- **Base Commit:** Teammate Abhishek's commit `8c0715b` containing the team frontend (`frontend/`), database foundation (`database/`), and documentation.
- **Backend Isolation:** All application code, test suites, controllers, services, routes, middleware, and environment configurations reside in `backend/`.
- **Database Layer Reuse:** `backend/src/config/db.js` integrates directly with `database/src/` (`connections.js`, `models.js`, `idempotency.js`), preserving database models without schema duplication.
- **Teammate Protection:** Teammate contributions in `frontend/`, `database/`, and `docs/daily-progress/` remain completely untouched and intact.
- **Git Author Attribution:** Local author verified as `Maithli <tomarmaithlisingh@gmail.com>` without modifying global configuration.
