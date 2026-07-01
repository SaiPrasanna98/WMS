# Warehouse Operations Application — Specification

## 1. Overview

### 1.1 Purpose
Build a full-stack warehouse operations application for a fragrance/cosmetics manufacturing and packaging company. The system helps warehouse, production, QC, and shipping teams track materials, pallets, warehouse locations, production orders, inventory movement, and shipments.

### 1.2 Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Backend | Node.js + Express + TypeScript |
| Database | SQLite (better-sqlite3) |
| Authentication | JWT (jsonwebtoken) |
| Authorization | RBAC (Role-Based Access Control) |
| UI | Clean dashboard-style internal tool |

### 1.3 Project Structure
```
warehouse-app/
  spec.md
  design.md
  tasks.md
  docs/emta-data.md
  README.md
  backend/
  frontend/
```

---

## 2. Users and Roles

| Role | Responsibilities |
|------|-----------------|
| **Admin** | Manage users, roles, permissions; full system access |
| **Warehouse Manager** | View all inventory; approve inventory adjustments; dashboards and reports |
| **Receiver** | Receive purchase orders; create pallet records; assign warehouse locations |
| **Warehouse Worker** | Move pallets; pick inventory; perform cycle counts |
| **Production User** | Create/update production orders; request materials; mark materials consumed |
| **QC User** | Mark lots/batches as QC Passed, Failed, or Hold |
| **Shipping User** | Create shipments; pick finished goods; mark shipments shipped |
| **Viewer** | Read-only access to inventory and order status |
| **Driver** | View assigned deliveries; pickup packages; capture proof of delivery |
| **Sales / Shipping** | Create customer orders; manage customers (via Shipping User + Manager) |

> **Note:** Sales order creation is performed by Admin, Warehouse Manager, or Shipping User roles.

---

## 3. Functional Modules

### 3.1 Authentication & Authorization
- Secure login with bcrypt-hashed passwords
- JWT-based protected APIs
- RBAC middleware on backend
- Role-based sidebar/menu on frontend
- Viewer role: read-only (no create/update/delete)

### 3.2 Dashboard
Cards displaying:
- Total inventory
- Pallets in warehouse
- QC hold items
- Open production orders
- Pending shipments
- Low stock items

Additional panels: recent transactions, low stock alerts, QC summary, shipment summary.

### 3.3 Inventory Management
- CRUD for products (raw materials, finished goods, packaging)
- CRUD for lots/batches
- CRUD for pallets
- CRUD for warehouse locations
- Track inventory via active pallets
- Prevent negative inventory

### 3.4 Receiving
- Receive purchase orders / raw materials
- Auto-generate lot number and pallet ID (or manual entry)
- Assign warehouse location on receive
- Create RECEIVE inventory transaction
- Create audit log

### 3.5 Warehouse Operations
- Move pallet from one location to another
- Every pallet movement creates MOVE inventory transaction
- Pallet status: ACTIVE, DEPLETED, HOLD

### 3.6 Production Orders
- Status flow: CREATED → MATERIAL_REQUESTED → IN_PROGRESS → COMPLETED → QC_PENDING
- Request and consume materials
- Link to production_materials table

### 3.7 Quality Control
- QC status: PENDING, PASSED, FAILED, HOLD
- QC user can only update QC status
- Hold/release creates QC_HOLD / QC_RELEASE transactions
- Only QC-passed finished goods can be shipped

### 3.8 Shipping
- Status flow: DRAFT → PICKING → PACKED → SHIPPED
- Shipment items linked to lots/pallets
- Ship action deducts inventory and creates SHIP transaction
- Shipping user can only ship QC-passed inventory

### 3.9 Inventory Transactions
- Types: RECEIVE, MOVE, PICK, CONSUME, ADJUST, SHIP, QC_HOLD, QC_RELEASE
- Full history with product, lot, pallet, locations, user

### 3.10 Audit Logs
- Actions: CREATE, UPDATE, DELETE, STATUS_CHANGE, LOGIN
- Log all important actions with user, entity, old/new values

### 3.11 Users & Roles (Admin)
- View users and role assignments
- View roles and permission matrix

### 3.12 Order Fulfillment & Delivery Management

End-to-end customer order flow from order creation through warehouse fulfillment to driver delivery.

#### 3.12.1 Customer Order Creation
- Sales/Admin creates customer orders for finished goods
- Order statuses: `NEW` → `INVENTORY_CHECK` → `CONFIRMED` → `ALLOCATED` → `PICKING` → `PACKING` → `READY_FOR_PICKUP` → `IN_TRANSIT` → `DELIVERED` | `CANCELLED`
- Priority levels: LOW, NORMAL, HIGH, URGENT
- Unique order number generated automatically (e.g. `ORD-2026-00001`)

#### 3.12.2 Inventory Availability Check (ATP)
On order create and on demand, system shows per line item:
- **Available quantity** — QC-passed active pallet stock
- **Reserved quantity** — stock reserved for other orders
- **Available-to-promise (ATP)** — available minus reserved

Confirmation blocked if ATP insufficient unless manager override with reason.

#### 3.12.3 Order Confirmation
When confirmed (and ATP sufficient):
- Reserve inventory immediately on specific pallets (FIFO)
- Generate estimated ship date and delivery date
- Create fulfillment record (pick list + PICK/PACK tasks)
- Transition to `ALLOCATED`

#### 3.12.4 Warehouse Fulfillment
Dedicated worker dashboard showing:
- Assigned orders / tasks
- Picking and packing tasks
- Priority and due-today orders

**Picking:**
- System-generated pick list with warehouse location, pallet ID, lot/batch
- Worker scans pallet barcode and confirms picked quantity
- Inventory reservation status → PICKED; inventory transaction type PICK

**Packing:**
- Worker packs picked items into packages
- System generates package barcode
- When fully packed → order status `READY_FOR_PICKUP`

#### 3.12.5 Driver Management & Delivery
Driver role with dedicated deliveries view:
- Assigned deliveries, pickup location, delivery address, package count, priority, status

Driver statuses: `ASSIGNED` → `ARRIVED_AT_WAREHOUSE` → `PICKED_UP` → `IN_TRANSIT` → `DELIVERED` | `DELIVERY_FAILED`

**Pickup:** Driver scans package barcodes; warehouse confirms release → order `IN_TRANSIT`

**Proof of delivery:** Recipient name (required), delivery time, signature/photo (optional text storage), notes → order `DELIVERED`

#### 3.12.6 Fulfillment Dashboard Metrics
- Orders received today
- Orders awaiting inventory
- Orders being picked / packed
- Ready for pickup
- In transit
- Delivered today
- Delayed orders (past estimated delivery date)

#### 3.12.7 Fulfillment Audit Events
All logged via `audit_logs` (entity_type `order`, action `STATUS_CHANGE` with event detail):
- Order Created, Inventory Reserved, Order Confirmed, Pick Started, Pick Completed, Packed, Assigned To Driver, Picked Up By Driver, Delivered, Delivery Failed

### 3.13 UI Enhancements (post-MVP)
- **Settings** (`/settings`) — profile, password change, app info
- **Breadcrumbs** — topbar navigation trail per page group
- **Pallet operations** — move, relocate empty pallet, mark depleted, cycle count adjust
- **Lot edit** — expiry date and notes

---

## 4. Database Tables

- users
- roles
- permissions
- user_roles
- role_permissions
- products
- lots
- pallets
- warehouse_locations
- inventory_transactions
- purchase_orders
- receiving_records
- production_orders
- production_materials
- qc_records
- shipments
- shipment_items
- audit_logs
- customers
- customer_addresses
- orders
- order_items
- inventory_reservations
- fulfillment_tasks
- pick_lists
- pick_list_items
- packages
- package_items
- drivers
- driver_assignments
- deliveries
- delivery_proofs

---

## 5. API Endpoints

| Prefix | Purpose |
|--------|---------|
| /api/auth | Login, current user |
| /api/users | User management |
| /api/roles | Roles and permissions |
| /api/products | Product CRUD |
| /api/lots | Lot CRUD |
| /api/pallets | Pallet CRUD + move |
| /api/locations | Warehouse location CRUD |
| /api/receiving | Receiving records |
| /api/production-orders | Production order lifecycle |
| /api/qc | QC inspections |
| /api/shipments | Shipment lifecycle |
| /api/inventory-transactions | Transaction history |
| /api/audit-logs | Audit trail |
| /api/dashboard | Dashboard metrics |
| /api/customers | Customer and address management |
| /api/orders | Customer order lifecycle |
| /api/order-items | Order line items |
| /api/fulfillment | Worker dashboard, pick confirmation |
| /api/pick-lists | Pick lists with location/pallet/lot detail |
| /api/packages | Package creation and barcodes |
| /api/drivers | Driver profiles and assignment |
| /api/deliveries | Delivery lifecycle |
| /api/proof-of-delivery | Proof of delivery submission |
| /api/inventory | On-hand stock summary + cycle count adjust |
| /api/auth/change-password | Self-service password update |

---

## 6. Frontend Pages

| Page | Route | Required Permission |
|------|-------|---------------------|
| Login | /login | Public |
| Dashboard | /dashboard | dashboard.read |
| Users & Roles | /users | users.read |
| Products | /products | products.read |
| Lots / Batches | /lots | lots.read |
| Pallets | /pallets | pallets.read |
| Warehouse Locations | /locations | locations.read |
| Receiving | /receiving | receiving.read |
| Production Orders | /production-orders | production.read |
| QC | /qc | qc.read |
| Shipping | /shipping | shipping.read |
| Inventory Transactions | /inventory-transactions | inventory.read |
| Audit Logs | /audit-logs | audit.read |
| Inventory | /inventory | inventory.read |
| Settings | /settings | Authenticated (all users) |
| Customer Orders | /orders | orders.read |
| Warehouse Tasks | /fulfillment | fulfillment.read |
| Deliveries | /deliveries | deliveries.read |

---

## 7. Business Rules

1. Only QC-passed finished goods can be shipped
2. Inventory cannot go negative
3. Every pallet movement must create an inventory transaction
4. Every important action must create an audit log
5. Users only see menus/actions allowed by their role
6. Viewer cannot create, update, or delete anything
7. Warehouse worker cannot approve inventory adjustments
8. QC user can only update QC status
9. Shipping user can only ship QC-passed inventory
10. Inventory must be reserved immediately after order confirmation (when ATP sufficient)
11. Reserved inventory cannot be allocated to another order
12. Picking cannot start until inventory is reserved
13. Packing cannot start until picking is completed
14. Driver cannot pick up until packing is completed (`READY_FOR_PICKUP`)
15. Delivery cannot be completed without proof of delivery (recipient name)
16. Every customer order status change must create an audit log
17. Managers can view all orders and deliveries; workers see warehouse tasks; drivers see own deliveries only

---

## 8. Warehouse Flow

```
Receiving → Create Lot/Pallet → Assign Location
     ↓
Warehouse Worker → Move Pallets (scan pallet/location)
     ↓
Production → Request Materials → Consume Inventory
     ↓
QC → Pass / Fail / Hold finished goods
     ↓
Shipping → Pick → Pack → Ship (QC-passed only)
     ↓
Manager → Dashboard & Audit Logs
```

### 8.2 Customer Order Fulfillment Flow

```
Sales/Admin → Create Order → INVENTORY_CHECK (ATP)
     ↓
Confirm (or Manager Override) → Reserve Inventory → ALLOCATED
     ↓
Worker → Pick (scan pallet, confirm qty) → PACKING
     ↓
Worker → Pack → Package barcode → READY_FOR_PICKUP
     ↓
Manager → Assign Driver
     ↓
Driver → Arrive → Scan packages → IN_TRANSIT
     ↓
Driver → Proof of Delivery → DELIVERED
```

---

## 9. Seed Data Requirements

### Demo Users (password: password123)
| Email | Role |
|-------|------|
| admin@demo.com | Admin |
| manager@demo.com | Warehouse Manager |
| receiver@demo.com | Receiver |
| worker@demo.com | Warehouse Worker |
| production@demo.com | Production User |
| qc@demo.com | QC User |
| shipping@demo.com | Shipping User |
| viewer@demo.com | Viewer |
| driver@demo.com | Driver |

### Demo Data
- 10 products (5 raw materials, 5 finished goods)
- 20 warehouse locations
- 10 pallets, 5 lots
- 3 production orders, 3 shipments
- 3 sample customer orders (various fulfillment statuses)
- 1 demo driver linked to driver@demo.com
- Sample inventory transactions

---

## 10. UI Requirements

- Professional internal-tool design
- Sidebar navigation with RBAC filtering (grouped: Overview, Fulfillment, Operations, Catalog, Administration)
- Top bar with breadcrumbs, settings link, logged-in user and role
- Tables with search/filter
- Forms for create/edit
- Status badges (QC, shipment, production)
- Clear success/error messages
- Responsive layout

---

## 11. Non-Functional Requirements

- Fully runnable locally with npm install + npm run dev
- SQLite schema initialized on first run
- Seed data loaded once (idempotent)
- JWT secret configurable via .env
- README with setup, credentials, RBAC explanation, warehouse flow

---

## 12. Acceptance Criteria

- [ ] All 8 demo users can log in
- [ ] Each role sees only permitted sidebar items
- [ ] Viewer cannot perform write operations
- [ ] Receiving creates lot, pallet, transaction, audit log
- [ ] Pallet move creates MOVE transaction
- [ ] QC can update lot status
- [ ] Shipping blocked for non-QC-passed finished goods
- [ ] Dashboard shows warehouse and fulfillment metric cards
- [ ] All frontend pages render with data (including Orders, Fulfillment, Deliveries, Settings)
- [ ] Backend health check responds at /api/health
- [ ] Customer order confirm reserves inventory when ATP sufficient
- [ ] Driver cannot complete delivery without proof of delivery
- [ ] Fulfillment pick requires pallet barcode scan match

---

## 13. Development Process (Mandatory)

All new features **must** follow this order:

1. **Update `spec.md`** — what to build (requirements, rules, acceptance criteria)
2. **Update `design.md`** — how to build it (schema, APIs, flows)
3. **Update `tasks.md`** — ordered Task-N entries (30–90 min each)
4. **User approves or says "Implement Task-N"**
5. **Implement one task at a time** — code + tests for that task only
6. **Update `docs/emta-data.md`** when metadata changes

**Do not skip planning docs.** If a feature was implemented without docs, backfill spec/design/tasks before further work.
