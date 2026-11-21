# LedgerGuard Frontend MVP

React 19 + TypeScript + Vite demo frontend.

## Setup
```bash
npm install
npm run dev
```

## Demo login
Organization ID: `org_acme_001`  
Email: `admin@acmetech.example`  
Password: any non-empty value.

This is a frontend-only demo. It does not authenticate users, enforce tenant isolation, connect to MongoDB, or process real billing events.

## Pages
- Login
- Overview dashboard
- Billing ledger (search, status filter, pagination)
- Transactions
- Analytics (illustrative revenue chart)
- Settings

## Validation
```bash
npm run build
npm run lint
```

## Backend integration
Replace the demo session and in-memory records only after the backend team agrees on login, tenant context, transaction, ledger and analytics API contracts. Never treat a tenant ID supplied by the browser as an authorization boundary; the server must derive and authorize tenant context from the authenticated identity.
