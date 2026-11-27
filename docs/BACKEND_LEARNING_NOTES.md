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

---

## 9. End-to-End Database Integration Testing & Atlas Readiness (25 November 2026)

### 9.1 Verification of Database Layer & Adapter Bridge
The backend imports the database tier via `backend/src/config/db.js`, connecting directly to `database/src/` (`connections.js`, `models.js`, `idempotency.js`):
- **Central Connection Pool:** `getPlatformConnection` manages connectivity to `platform_db`.
- **Tenant Connection Cache:** `getTenantConnection(verifiedOrganizationId)` resolves `Organization` from `platform_db` and provisions cached connection promises per tenant database.
- **Mongoose Models:** `Organization` (platform-level), `getUserModel`, `getBillingTransactionModel`, `getLedgerEntryModel`, `getUsageRecordModel`, and `getPricingPlanModel` (tenant-scoped).
- **Idempotency Guard:** `assertMatchingRequestHash` validates payload consistency on reused keys.

### 9.2 MongoDB Atlas Configuration Inspection
- **Probe Function:** `checkDatabaseHealth()` in `backend/src/config/db.js` probes the database tier.
- **Safety Status:** When `MONGODB_URI` contains placeholder values (`<username>:<password>@<cluster-url>`), the system reports `{ status: "unconfigured", platformDb: "platform_db", message: "MONGODB_URI is not configured with live credentials." }` without crashing the application.
- **Credential Hygiene:** Zero credentials are hardcoded or committed to Git. Live credentials must be supplied via untracked local `.env` files.

### 9.3 Central Platform Database & Tenant Routing Verification
- **Registry Mapping:** `platform_db.organizations` routes tenant contexts:
  - `org_acme_001` ➔ `tenant_acme_db`
  - `org_zenith_002` ➔ `tenant_zenith_db`
- **Routing Middleware:** `backend/src/middleware/tenant.middleware.js` extracts and validates the tenant context from JWT claims, route parameters, `x-tenant-id`, or `x-organization-id`.

### 9.4 Authentication, RBAC, and Tenant Access Verification
- **RS256 JWT Lifecycle:** Verifies token generation, asymmetric cryptographic signature verification, expiration, and role boundaries (`platform_admin` ➔ `admin` ➔ `manager` ➔ `member`).
- **Live User Guard:** `tenant.middleware.js` queries `getUserModel(tenantDb)` to verify the user is active in the database, rejecting stale or revoked tokens.
- **Cross-Tenant Protection:** Attempting to query another tenant's database with an authenticated token targeting a mismatched tenant header is immediately blocked with HTTP 403 `TENANT_ACCESS_DENIED`.

### 9.5 Financial Workflows, Idempotency, and Accounting Invariants
- **Double-Entry Ledger Balancing:** Invariant holds strictly: $\sum \text{Debits} == \sum \text{Credits}$.
- **Idempotency Contract:** Request hashes are generated using deterministic canonical JSON key sorting. Replays return the cached response; modifications on the same key trigger HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
- **Compensating Reversals:** Transactions with status `success` generate compensating journal entries swapping debits and credits (`REV-JRN-...`), preserving original entries as immutable accounting records.
- **Scaled Integer Usage:** Floating-point arithmetic is avoided. Quantities are stored as rational fractions (`quantityScaled / quantityScale`) and rounded half-up: $275/100 \times 10 = 28$ minor currency units for Zenith.

### 9.6 Test Execution Summary

```text
=== BACKEND TEST SUITE (backend/) ===
Command: node --test tests/**/*.test.js
✔ Passed: 54 tests
✖ Failed: 0 tests
﹣ Skipped: 1 test (Live Atlas network test skipped safely when MONGODB_URI is unconfigured)
⏱ Duration: ~1,084 ms

=== DATABASE TEST SUITE (database/) ===
Command: node --test
✔ Passed: 1 test (idempotency rejects reuse with different request hash)
✖ Failed: 0 tests
﹣ Skipped: 5 tests (Live Atlas multi-document transaction & isolation tests skipped pending cluster URI)
⏱ Duration: ~90 ms
```

### 9.7 Teammate Integration Guide

#### For the Database Teammate:
1. To run live Atlas integration tests against your isolated development cluster:
   ```bash
   cd database
   export MONGODB_URI="mongodb+srv://<user>:<password>@<cluster-url>/?retryWrites=true&w=majority"
   export LEDGERGUARD_TEST_PLATFORM_DB_NAME="ledgerguard_test_platform"
   npm run test:integration
   ```
2. To test full backend E2E flows against the same cluster:
   ```bash
   cd ../backend
   export MONGODB_URI="mongodb+srv://<user>:<password>@<cluster-url>/?retryWrites=true&w=majority"
   npm test
   ```

#### For the Frontend Teammate:
1. The backend server runs at `http://localhost:4000/api/v1`.
2. Include both headers on all protected API requests:
   - `Authorization: Bearer <RS256_JWT_TOKEN>`
   - `x-tenant-id: <organizationId>` (e.g. `org_acme_001` or `org_zenith_002`)
3. Login via `POST /api/v1/auth/login` with `{ organizationId, email, password }` returns the token and user profile.

---

## 10. Live Integration Readiness & Testing Infrastructure (25 November 2026)

### 10.1 Live Integration Test Harness (`npm run test:live`)
Created `backend/scripts/verify-live-integration.js`, a standalone live test runner that evaluates connectivity and contract fulfillment across the stack:
- **Phase 1: Environment & Health Probing:** Queries `checkDatabaseHealth()` and `checkRedisHealth()` to identify network availability or local fallback state.
- **Phase 2: Database Contract & Model Verification:** Confirms platform models and tenant model getters (`User`, `Tx`, `Ledger`, `Usage`, `Pricing`) load properly without schema mutation.
- **Phase 3: Redis Distributed Locking:** Tests mutex acquisition, TTL preservation, and atomic Lua release (`withLock`).
- **Phase 4: Authentication & Tenant Routing:** Tests bcrypt password hashing/comparison and RS256 JWT claim verification.
- **Phase 5: Accounting & Idempotency Invariants:** Validates balanced ledger invariant ($\sum \text{Debits} == \sum \text{Credits}$), SHA-256 canonical payload hash comparison (HTTP 409 on key reuse with modified payload), and scaled integer usage arithmetic ($275/100 \times 10 = 28$ minor units).
- **Phase 6: Multi-Tenant Database Health Probe:** Evaluates `checkTenantDatabasesHealth(["org_acme_001", "org_zenith_002"])` for ping latency and readyState across both tenant databases.

### 10.2 Architectural Refinements
1. **Multi-Tenant Health Probing:** Added `checkTenantDatabasesHealth()` in [backend/src/config/db.js](file:///Users/maithlisingh_t/Desktop/LedgerGuard/backend/src/config/db.js) to programmatically ping and inspect both `tenant_acme_db` and `tenant_zenith_db`.
2. **Flexible Live Redis Configuration:** Refined `getRedisClient()` in [backend/src/config/redis.js](file:///Users/maithlisingh_t/Desktop/LedgerGuard/backend/src/config/redis.js) so live Redis instances can be targeted during integration testing via `ENABLE_LIVE_REDIS="true"` while maintaining strict production safety.
3. **E2E Integration Test Expansion:** Expanded [backend/tests/integration/databaseE2E.test.js](file:///Users/maithlisingh_t/Desktop/LedgerGuard/backend/tests/integration/databaseE2E.test.js) to 8 comprehensive tests covering import verification, Atlas readiness, tenant health, authentication, accounting invariants, cross-tenant isolation, and transaction rollback.

### 10.3 Test Execution Summary

```text
=== BACKEND TEST SUITE (backend/) ===
Command: node --test tests/**/*.test.js
✔ Passed:  57 tests
✖ Failed:  0 tests
﹣ Skipped: 1 test (Live Atlas multi-tenant connection test skipped safely when MONGODB_URI is placeholder)
⏱ Duration: ~1,120 ms

=== DATABASE TEST SUITE (database/) ===
Command: node --test
✔ Passed:  1 test (idempotency rejects reuse with different request hash)
✖ Failed:  0 tests
﹣ Skipped: 5 tests (Live Atlas multi-document transaction & isolation tests skipped pending cluster URI)
⏱ Duration: ~92 ms
```

### 10.4 Live Verification Requirements & Environment Blockers
- **MongoDB Atlas Status:** Currently **UNCONFIGURED** in the local workspace. `MONGODB_URI` contains the template placeholder `<username>:<password>@<cluster-url>`.
- **Redis Status:** Live Redis daemon is currently **OFFLINE** on port 6379; running safely in **IN-MEMORY-FALLBACK** mode.
- **To Run With Live Services:**
  ```bash
  # In terminal:
  export MONGODB_URI="mongodb+srv://<user>:<password>@<test-cluster>/?retryWrites=true&w=majority"
  export LEDGERGUARD_TEST_PLATFORM_DB_NAME="ledgerguard_test_platform"
  export REDIS_URL="redis://127.0.0.1:6379"
  export ENABLE_LIVE_REDIS="true"
  cd backend && npm run test:live
  ```

---

## 11. Backend API Contract Review & Frontend Integration (27 November 2026)

### 11.1 Teammate Branch Analysis & Reconciliation
Following teammate Abhishek's frontend and backend progress on branch `origin/Abhishek` (commits `e25884b`, `e9b92f1`, `f5b3bea`), an architectural inspection of the API contracts and frontend views was conducted:
1. **Frontend Expectations (`frontend/src/App.tsx` & `frontend/src/services/api.ts`):**
   - The Revenue Overview chart (`Revenue()`) queries `GET /api/v1/analytics/revenue/monthly` expecting an array of `months` with fields `{ month, monthKey, revenueMinor }`.
   - The Usage Summary component (`useUsageSummary()`) queries `GET /api/v1/analytics/usage` expecting `{ organizationId, totalEvents, totalCostMinor, byMetric }` where `byMetric` is an array of `{ metricType, eventCount, totalCostMinor, currency, unit }`.
2. **Reconciliation Strategy:**
   - Rather than blindly merging or overwriting teammate branches, the analytics service on `maithli-backend` was upgraded to implement the production-grade monthly revenue aggregation and canonical usage metrics contract.
   - Maintained strict database isolation without mutating teammate schemas in [database/src/models.js](file:///Users/maithlisingh_t/Desktop/LedgerGuard/database/src/models.js).

---

### 11.2 Monthly Revenue API Contract (`GET /api/v1/analytics/revenue/monthly`)

#### Accounting Logic & Double-Entry Invariant
In double-entry bookkeeping, revenue accounts have a normal credit balance:
- Sales, accruals, and transaction completions create **Credit** entries in the `revenue` account.
- Reversals, refunds, and cancellations create **Debit** entries in the `revenue` account.
- Therefore, true net revenue is strictly:
  $$\text{netRevenueMinor} = \sum \text{Credits} - \sum \text{Debits}$$

Summing transaction records directly would miss fee splits, partial reversals, or ledger-level adjustments. Deriving monthly revenue from the ledger table ensures 100% financial consistency with the organization's trial balance.

#### Aggregation Mechanics
1. **Sliding Window:** Aggregates ledger entries across the trailing 6 calendar months:
   $$[\text{1st day of month } (M - 5), \text{1st day of month } (M + 1))$$
2. **Currency Isolation:** Strictly filters ledger entries by `currency` (defaults to `"INR"` or accepts `?currency=USD`). Summing amounts across disparate currencies is strictly prohibited.
3. **Pre-Resolution Validation:** Query parameters are validated via `validateAnalyticsQuery` before database connections or tenant routing are resolved. Invalid currency formats immediately yield HTTP 400 (`INVALID_CURRENCY`).

#### Request & Response Example
**Request:**
```http
GET /api/v1/analytics/revenue/monthly?currency=INR HTTP/1.1
Host: localhost:4000
Authorization: Bearer <RS256_JWT_TOKEN>
x-tenant-id: org_acme_001
```

**Response (HTTP 200 OK):**
```json
{
  "success": true,
  "message": "Monthly revenue retrieved.",
  "data": {
    "organizationId": "org_acme_001",
    "currency": "INR",
    "totalRevenueMinor": 1250000,
    "period": {
      "from": "2026-06-01T00:00:00.000Z",
      "to": "2026-12-01T00:00:00.000Z"
    },
    "months": [
      {
        "month": "Jun 2026",
        "monthKey": "2026-06",
        "grossRevenueMinor": 0,
        "reversalMinor": 0,
        "revenueMinor": 0
      },
      {
        "month": "Jul 2026",
        "monthKey": "2026-07",
        "grossRevenueMinor": 250000,
        "reversalMinor": 0,
        "revenueMinor": 250000
      },
      {
        "month": "Aug 2026",
        "monthKey": "2026-08",
        "grossRevenueMinor": 500000,
        "reversalMinor": 50000,
        "revenueMinor": 450000
      },
      {
        "month": "Sep 2026",
        "monthKey": "2026-09",
        "grossRevenueMinor": 300000,
        "reversalMinor": 0,
        "revenueMinor": 300000
      },
      {
        "month": "Oct 2026",
        "monthKey": "2026-10",
        "grossRevenueMinor": 100000,
        "reversalMinor": 0,
        "revenueMinor": 100000
      },
      {
        "month": "Nov 2026",
        "monthKey": "2026-11",
        "grossRevenueMinor": 150000,
        "reversalMinor": 0,
        "revenueMinor": 150000
      }
    ]
  }
}
```

---

### 11.3 Usage Analytics API Contract (`GET /api/v1/analytics/usage`)

#### Canonical Metrics & Rational Scaled Integer Invariant
1. **Canonical Metrics Enforced:**
   The backend defines standard canonical metrics to support dashboard charting:
   - `api_requests` (Default unit: `"requests"`, Label: `"API requests"`)
   - `compute_units` (Default unit: `"compute_units"`, Label: `"Compute units"`)
   - `storage` (Default unit: `"GB-day"`, Label: `"Storage"`)
2. **Zero-Fill Guarantee:**
   If a tenant has not recorded any events for a canonical metric in the requested timeframe, the backend automatically provides a zero-filled entry `{ eventCount: 0, totalQuantity: 0, totalCostMinor: 0 }`. This prevents frontend visualization components from breaking due to missing keys.
3. **Scaled Arithmetic Preservation:**
   To maintain sub-unit precision without floating-point inaccuracies, raw database quantities are stored as integers with a scale factor (`quantityScaled`, `quantityScale`). The MongoDB `$project` pipeline calculates exact rational values:
   $$\text{quantity} = \frac{\text{quantityScaled}}{\text{quantityScale}}$$

#### Request & Response Example
**Request:**
```http
GET /api/v1/analytics/usage?currency=INR HTTP/1.1
Host: localhost:4000
Authorization: Bearer <RS256_JWT_TOKEN>
x-tenant-id: org_acme_001
```

**Response (HTTP 200 OK):**
```json
{
  "success": true,
  "message": "Usage analytics retrieved.",
  "data": {
    "organizationId": "org_acme_001",
    "currency": "INR",
    "reportingPeriod": {
      "from": null,
      "to": null
    },
    "totalEvents": 45,
    "totalCostMinor": 12500,
    "byMetric": [
      {
        "metricType": "api_requests",
        "label": "API requests",
        "eventCount": 42,
        "totalQuantity": 840,
        "totalCostMinor": 8400,
        "currency": "INR",
        "unit": "requests",
        "lastRecordedAt": "2026-11-27T10:15:00.000Z"
      },
      {
        "metricType": "compute_units",
        "label": "Compute units",
        "eventCount": 3,
        "totalQuantity": 4.1,
        "totalCostMinor": 4100,
        "currency": "INR",
        "unit": "compute_units",
        "lastRecordedAt": "2026-11-27T11:30:00.000Z"
      },
      {
        "metricType": "storage",
        "label": "Storage",
        "eventCount": 0,
        "totalQuantity": 0,
        "totalCostMinor": 0,
        "currency": "INR",
        "unit": "GB-day",
        "lastRecordedAt": null
      }
    ]
  }
}
```

---

### 11.4 Comprehensive Test Suite Results

```text
=== BACKEND TEST SUITE (backend/) ===
Command: node --test tests/**/*.test.js
✔ Passed:  63 tests
✖ Failed:  0 tests
﹣ Skipped: 1 test (Live Atlas multi-tenant connection test skipped safely when MONGODB_URI is placeholder)
⏱ Duration: ~1,030 ms

=== DATABASE TEST SUITE (database/) ===
Command: node --test
✔ Passed:  1 test (idempotency rejects reuse with different request hash)
✖ Failed:  0 tests
﹣ Skipped: 5 tests (Live Atlas multi-document transaction & isolation tests skipped pending cluster URI)
⏱ Duration: ~92 ms
```

---

### 11.5 College Viva Examination Questions & Answers (Phase 5 & Analytics)

#### Q1: Why must monthly revenue be calculated from ledger entries rather than simply summing the `billing_transactions` collection?
**Answer:**
Summing raw transaction records creates severe discrepancies in real-world accounting systems:
1. **Reversals & Refunds:** When a transaction is reversed, double-entry bookkeeping posts a compensating debit entry in the revenue account. Deriving revenue directly from ledger entries ensures that refunds and partial credits automatically deduct from gross revenue:
   $$\text{Net Revenue} = \sum \text{Credits} - \sum \text{Debits}$$
2. **Fee Splits & Accruals:** A transaction amount may be split across multiple accounts (e.g. platform fees, taxes payable, and partner share). Only the double-entry ledger captures the exact portion attributable to recognized operating revenue.
3. **Auditing & Immutability:** Transactions are mutable state machines (`PENDING` $\rightarrow$ `COMPLETED` $\rightarrow$ `REVERSED`), whereas ledger entries are append-only and cryptographically auditable. Aggregating from the immutable ledger guarantees that reported revenue reconciles perfectly with the organization's trial balance.

#### Q2: How does LedgerGuard protect financial analytics and usage aggregation against multi-currency corruption?
**Answer:**
Financial quantities cannot be summed across different currency denominations without currency conversion. LedgerGuard enforces currency isolation at three separate layers:
1. **Strict Request Validation:** The controller rejects malformed or multi-currency requests before hitting the database. The currency must match a standard 3-letter ISO code (e.g. `INR`, `USD`).
2. **Aggregation Match Filter:** Aggregation pipelines explicitly filter entries: `{ organizationId, accountType: "revenue", currency: normalizedCurrency }`. Entries in different currencies are never grouped together.
3. **Minor Unit Accounting:** All currency amounts are represented as 64-bit safe integers in the currency's smallest denomination (e.g. paise for INR, cents for USD), completely avoiding binary floating-point roundoff errors (`0.1 + 0.2 !== 0.3`).

#### Q3: Why is query parameter validation (`validateAnalyticsQuery`) mounted before tenant routing (`resolveTenant`) in the Express middleware pipeline?
**Answer:**
Mounting validation before tenant database resolution follows the **Fail-Fast & Resource-Preservation Principle**:
1. In a multi-tenant database-per-tenant architecture, `resolveTenant` acquires a cached Mongoose connection from the pool, inspects JWT claims, and executes live database queries to verify user role and active status.
2. If a client submits an invalid currency parameter (e.g. `?currency=INVALID`), performing tenant database resolution first would unnecessarily consume connection pool sockets, I/O, and CPU cycles on a request destined to fail.
3. Validating inputs prior to database resolution immediately rejects bad requests at the HTTP layer (HTTP 400) without touching the database tier.

#### Q4: How does LedgerGuard handle fractional consumption (e.g., 2.75 GB of storage) without using IEEE 754 floating-point numbers?
**Answer:**
LedgerGuard employs a **Scaled Integer (Rational) Arithmetic System**:
1. Floating-point numbers suffer from precision leakage during arithmetic operations. In LedgerGuard, fractional quantities are stored as two integers: `quantityScaled` and `quantityScale` (e.g., $2.75$ GB is stored as $\text{quantityScaled} = 275$, $\text{quantityScale} = 100$).
2. During rating and billing calculations, the cost formula uses scaled integer math with half-up rounding:
   $$\text{costMinor} = \left\lfloor \frac{\text{quantityScaled} \times \text{unitPriceMinor} + \lfloor \frac{\text{quantityScale}}{2} \rfloor}{\text{quantityScale}} \right\rfloor$$
3. In aggregation queries, MongoDB's `$project` pipeline performs rational division only at the presentation layer:
   ```javascript
   $cond: [
     { $gt: ["$quantityScale", 0] },
     { $divide: ["$quantityScaled", "$quantityScale"] },
     "$quantityScaled"
   ]
   ```
This guarantees 100% deterministic pricing and perfect ledger balance.

#### Q5: How does the backend prevent frontend UI charting components from crashing when a tenant has zero usage records for a specific canonical metric?
**Answer:**
Frontend charting libraries (like SVG bar charts or Recharts) often map over an expected set of metric series. If an aggregation pipeline only returns records for metrics that exist in the database, a tenant with no `storage` records would receive an array missing the `storage` element, causing `undefined` property access errors in the UI.
LedgerGuard solves this by maintaining a fixed list of `CANONICAL_METRICS`:
```javascript
export const CANONICAL_METRICS = [
  { metricType: "api_requests", defaultUnit: "requests", label: "API requests" },
  { metricType: "compute_units", defaultUnit: "compute_units", label: "Compute units" },
  { metricType: "storage", defaultUnit: "GB-day", label: "Storage" }
];
```
After executing the aggregation query, the service maps over `CANONICAL_METRICS`. If a metric is absent from the database aggregation result, it automatically constructs a zero-filled descriptor with default units, zero cost, and null timestamps. Thus, the API contract guarantees a predictable, type-safe array of all three canonical metrics.

