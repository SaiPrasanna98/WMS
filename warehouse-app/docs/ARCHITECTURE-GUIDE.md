# Warehouse App — Simple Architecture Guide

Plain-English overview. No special tools needed to read this file.

---

## What is this app?

A **warehouse management tool** for a fragrance/cosmetics company.

Teams use it to track:
- Raw materials coming in (receiving)
- Pallets sitting in warehouse locations
- Production using those materials
- QC checking finished goods
- Shipping orders out to customers

---

## The big picture (3 parts)

```
┌─────────────────────────────────────────────────────────────────┐
│  YOUR BROWSER                                                    │
│  http://localhost:3000                                           │
│                                                                  │
│  Login page  →  Dashboard  →  Menus (Products, Pallets, etc.)   │
│  Built with: React + TypeScript                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │  calls /api/...
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  BACKEND SERVER                                                  │
│  http://localhost:3001                                           │
│                                                                  │
│  Checks login (JWT)  →  Checks role permissions  →  Saves data  │
│  Built with: Node.js + Express                                   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │  reads/writes
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  DATABASE FILE                                                   │
│  backend/data/warehouse.db                                       │
│                                                                  │
│  All tables: users, products, pallets, shipments, etc.          │
│  Built with: SQLite (single file on disk)                        │
└─────────────────────────────────────────────────────────────────┘
```

**Rule of thumb:** Browser talks to backend. Backend talks to database. Browser never touches the database directly.

---

## Who uses what?

```
┌──────────────────┬────────────────────────────────────────────┐
│ Role             │ Main job                                    │
├──────────────────┼────────────────────────────────────────────┤
│ Admin            │ Everything + users & roles                  │
│ Warehouse Manager│ Dashboards, view all, approve adjustments   │
│ Receiver         │ Receive truck, create lot & pallet          │
│ Warehouse Worker │ Move pallets between locations              │
│ Production User  │ Production orders, consume materials        │
│ QC User          │ Pass / Fail / Hold on lots                  │
│ Shipping User    │ Create & ship orders (QC-passed only)       │
│ Viewer           │ Read only — cannot change anything          │
└──────────────────┴────────────────────────────────────────────┘
```

Each person sees **only the menu items** their role allows.

---

## How login & permissions work

```
Step 1: User enters email + password on Login page
              │
              ▼
Step 2: Backend checks password (hashed in database)
              │
              ▼
Step 3: Backend returns a TOKEN (like a temporary pass)
              │
              ▼
Step 4: Browser saves token; sends it on every API call
              │
              ▼
Step 5: Backend checks token + permissions before each action
```

**Two layers of security:**
1. **Authentication** — Are you logged in? (JWT token)
2. **Authorization (RBAC)** — Are you allowed to do this? (role → permissions)

Example permission codes: `products.read`, `pallets.move`, `shipping.write`

---

## Warehouse flow (real world)

```
 TRUCK ARRIVES
      │
      ▼
 ┌─────────────┐     Receiver creates:
 │  RECEIVING  │     • Lot number
 │             │     • Pallet ID
 └──────┬──────┘     • Warehouse location
        │
        ▼
 ┌─────────────┐     Worker scans & moves:
 │  WAREHOUSE  │     • Pallet A → Location B
 │  STORAGE    │     (every move is logged)
 └──────┬──────┘
        │
        ▼
 ┌─────────────┐     Production:
 │ PRODUCTION  │     • Request materials
 │             │     • Consume from pallet
 └──────┬──────┘
        │
        ▼
 ┌─────────────┐     QC inspects lot:
 │     QC      │     PASSED / FAILED / HOLD
 └──────┬──────┘
        │
        ▼ (only PASSED finished goods)
 ┌─────────────┐     Shipping:
 │  SHIPPING   │     DRAFT → PICKING → PACKED → SHIPPED
 └─────────────┘
        │
        ▼
 ┌─────────────┐
 │  MANAGER    │     Dashboard + audit logs
 │  DASHBOARD  │
 └─────────────┘
```

---

## Main database tables (simplified)

```
USERS & ACCESS          INVENTORY               OPERATIONS
─────────────          ─────────               ──────────
users                  products                production_orders
roles                  lots                    production_materials
permissions            pallets                 qc_records
user_roles             warehouse_locations     shipments
role_permissions       inventory_transactions  shipment_items
                       receiving_records       purchase_orders
                       audit_logs
```

**How inventory is counted:**  
Sum of quantities on **ACTIVE pallets** for each product.  
Every receive, move, consume, or ship creates a row in **inventory_transactions**.

---

## Backend folder map

```
backend/
  src/
    index.ts          ← starts the server
    routes/           ← one file per feature (products, shipping, etc.)
    middleware/       ← auth + permission checks
    services/         ← shared logic (inventory, validation, audit)
    db/
      schema.sql      ← table definitions
      seed.ts         ← demo users & sample data
  data/
    warehouse.db      ← your database (created on first run)
  .env                ← port, JWT secret
```

---

## Frontend folder map

```
frontend/
  src/
    pages/            ← one screen per module (Dashboard, Shipping, etc.)
    components/       ← Layout, tables, modals
    context/          ← AuthContext (logged-in user + permissions)
    config/           ← navigation menu + permission codes
    api/client.ts     ← talks to backend
```

---

## API modules (what the backend exposes)

| URL prefix              | What it does              |
|-------------------------|---------------------------|
| /api/auth               | Login, current user       |
| /api/dashboard          | Summary cards & stats     |
| /api/products           | Product catalog           |
| /api/lots               | Lot / batch tracking      |
| /api/pallets            | Pallets + move            |
| /api/locations          | Warehouse locations       |
| /api/receiving          | Receive inventory         |
| /api/production-orders  | Manufacturing orders      |
| /api/qc                 | Quality inspections       |
| /api/shipments          | Outbound shipping         |
| /api/inventory-transactions | Movement history    |
| /api/audit-logs         | Who did what              |
| /api/users              | User list                 |
| /api/roles              | Roles & permissions       |

---

## Important business rules

1. **Only QC-PASSED finished goods can be shipped**
2. **Inventory cannot go negative**
3. **Every pallet move creates a transaction record**
4. **Important actions create audit log entries**
5. **Viewer role is read-only** (no create/update/delete)
6. **Shipping and consuming require a pallet** (not just a lot number)

---

## How to run locally

You need **two terminals** running at the same time:

**Terminal 1 — Backend (must be first):**
```bash
cd warehouse-app/backend
npm install
npm run dev
```
Wait until you see: `Warehouse API running on http://localhost:3001`

**Terminal 2 — Frontend:**
```bash
cd warehouse-app/frontend
npm install
npm run dev
```
Wait until you see: `Local: http://localhost:3000`

**Open in browser:** http://localhost:3000  
**Demo login:** admin@demo.com / password123

**Quick health check:** http://localhost:3001/api/health should show `{"status":"ok",...}`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 3001 already in use | Another backend is running. Kill it: `lsof -ti:3001 \| xargs kill -9` then restart backend |
| Port 3000 already in use | Kill it: `lsof -ti:3000 \| xargs kill -9` then restart frontend |
| Frontend loads but login fails | Backend is not running. Start Terminal 1 first |
| Blank page / connection refused | Run `npm install` in both backend and frontend folders |
| Database issues | Delete `backend/data/warehouse.db` and restart backend (recreates demo data) |

---

## Document map

| File | Best for |
|------|----------|
| **ARCHITECTURE-GUIDE.md** (this file) | Anyone — plain English + ASCII |
| spec.md | Requirements |
| design.md | Technical API & schema detail |
| docs/architecture.md | Diagram-heavy (Mermaid) version |
| README.md | Setup & demo credentials |
