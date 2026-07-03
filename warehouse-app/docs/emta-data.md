# Project Metadata (emta-data)

## Project Identity
| Field | Value |
|-------|-------|
| Project Name | Warehouse Operations Application |
| Code Name | warehouse-app |
| Domain | Fragrance & Cosmetics Manufacturing / Warehouse Management |
| Version | 1.0.0 |
| Created | 2026-06-22 |
| Status | Active Development |

## Repository Structure
| Path | Purpose |
|------|---------|
| README.md | Repository entry point (links to warehouse-app) |
| warehouse-app/spec.md | Functional specification |
| warehouse-app/design.md | Architecture and technical design |
| warehouse-app/tasks.md | Implementation task breakdown |
| warehouse-app/docs/emta-data.md | This metadata file |
| warehouse-app/README.md | Setup and usage guide |
| warehouse-app/backend/ | Node.js + Express API |
| warehouse-app/frontend/ | React + TypeScript SPA |

## Tech Stack Metadata
| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 18+ |
| Backend Framework | Express | 4.x |
| Backend Language | TypeScript | 5.x |
| Database (local) | SQLite (better-sqlite3) | 11.x |
| Database (cloud) | Neon Postgres (pg Pool) | 8.x |
| ORM / migrations | Drizzle ORM + drizzle-kit | 0.45.x |
| Auth | JWT + bcryptjs | — |
| Frontend Framework | React | 18.x |
| Build Tool | Vite | 6.x |
| HTTP Client | Axios | 1.x |
| Routing | react-router-dom | 7.x |

## Environment Variables
| Variable | Location | Default | Description |
|----------|----------|---------|-------------|
| PORT | backend/.env | 3001 | API server port |
| JWT_SECRET | backend/.env | (dev default) | JWT signing secret |
| JWT_EXPIRES_IN | backend/.env | 8h | Token expiry |
| DATABASE_PATH | backend/.env | ./data/warehouse.db | SQLite file path (used when DATABASE_URL unset) |
| DATABASE_URL | backend/.env | (unset) | Neon Postgres connection string; when set, overrides SQLite |

## Ports
| Service | Port | URL |
|---------|------|-----|
| Backend API | 3001 | http://localhost:3001 |
| Frontend Dev | 3000 | http://localhost:3000 |

## Key Entities
- users, roles, permissions (RBAC)
- products, lots, pallets, warehouse_locations (inventory)
- inventory_transactions (movement history)
- production_orders, production_materials (manufacturing)
- qc_records (quality control)
- shipments, shipment_items (fulfillment)
- audit_logs (compliance trail)

## Demo Credentials
- Password for all demo users: `password123`
- See README.md for full user/role list

## Documentation Index
1. [spec.md](../spec.md) — What to build (requirements, **§13 development process**)
2. [design.md](../design.md) — How to build it
3. [tasks.md](../tasks.md) — Implementation order (**mandatory before coding**)
4. [architecture.md](./architecture.md) — Visual system architecture (C4, ER, flows)
5. [README.md](../README.md) — How to run it

## UI Features
| Feature | Route | Description |
|---------|-------|-------------|
| Breadcrumbs | All authenticated pages | Topbar navigation trail (group / page) |
| Settings | /settings | Profile, password change, app info |
| Change password API | PUT /api/auth/change-password | Self-service password update |
| Pallet move / relocate | Pallets page | Move stock; relocate empty pallets after depletion |
| Cycle count adjust | POST /api/inventory/adjust | Manager-approved quantity corrections |
| Lot edit | Lots page | Expiry date and notes (quantity from pallets) |
| Order fulfillment | /orders, /fulfillment, /deliveries | Full O2C flow with driver POD |
| Drivers & dispatch | /drivers, /dispatch | Fleet profiles, availability, assign deliveries |
| Invoices | /invoices | Quote on confirm, send/mark paid |
| Carrier tracking | deliveries.tracking_number | FedEx/UPS tracking on delivery record |
| Fulfillment APIs | /api/customers, /api/orders, /api/fulfillment, etc. | See backend routes |

## Demo Accounts (additional)
| Email | Role | Use for |
|-------|------|---------|
| driver@demo.com | Driver | Deliveries and proof of delivery |

## Change Log
| Date | Change | Author |
|------|--------|--------|
| 2026-06-22 | Initial project metadata created | System |
| 2026-06-22 | Full application scaffold completed | System |
| 2026-06-22 | Added Settings page, breadcrumbs, change-password API | System |
| 2026-06-22 | Pallet relocate/move UI, lot edit, cycle count adjust, role permission sync | System |
| 2026-06-22 | Order fulfillment & delivery management module | System |
| 2026-06-22 | Backfilled spec.md, design.md, tasks.md for fulfillment (Kiro process) | System |
| 2026-06-22 | Drivers page, dispatch board, promise dates, invoicing, carrier tracking | System |
| 2026-06-24 | M365-style Users & roles admin: invites, domain allowlist, role catalog UI | System |
| 2026-06-24 | Audit trail detail view, entity-type filter, invitation accept flow | System |
| 2026-06-30 | Pick reduces pallet/lot qty; inventory shows Reserved column; delivery no longer double-deducts | System |
| 2026-06-22 | Comprehensive README: setup, O2C walkthrough, full RBAC matrix (10 roles), API overview | System |
| 2026-07-03 | Fix Postgres date SQL crash (date=text); prevent crash-loop on Render | System |
| 2026-07-01 | Production UX: removed demo login UI, API cold-start retry, toned down in-app copy | System |
