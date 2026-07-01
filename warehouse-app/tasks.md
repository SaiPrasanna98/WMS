# Warehouse Operations Application — Tasks

> **Mandatory workflow:** spec.md → design.md → tasks.md → **user approval** → implement **one task at a time** → tests → mark complete.  
> **Do not write code before tasks exist.** If code was written without docs, backfill spec/design/tasks first (see Task-12 note).

---

## Phase 1: Core Warehouse Application (Tasks 1–11) ✅

## Task-1: Project scaffolding and documentation
**Status:** ✅ Complete  
**Output:** spec.md, design.md, tasks.md, docs/emta-data.md, README.md, folder structure  
**Acceptance:** All planning docs exist; project folders created

---

## Task-2: Database schema and seed data
**Status:** ✅ Complete  
**Output:** backend/src/db/schema.sql, seed.ts, index.ts  
**Acceptance:** Core tables created; 8 demo users; 10 products; 20 locations; sample data seeded idempotently

---

## Task-3: Authentication and RBAC middleware
**Status:** ✅ Complete  
**Output:** auth.ts, rbac.ts middleware; auth routes; permissions × roles  
**Acceptance:** Login returns JWT; protected routes reject unauthorized; Viewer blocked on writes

---

## Task-4: Core CRUD APIs
**Status:** ✅ Complete  
**Output:** products, lots, pallets, locations, users, roles routes  
**Acceptance:** CRUD works with permission checks and audit logging

---

## Task-5: Warehouse operations APIs
**Status:** ✅ Complete  
**Output:** receiving, pallet move, inventory-transactions routes  
**Acceptance:** Receive creates lot+pallet+tx; move creates MOVE tx

---

## Task-6: Production, QC, and Shipping APIs
**Status:** ✅ Complete  
**Output:** production-orders, qc, shipments routes  
**Acceptance:** Status transitions work; QC ship block enforced; consume deducts inventory

---

## Task-7: Dashboard and audit APIs
**Status:** ✅ Complete  
**Output:** dashboard.ts, auditLogs.ts routes  
**Acceptance:** Dashboard cards; audit log query with filters

---

## Task-8: Frontend auth, layout, and routing
**Status:** ✅ Complete  
**Output:** LoginPage, Layout, AuthContext, ProtectedRoute, App.tsx routing  
**Acceptance:** Login works; RBAC sidebar; protected routes redirect

---

## Task-9: Frontend data pages
**Status:** ✅ Complete  
**Output:** All core module pages with tables, search, forms, status badges  
**Acceptance:** Each page loads data from API; write actions respect permissions

---

## Task-10: Backend tests and verification
**Status:** ✅ Complete  
**Output:** backend/src/tests/business-rules.test.ts  
**Acceptance:** Auth, RBAC, business rule tests pass; npm test exits 0

---

## Task-11: End-to-end local verification
**Status:** ✅ Complete  
**Output:** Both servers running; health check verified; frontend builds  
**Acceptance:** Frontend builds; backend starts; /api/health returns ok

---

## Phase 2: UX & Warehouse Operations Enhancements

> **Process note:** Tasks 12–14 were implemented before tasks were written. Docs backfilled in spec.md §3.13 and design.md. Future work must not skip this order.

## Task-12: Settings, breadcrumbs, and navigation polish
**Status:** ✅ Complete (docs backfilled)  
**Spec ref:** spec.md §3.13, §10  
**Output:** SettingsPage, Breadcrumbs component, change-password API, topbar links  
**Acceptance:** Settings page works; breadcrumbs show on all pages; password change audited

---

## Task-13: Pallet and lot operational UI
**Status:** ✅ Complete (docs backfilled)  
**Spec ref:** spec.md §3.5, business rules  
**Output:** Pallet move/relocate/mark empty/adjust; Lot edit; cycle count API  
**Acceptance:** Workers can move pallets; managers can adjust; lots editable

---

## Task-14: Inventory page and manager permissions sync
**Status:** ✅ Complete (docs backfilled)  
**Output:** InventoryPage, syncSchemaData for role permissions  
**Acceptance:** On-hand view; manager has pallet.move after backend restart

---

## Phase 3: Order Fulfillment & Delivery Management

> **Process note:** Task-15 spec/design written retroactively after implementation. **Going forward: approve Task-N before code.**

## Task-15: Fulfillment — specification & design
**Status:** ✅ Complete  
**Spec ref:** spec.md §3.12, §8.2, §7 rules 10–17  
**Design ref:** design.md §3.1 ER, §6.4, fulfillment routes  
**Output:** Updated spec.md, design.md, tasks.md (this file)  
**Acceptance:** Requirements, tables, APIs, flows, RBAC, and acceptance criteria documented

---

## Task-16: Fulfillment — database schema & seed
**Status:** ✅ Complete  
**Depends on:** Task-15  
**Output:** 14 new tables in schema.sql; Driver role; fulfillment permissions; seedFulfillment(); driver@demo.com  
**Acceptance:** Tables created on init; demo orders ORD-2026-00001/002/003; syncSchemaData patches existing DBs

---

## Task-17: Fulfillment — backend services & APIs
**Status:** ✅ Complete  
**Depends on:** Task-16  
**Output:** services/fulfillment.ts; routes: customers, orders, orderItems, fulfillment, pickLists, packages, drivers, deliveries, proofOfDelivery  
**Acceptance:** Full order lifecycle; ATP check; reserve; pick/pack; driver POD; audit on status changes

---

## Task-18: Fulfillment — frontend pages & RBAC
**Status:** ✅ Complete  
**Depends on:** Task-17  
**Output:** OrdersPage, FulfillmentPage, DeliveriesPage; Fulfillment nav group; StatusBadge order/delivery types  
**Acceptance:** Role-appropriate views; driver lands on /deliveries; worker on /fulfillment

---

## Task-19: Fulfillment — dashboard metrics & tests
**Status:** ✅ Complete  
**Depends on:** Task-18  
**Output:** Fulfillment panel on DashboardPage; backend tests for ATP, reservation, pick/pack rules  
**Acceptance:** 8 fulfillment metrics on dashboard; tests cover confirm-without-ATP block, POD required

---

## Task-20: Fulfillment — documentation & README
**Status:** ✅ Complete  
**Depends on:** Task-19  
**Output:** README fulfillment section; architecture.md order flow diagram; emta-data.md index  
**Acceptance:** New user can follow README to run full O2C demo

---

## Task-21: Purchase orders, notifications, role CRUD
**Status:** ✅ Complete  
**Output:** purchase_order_items, PO module UI, receiving against PO lines, customer_notifications, role edit API/UI, Sales role  
**Acceptance:** Create PO → receive against line → inventory up; order/delivery emails logged; admin can edit role permissions

---

## Task Summary

| Task | Module | Est. Time | Status |
|------|--------|-----------|--------|
| Task-1 | Docs & scaffold | 60 min | ✅ |
| Task-2 | Database | 90 min | ✅ |
| Task-3 | Auth/RBAC | 90 min | ✅ |
| Task-4 | Core CRUD APIs | 90 min | ✅ |
| Task-5 | Warehouse ops APIs | 60 min | ✅ |
| Task-6 | Prod/QC/Ship APIs | 90 min | ✅ |
| Task-7 | Dashboard/Audit | 45 min | ✅ |
| Task-8 | Frontend shell | 90 min | ✅ |
| Task-9 | Frontend pages | 120 min | ✅ |
| Task-10 | Tests | 60 min | ✅ |
| Task-11 | Verification | 30 min | ✅ |
| Task-12 | Settings/breadcrumbs | 60 min | ✅ |
| Task-13 | Pallet/lot UI | 90 min | ✅ |
| Task-14 | Inventory/permissions | 45 min | ✅ |
| Task-15 | Fulfillment spec/design | 60 min | ✅ |
| Task-16 | Fulfillment schema/seed | 90 min | ✅ |
| Task-17 | Fulfillment backend | 120 min | ✅ |
| Task-18 | Fulfillment frontend | 120 min | ✅ |
| Task-19 | Fulfillment tests/metrics | 90 min | ⏳ |
| Task-20 | Fulfillment docs | 45 min | ⏳ |

---

## How to request work

Say exactly: **"Implement Task-19"** (or whichever task is next pending).  
Do not ask for new features without updating spec → design → tasks first.
