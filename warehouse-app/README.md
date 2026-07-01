# Warehouse Operations Application

A full-stack warehouse management system for fragrance and cosmetics manufacturing and packaging companies. It covers inbound receiving, inventory, production, quality control, order-to-cash fulfillment, dispatch, delivery, and invoicing — with role-based access control (RBAC) across every module.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Demo Accounts](#demo-accounts)
- [Order-to-Cash Walkthrough](#order-to-cash-walkthrough)
- [Roles & RBAC](#roles--rbac)
- [Warehouse Operations Flow](#warehouse-operations-flow)
- [API Overview](#api-overview)
- [Running Tests](#running-tests)
- [Resetting Demo Data](#resetting-demo-data)
- [Production Notes](#production-notes)
- [Documentation](#documentation)

---

## Features

| Area | Capabilities |
|------|--------------|
| **Authentication** | JWT login, password change, user invitations |
| **RBAC** | 10 roles, 45+ granular permissions, backend + frontend enforcement |
| **Dashboard** | Inventory, pallets, QC holds, production, shipments, fulfillment metrics |
| **Catalog** | Products, lots/batches, pallets, warehouse locations |
| **Inbound** | Receiving, purchase orders, lot/pallet creation |
| **Production** | Production orders, material requests, consumption |
| **Quality** | QC pass / fail / hold on lots |
| **Inventory** | On-hand, reserved, available-for-orders (QC-gated ATP), adjustments |
| **Fulfillment** | Customers, sales orders, pick/pack, packages |
| **Outbound** | Dispatch, drivers, deliveries, proof of delivery |
| **Billing** | Invoices (quoted on order, finalized on delivery) |
| **Notifications** | Customer notification log (order created, delivered) |
| **Admin** | Users, roles, audit trail, movement history |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| Database | SQLite (better-sqlite3) |
| Authentication | JWT (jsonwebtoken) + bcrypt |
| Authorization | Permission-based RBAC |

---

## Project Structure

```
warehouse-app/
├── backend/
│   ├── src/
│   │   ├── db/              # Schema, migrations, seed data
│   │   ├── middleware/      # Auth & RBAC
│   │   ├── routes/          # REST API handlers
│   │   ├── services/        # Business logic
│   │   └── index.ts         # Express entry point
│   ├── data/                # SQLite database (auto-created)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/             # HTTP client
│   │   ├── components/      # Shared UI
│   │   ├── config/          # Navigation & RBAC
│   │   ├── context/         # Auth state
│   │   └── pages/           # Route pages
│   └── package.json
├── spec.md                  # Requirements
├── design.md                # Architecture
├── tasks.md                 # Implementation tasks
└── docs/                    # Architecture guides & metadata
```

---

## Quick Start

You need **two terminals** running at the same time.

### Prerequisites

- Node.js 18+
- npm

### Terminal 1 — Backend (start first)

```bash
cd warehouse-app/backend
npm install
npm run dev
```

Wait for: `Warehouse API running on http://localhost:3001`

Health check: http://localhost:3001/api/health → `{"status":"ok",...}`

On first run, the database is created, schema initialized, and demo data seeded automatically.

### Terminal 2 — Frontend

```bash
cd warehouse-app/frontend
npm install
npm run dev
```

Wait for: `Local: http://localhost:3000`

**Open the app:** http://localhost:3000

### Environment

Backend config lives in `backend/.env` (included for local dev):

```env
PORT=3001
JWT_SECRET=warehouse-jwt-secret-change-in-production
JWT_EXPIRES_IN=8h
DATABASE_PATH=./data/warehouse.db
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `EADDRINUSE` on 3001 | Port in use. Run `lsof -ti:3001 \| xargs kill -9`, then restart backend |
| `EADDRINUSE` on 3000 | Run `lsof -ti:3000 \| xargs kill -9`, then restart frontend |
| Login fails / API errors | Start the backend first (Terminal 1) |
| Missing menu items after upgrade | Restart backend, sign out, sign in again (permissions sync on startup) |
| Page won't load | Run `npm install` in both `backend` and `frontend` |

---

## Demo Accounts

All demo accounts use password: **`password123`**

The login page includes quick-fill buttons for each account.

| Email | Role |
|-------|------|
| admin@demo.com | Admin |
| manager@demo.com | Warehouse Manager |
| receiver@demo.com | Receiver |
| worker@demo.com | Warehouse Worker |
| production@demo.com | Production User |
| qc@demo.com | QC User |
| shipping@demo.com | Shipping User |
| sales@demo.com | Sales |
| driver@demo.com | Driver |
| viewer@demo.com | Viewer |

**Settings** (profile, change password) is available to every logged-in user via the top bar.

---

## Order-to-Cash Walkthrough

End-to-end flow for shops and distributors:

```
Receiving → Inventory → Customer order → Pick/Pack → Dispatch → Delivery → Invoice
```

| Step | Where | Suggested login |
|------|-------|-----------------|
| 1. Purchase order (optional) | Operations → Purchase orders | manager@demo.com |
| 2. Receive stock | Operations → Receiving | receiver@demo.com |
| 3. QC pass finished goods | Operations → Quality | qc@demo.com |
| 4. Create customer & order | Fulfillment → Customers, Orders | sales@demo.com |
| 5. Pick & pack | Fulfillment → Warehouse tasks | worker@demo.com |
| 6. Dispatch to driver | Fulfillment → Dispatch | manager@demo.com or shipping@demo.com |
| 7. Complete delivery | Fulfillment → Deliveries | driver@demo.com |
| 8. View invoice & notifications | Fulfillment → Invoices, Notifications | sales@demo.com |

**Inventory tip:** Only **QC PASSED** stock counts as available for orders. The Inventory page shows on-hand, reserved, and available-for-orders separately.

**Pick tip:** Scan the exact pallet code shown on the pick list (e.g. `PLT-0006`, not `PLT-006`).

---

## Roles & RBAC

### How it works

1. **Permissions** — Granular codes such as `orders.write`, `fulfillment.pick`, `qc.write`
2. **Roles** — Job functions that bundle permissions (Receiver, Sales, Driver, etc.)
3. **Users** — Assigned one or more roles

**Backend:** `authenticate` → `requirePermission(...)` → `blockViewerWrite` on every protected route.

**Frontend:** Sidebar filtered by permission; routes guarded by `ProtectedRoute`; write buttons hidden for Viewer.

### Sidebar visibility by role

| Menu item | Admin | Manager | Receiver | Worker | Production | QC | Shipping | Viewer | Driver | Sales |
|-----------|:-----:|:-------:|:--------:|:------:|:----------:|:--:|:--------:|:------:|:------:|:-----:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Inventory | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — |
| Customers | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | ✓ |
| Orders | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | ✓ |
| Warehouse tasks | ✓ | ✓ | — | ✓ | — | — | ✓ | ✓ | — | ✓ |
| Dispatch | ✓ | ✓ | — | — | — | — | ✓ | — | — | — |
| Drivers | ✓ | ✓ | — | — | — | — | ✓ | — | — | — |
| Deliveries | ✓ | ✓ | — | — | — | — | ✓ | ✓ | ✓ | — |
| Invoices | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | ✓ |
| Notifications | ✓ | ✓ | — | — | — | — | — | — | — | ✓ |
| Receiving | ✓ | ✓ | ✓ | — | — | — | — | ✓ | — | — |
| Purchase orders | ✓ | ✓ | ✓ | — | — | — | — | — | — | — |
| Pallets | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — |
| Locations | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — |
| Production | ✓ | ✓ | — | — | ✓ | — | — | ✓ | — | — |
| Quality | ✓ | ✓ | — | — | — | ✓ | — | ✓ | — | — |
| Shipping | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | — |
| Products | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Lots | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Movement history | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | — | — |
| Audit trail | ✓ | ✓ | — | — | — | — | — | — | — | — |
| Users & roles | ✓ | — | — | — | — | — | — | — | — | — |

### What each role can do

| Role | Primary responsibilities |
|------|-------------------------|
| **Admin** | Full access — users, roles, audit, all write operations |
| **Warehouse Manager** | Full ops + fulfillment; inventory adjustments; order override; no user/role admin |
| **Receiver** | Inbound receiving, PO view, create lots/pallets |
| **Warehouse Worker** | Pick, pack, move pallets; no orders, dispatch, or receiving |
| **Production User** | Production orders, material request/consumption |
| **QC User** | Pass / fail / hold lots |
| **Shipping User** | Outbound shipping module + full fulfillment (pick, pack, dispatch, deliveries, invoices) |
| **Sales** | Customers, orders, view fulfillment/invoices/notifications; no warehouse execution |
| **Driver** | Assigned deliveries only — pickup, proof of delivery |
| **Viewer** | Read-only everywhere visible; all write actions blocked |

### Quick RBAC smoke test

| Test | Login | Expected |
|------|-------|----------|
| Users & roles visible | admin@demo.com | ✓ |
| Users & roles hidden | manager@demo.com | ✓ |
| Create receiving | receiver@demo.com | ✓ |
| Pick / pack | worker@demo.com | ✓ |
| QC inspect | qc@demo.com | ✓ |
| Create order | sales@demo.com | ✓ |
| Dispatch | shipping@demo.com | ✓ |
| Complete delivery | driver@demo.com | ✓ |
| No write buttons | viewer@demo.com | ✓ |

---

## Warehouse Operations Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Receiving   │────▶│  Warehouse    │────▶│   Production    │
│  (Receiver)  │     │  (Worker)     │     │  (Production)   │
└─────────────┘     └──────────────┘     └─────────────────┘
      │                    │                      │
      ▼                    ▼                      ▼
 Create Lot/Pallet    Move Pallets          Request Materials
 Assign Location      Pick / Pack           Consume Inventory
      │                    │                      │
      └────────────────────┼──────────────────────┘
                           ▼
                    ┌──────────────┐     ┌──────────────┐
                    │  QC Inspect   │────▶│  Fulfillment  │
                    │  (QC User)    │     │  (Shipping)   │
                    └──────────────┘     └──────────────┘
                           │                      │
                     Pass/Fail/Hold         Dispatch → Deliver
```

### Business rules

- Only **QC PASSED** finished goods are available for customer orders
- Inventory cannot go negative
- Pallet moves and picks create inventory transactions
- Important actions are recorded in the audit trail
- Viewer role is strictly read-only (frontend + backend)
- Warehouse workers cannot approve inventory adjustments

---

## API Overview

Base URL: `http://localhost:3001/api`

| Group | Endpoints |
|-------|-----------|
| **Auth** | `POST /auth/login`, `GET /auth/me`, `PUT /auth/change-password` |
| **Users & roles** | `/users`, `/roles`, `/invitations` |
| **Catalog** | `/products`, `/lots`, `/pallets`, `/locations` |
| **Inbound** | `/receiving`, `/purchase-orders` |
| **Production & QC** | `/production-orders`, `/qc` |
| **Inventory** | `/inventory`, `/inventory-transactions` |
| **Fulfillment** | `/customers`, `/orders`, `/fulfillment`, `/pick-lists`, `/packages` |
| **Outbound** | `/dispatch`, `/drivers`, `/deliveries`, `/proof-of-delivery`, `/shipments` |
| **Billing** | `/invoices`, `/notifications` |
| **Admin** | `/dashboard`, `/audit-logs`, `/organization` |
| **Health** | `GET /health` |

All routes except `/auth/login`, `/health`, and invitation accept require a valid JWT.

---

## Running Tests

```bash
cd warehouse-app/backend
npm test
```

Tests cover business rules, fulfillment logic, and pick-time inventory deduction.

---

## Resetting Demo Data

Delete the database and restart the backend:

```bash
rm warehouse-app/backend/data/warehouse.db
cd warehouse-app/backend && npm run dev
```

Schema and seed data are recreated on startup.

---

## Production Notes

- Set a strong random `JWT_SECRET` (required when `NODE_ENV=production`)
- Use environment variables for all secrets — never commit real credentials
- Consider PostgreSQL instead of SQLite for multi-user production workloads
- Enable HTTPS and configure `CORS_ORIGIN` to your frontend domain
- Add rate limiting on authentication endpoints

---

## Documentation

| Document | Purpose |
|----------|---------|
| [spec.md](./spec.md) | Functional requirements and acceptance criteria |
| [design.md](./design.md) | Architecture, API design, data flow |
| [tasks.md](./tasks.md) | Implementation task breakdown |
| [docs/ARCHITECTURE-GUIDE.md](./docs/ARCHITECTURE-GUIDE.md) | Plain-English architecture guide (good starting point) |
| [docs/architecture.md](./docs/architecture.md) | Visual architecture (Mermaid diagrams) |
| [docs/emta-data.md](./docs/emta-data.md) | Project metadata |

---

## License

Internal / demo project. Update this section if you publish or open-source the codebase.
