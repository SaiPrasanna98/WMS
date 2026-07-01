# Warehouse Operations Application — Design

> **Visual architecture:** See [docs/architecture.md](./docs/architecture.md) for C4 diagrams, ER model, state machines, and operational flow charts.

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React + Vite)                    │
│  Login │ Layout (Sidebar + Topbar) │ Pages │ AuthContext      │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP /api/* (JWT Bearer)
┌──────────────────────────▼──────────────────────────────────┐
│                   Backend (Express + TS)                     │
│  auth middleware → rbac middleware → route handlers          │
│  services: inventory.ts (transactions, audit, helpers)       │
└──────────────────────────┬──────────────────────────────────┘
                           │ better-sqlite3
┌──────────────────────────▼──────────────────────────────────┐
│                    SQLite Database                           │
│  schema.sql │ seed.ts │ data/warehouse.db                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Backend Modules

### 2.1 Directory Structure
```
backend/src/
  index.ts              # Express app, route mounting
  db/
    index.ts            # DB connection + init
    schema.sql          # DDL
    seed.ts             # Demo data
    init.ts             # CLI init script
  middleware/
    auth.ts             # JWT authenticate
    rbac.ts             # requirePermission, blockViewerWrite
  services/
    inventory.ts        # Transactions, audit, inventory helpers
    fulfillment.ts      # ATP, reservations, pick/pack/delivery logic
  routes/
    auth.ts, users.ts, roles.ts, products.ts, lots.ts,
    pallets.ts, locations.ts, receiving.ts, productionOrders.ts,
    qc.ts, shipments.ts, inventory.ts, inventoryTransactions.ts,
    auditLogs.ts, dashboard.ts,
    customers.ts, orders.ts, orderItems.ts, fulfillment.ts,
    pickLists.ts, packages.ts, drivers.ts, deliveries.ts, proofOfDelivery.ts
  types/
    index.ts
```

### 2.2 Request Pipeline
```
Request → cors + json parser
       → route-specific: authenticate
       → route-specific: requirePermission('module.action')
       → route-specific: blockViewerWrite (mutations)
       → handler
       → JSON response
```

### 2.3 Authentication Flow
1. POST /api/auth/login with email + password
2. Verify bcrypt hash, load roles + permissions
3. Sign JWT with userId + email
4. Return token + user object
5. Client stores token in localStorage
6. Subsequent requests: Authorization: Bearer {token}
7. authenticate middleware decodes JWT, reloads permissions from DB

### 2.4 RBAC Model
- **40+ permissions** across warehouse + fulfillment modules
- **9 roles** with predefined permission sets (includes Driver)
- Admin gets all permissions
- Permissions checked by code string (e.g., `pallets.move`, `orders.confirm`)
- Frontend mirrors backend permission codes in navigation config
- `syncSchemaData()` on startup patches missing permissions/roles for existing databases

---

## 3. Database Design

### 3.1 Entity Relationships
```
users ←→ user_roles ←→ roles ←→ role_permissions ←→ permissions

products ← lots ← pallets → warehouse_locations
products ← production_orders ← production_materials
products ← shipment_items → shipments
lots ← qc_records
lots ← receiving_records → purchase_orders

inventory_transactions → products, lots, pallets, locations, users
audit_logs → users

customers ← customer_addresses
customers ← orders → order_items → products
orders ← inventory_reservations → pallets, lots
orders ← fulfillment_tasks, pick_lists ← pick_list_items
orders ← packages ← package_items
orders ← deliveries → delivery_proofs
drivers (user_id → users) ← driver_assignments → deliveries
```

### 3.2 Key Enums
| Field | Values |
|-------|--------|
| product_type | RAW_MATERIAL, FINISHED_GOOD, PACKAGING |
| qc_status | PENDING, PASSED, FAILED, HOLD |
| shipment.status | DRAFT, PICKING, PACKED, SHIPPED |
| production_order.status | CREATED, MATERIAL_REQUESTED, IN_PROGRESS, COMPLETED, QC_PENDING |
| pallet.status | ACTIVE, DEPLETED, HOLD |
| order.status | NEW, INVENTORY_CHECK, CONFIRMED, ALLOCATED, PICKING, PACKING, READY_FOR_PICKUP, IN_TRANSIT, DELIVERED, CANCELLED |
| delivery.status | ASSIGNED, ARRIVED_AT_WAREHOUSE, PICKED_UP, IN_TRANSIT, DELIVERED, DELIVERY_FAILED |
| fulfillment_task.task_type | PICK, PACK, RELEASE |
| reservation.status | RESERVED, PICKED, PACKED, RELEASED |
| transaction_type | RECEIVE, MOVE, PICK, CONSUME, ADJUST, SHIP, QC_HOLD, QC_RELEASE |
| location_type | STORAGE, STAGING, PRODUCTION, SHIPPING, QC |

### 3.3 Inventory Model
- Inventory quantity = SUM(pallets.quantity) WHERE status = 'ACTIVE' for product_id
- **ATP** = available QC-passed pallet qty − sum(active reservations for product)
- Reservations stored in `inventory_reservations` (not double-counted in pallet qty until ship)
- Negative check before consume/ship/adjust
- All movements logged in inventory_transactions

---

## 4. API Design

### 4.1 Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | No | Login |
| GET | /api/auth/me | Yes | Current user |

### 4.2 Core CRUD Pattern
| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| GET | /api/{resource} | *.read | List with search/filter |
| GET | /api/{resource}/:id | *.read | Single record |
| POST | /api/{resource} | *.write | Create + audit |
| PUT | /api/{resource}/:id | *.write | Update + audit |
| DELETE | /api/{resource}/:id | *.write | Soft delete + audit |

### 4.3 Domain Actions
| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | /api/pallets/:id/move | pallets.move | Move pallet + MOVE tx |
| POST | /api/receiving | receiving.write | Receive + lot + pallet + RECEIVE tx |
| PATCH | /api/production-orders/:id/status | production.write | Status transition |
| POST | /api/production-orders/:id/consume | production.consume | Consume material |
| POST | /api/qc/:lotId/inspect | qc.write | QC status update |
| PATCH | /api/shipments/:id/status | shipping.write | Shipment lifecycle |
| POST | /api/orders | orders.write | Create order → INVENTORY_CHECK |
| GET | /api/orders/:id/inventory-check | orders.read | ATP per line |
| POST | /api/orders/:id/confirm | orders.confirm | Reserve + allocate |
| POST | /api/fulfillment/pick/:itemId | fulfillment.pick | Scan pallet + confirm pick |
| POST | /api/packages | fulfillment.pack | Create package + barcode |
| POST | /api/drivers/:id/assign-order | deliveries.write | Assign driver |
| POST | /api/deliveries/:id/pickup | deliveries.write | Driver package pickup |
| POST | /api/proof-of-delivery | deliveries.proof | POD → DELIVERED |

### 4.4 Dashboard
GET /api/dashboard returns:
```json
{
  "cards": {
    "totalInventory", "palletsInWarehouse", "qcHoldItems",
    "ordersBeingPicked", "readyForPickup", "inTransit", "deliveredToday", ...
  },
  "lowStockItems": [],
  "recentTransactions": [],
  "qcSummary": [],
  "shipmentSummary": [],
  "fulfillmentMetrics": {}
}
```

GET /api/fulfillment/dashboard returns worker queue, tasks, due today, priority orders.

---

## 5. Frontend Design

### 5.1 Structure
```
frontend/src/
  main.tsx, App.tsx, index.css
  api/client.ts           # Axios + JWT interceptor
  context/AuthContext.tsx  # Auth state + permission helpers
  config/navigation.ts   # Nav groups with permission codes
  components/
    Layout.tsx            # Sidebar + topbar + breadcrumbs
    Breadcrumbs.tsx       # Topbar trail
    ProtectedRoute.tsx    # Auth + permission guard
    StatusBadge.tsx       # QC/shipment/production/order/delivery badges
    UI.tsx                # DataTable, Modal, Alert, etc.
  pages/                  # One page per module
  utils/breadcrumbs.ts, labels.ts, routing.ts
  types/index.ts
```

### 5.2 Navigation Groups
| Group | Pages |
|-------|-------|
| Overview | Dashboard, Inventory |
| Fulfillment | Orders, Warehouse tasks, Deliveries |
| Operations | Receiving, Pallets, Locations, Production, QC, Shipping |
| Catalog | Products, Lots |
| Administration | Movement history, Audit trail, Users |

### 5.2 Routing
- Public: /login
- Protected layout wrapper for all authenticated routes
- Each route checks specific permission via ProtectedRoute

### 5.3 RBAC in UI
- `NAV_ITEMS` filtered by `hasPermission(item.permission)`
- Write buttons hidden when `isViewer` or missing write permission
- Backend enforces regardless of UI

---

## 6. Data Flow — Key Scenarios

### 6.1 Receiving Flow
```
Receiver submits form
  → POST /api/receiving
  → Create lot (qc_status=PENDING)
  → Create pallet at location
  → Create receiving_record
  → Create RECEIVE inventory_transaction
  → Update PO status if linked
  → Create audit log
  → Return lotNumber, palletCode
```

### 6.2 Pallet Move Flow
```
Worker selects pallet + destination
  → POST /api/pallets/:id/move
  → Update pallet.location_id
  → Create MOVE inventory_transaction
  → Create audit log (STATUS_CHANGE)
```

### 6.3 Shipping Flow
```
Shipping user advances status to SHIPPED
  → PATCH /api/shipments/:id/status
  → Validate all finished good lots are QC PASSED
  → ensureNonNegativeInventory for each item
  → Deduct pallet quantities
  → Create SHIP transactions
  → Set ship_date, status=SHIPPED
  → Audit log
```

### 6.4 Order Fulfillment Flow
```
POST /api/orders → order_items → status INVENTORY_CHECK
GET /api/orders/:id/inventory-check → ATP per product line
POST /api/orders/:id/confirm
  → reserveInventoryForOrder (FIFO pallets, inventory_reservations)
  → createPickList + fulfillment_tasks (PICK, PACK)
  → status ALLOCATED
POST /api/orders/:id/start-picking → status PICKING
POST /api/fulfillment/pick/:itemId
  → validate pallet barcode scan
  → pick_list_items PICKED, reservation PICKED, PICK tx
  → when all picked → status PACKING
POST /api/packages → package_barcode, package_items
  → when all packed → status READY_FOR_PICKUP
POST /api/drivers/:id/assign-order → deliveries + driver_assignments
POST /api/deliveries/:id/pickup → scan packages → IN_TRANSIT
POST /api/proof-of-delivery → delivery_proofs → deduct pallets → SHIP tx → DELIVERED
```

---

## 7. Security Design

- Passwords: bcrypt (10 rounds)
- JWT: HS256, configurable secret + expiry
- No CSRF (SPA + JWT, per project rule)
- Viewer write blocked at middleware level
- Permission checks on every protected endpoint
- Inactive users rejected at auth

---

## 8. Error Handling

- 400: Validation / business rule violations
- 401: Missing/invalid token
- 403: Insufficient permissions
- 404: Resource not found
- 500: Unhandled server errors

Frontend: axios interceptor redirects to login on 401; Alert component for user-facing errors.

---

## 9. Testing Strategy

- Backend: Node.js built-in test runner (node:test)
  - Auth login success/failure
  - RBAC permission denial
  - Business rules (negative inventory, QC ship block)
- Frontend: TypeScript build verification
- Manual: demo user login per role

---

## 10. Deployment (Local)

```bash
# Terminal 1
cd backend && npm install && npm run dev   # :3001

# Terminal 2
cd frontend && npm install && npm run dev  # :3000
```

Vite proxies /api → localhost:3001
