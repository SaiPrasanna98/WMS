# Warehouse Operations — System Architecture

> Visual architecture reference for the fragrance/cosmetics warehouse application.  
> Companion to [design.md](../design.md) (technical detail) and [spec.md](../spec.md) (requirements).

---

## 1. System Context (C4 — Level 1)

Who uses the system and what it connects to.

```mermaid
flowchart TB
    subgraph Users["Operational Users"]
        Admin["Admin"]
        Mgr["Warehouse Manager"]
        Rcv["Receiver"]
        Wkr["Warehouse Worker"]
        Prod["Production User"]
        QC["QC User"]
        Ship["Shipping User"]
        View["Viewer"]
    end

    subgraph System["Warehouse Operations App"]
        App["WarehouseOps\nReact SPA + Express API"]
    end

    subgraph External["External (future)"]
        ERP["ERP / PO System"]
        Carrier["Carrier / Tracking"]
    end

    Admin & Mgr & Rcv & Wkr & Prod & QC & Ship & View --> App
    App -.->|"optional integration"| ERP
    App -.->|"tracking number"| Carrier
```

| Actor | Primary concern |
|-------|-----------------|
| Receiver | Inbound materials, lots, pallets, locations |
| Warehouse Worker | Moves, picks, cycle counts |
| Production User | Orders, material requests, consumption |
| QC User | Lot inspection and release |
| Shipping User | Outbound shipments (QC-passed FG only) |
| Warehouse Manager | Dashboards, inventory oversight |
| Admin | Users, roles, full access |
| Viewer | Read-only status |

---

## 2. Container Architecture (C4 — Level 2)

Major deployable parts and how they communicate.

```mermaid
flowchart LR
    subgraph Browser["Browser :3000"]
        SPA["React SPA\n(Vite + TypeScript)"]
    end

    subgraph Server["Node.js :3001"]
        API["Express REST API\n(TypeScript)"]
        MW["Middleware\nAuth + RBAC"]
        SVC["Domain Services\ninventory · validation · audit"]
        API --> MW --> SVC
    end

    subgraph Data["Persistence"]
        DB[("SQLite\nwarehouse.db")]
    end

    SPA -->|"HTTP /api/*\nJWT Bearer"| API
    SVC --> DB
```

| Container | Technology | Responsibility |
|-----------|------------|----------------|
| React SPA | Vite, React 18, TS | UI, RBAC-aware navigation, forms, dashboards |
| Express API | Node.js, Express, TS | Business rules, auth, REST endpoints |
| SQLite | better-sqlite3 | Single-file relational store, WAL mode |

**Local dev proxy:** Vite forwards `/api` → `http://localhost:3001`.

---

## 3. Layered Backend Architecture

Clean separation inside the API server.

```mermaid
flowchart TB
    subgraph Presentation["Presentation Layer"]
        Routes["Route Handlers\n14 modules"]
    end

    subgraph CrossCutting["Cross-Cutting"]
        AuthMW["authenticate\n(JWT)"]
        RBACMW["requirePermission\nblockViewerWrite"]
    end

    subgraph Domain["Domain / Service Layer"]
        InvSvc["inventory.ts\n· transactions\n· audit logs\n· qty helpers"]
        ValSvc["validation.ts\n· positive qty\n· status transitions"]
    end

    subgraph DataAccess["Data Access Layer"]
        DBMod["db/index.ts\nbetter-sqlite3"]
        Schema["schema.sql"]
        Seed["seed.ts"]
    end

    Routes --> AuthMW --> RBACMW
    RBACMW --> Routes
    Routes --> InvSvc & ValSvc
    InvSvc & ValSvc --> DBMod
    DBMod --> Schema
    Seed --> DBMod
```

### Request lifecycle

```mermaid
sequenceDiagram
    participant C as Client
    participant R as Route
    participant A as authenticate
    participant P as requirePermission
    participant V as blockViewerWrite
    participant S as Service
    participant D as SQLite

    C->>R: HTTP + Bearer token
    R->>A: Validate JWT
    A->>D: Load user, roles, permissions
    A->>P: req.user populated
    P->>V: Permission OK
    V->>S: Execute business logic
    S->>D: Transaction / query
    S->>S: Audit log + inventory tx
    S->>C: JSON response
```

---

## 4. Frontend Architecture

```mermaid
flowchart TB
    subgraph Shell["App Shell"]
        Login["LoginPage"]
        Layout["Layout\nSidebar + Topbar"]
    end

    subgraph Core["Core"]
        AuthCtx["AuthContext\nJWT · permissions · isViewer"]
        Router["React Router\nProtectedRoute"]
        Nav["navigation.ts\nRBAC menu config"]
    end

    subgraph Shared["Shared UI"]
        UI["DataTable · Modal · Alert"]
        Badge["StatusBadge"]
        API["api/client.ts\nAxios + interceptors"]
    end

    subgraph Pages["Feature Pages"]
        Dash["Dashboard"]
        Ops["Receiving · Pallets · Locations"]
        Mfg["Production · QC"]
        Out["Shipping"]
        Admin["Users · Audit Logs"]
    end

    Login --> AuthCtx
    AuthCtx --> Router --> Layout
    Layout --> Nav
    Layout --> Pages
    Pages --> API
    API -->|"REST"| Backend["Express API"]
    Pages --> UI & Badge
```

### RBAC on the client (defense in depth)

```mermaid
flowchart LR
    NavFilter["Sidebar:\nfilter NAV_ITEMS\nby permission"]
    RouteGuard["ProtectedRoute:\npermission per path"]
    UIButtons["Write buttons:\npermission + !isViewer"]
    APIEnforce["Backend:\nrequirePermission\nblockViewerWrite"]

    NavFilter --> RouteGuard --> UIButtons
    UIButtons -.->|"must match"| APIEnforce
```

The UI hides unauthorized actions; the API **always** enforces permissions regardless of UI.

---

## 5. Security & RBAC Architecture

```mermaid
flowchart TB
    subgraph Identity["Identity"]
        User["users"]
        UR["user_roles"]
        Role["roles"]
        RP["role_permissions"]
        Perm["permissions"]
    end

    User --> UR --> Role --> RP --> Perm

    subgraph Enforcement["Enforcement Points"]
        JWT["JWT token\nuserId + email"]
        MW["Middleware chain"]
        Viewer["Viewer = sole role\n→ read-only"]
    end

    Perm --> MW
    JWT --> MW
    MW --> Viewer
```

| Layer | Mechanism |
|-------|-----------|
| Authentication | bcrypt passwords, JWT (HS256), `/api/auth/me` refresh |
| Authorization | 26 permission codes, role bundles, per-route checks |
| Viewer | Sole Viewer role blocked on all non-GET |
| Audit | CREATE / UPDATE / DELETE / STATUS_CHANGE / LOGIN |

---

## 6. Data Architecture

### Entity relationship (core domain)

```mermaid
erDiagram
    products ||--o{ lots : has
    lots ||--o{ pallets : contains
    pallets }o--|| warehouse_locations : stored_at
    products ||--o{ production_orders : produces
    production_orders ||--o{ production_materials : requires
    lots ||--o{ qc_records : inspected_by
    shipments ||--o{ shipment_items : contains
    shipment_items }o--|| lots : ships_from
    purchase_orders ||--o{ receiving_records : fulfilled_by
    receiving_records }o--|| lots : creates
    receiving_records }o--|| pallets : creates
    inventory_transactions }o--|| products : tracks
    inventory_transactions }o--o| pallets : references
    users ||--o{ audit_logs : performs

    products {
        int id PK
        string sku UK
        string product_type
    }
    lots {
        int id PK
        string lot_number UK
        string qc_status
    }
    pallets {
        int id PK
        string pallet_id UK
        float quantity
        string status
    }
    inventory_transactions {
        int id PK
        string transaction_type
        float quantity
    }
```

### Inventory truth model

```mermaid
flowchart LR
    subgraph SourceOfTruth["Source of Truth"]
        Pallets["ACTIVE pallets\nSUM(quantity)\nper product"]
    end

    subgraph Ledger["Immutable Ledger"]
        Tx["inventory_transactions\nRECEIVE · MOVE · CONSUME · SHIP"]
    end

    subgraph Rules["Business Rules"]
        R1["Qty never negative"]
        R2["Every move → MOVE tx"]
        R3["FG ship → QC PASSED only"]
    end

    Pallets --> Rules
    Tx --> Rules
```

---

## 7. Operational Flow Architecture

End-to-end warehouse lifecycle.

```mermaid
flowchart TB
    subgraph Inbound["1 · Inbound"]
        Truck["Truck arrives"]
        Receive["Receiving\nlot + pallet + location"]
        Truck --> Receive
    end

    subgraph Storage["2 · Storage"]
        WH["Warehouse locations"]
        Move["Worker moves pallet\nMOVE transaction"]
        Receive --> WH
        WH --> Move
    end

    subgraph Manufacturing["3 · Manufacturing"]
        PO["Production order"]
        Req["Material requested"]
        Cons["Consume from pallet\nCONSUME transaction"]
        Move --> PO --> Req --> Cons
    end

    subgraph Quality["4 · Quality"]
        QCIn["QC inspect lot"]
        Pass["PASSED"]
        Fail["FAILED / HOLD"]
        Cons --> QCIn
        QCIn --> Pass & Fail
    end

    subgraph Outbound["5 · Outbound"]
        ShipCreate["Create shipment\nQC-passed FG + pallet"]
        ShipOut["Status → SHIPPED\nSHIP transaction"]
        Pass --> ShipCreate --> ShipOut
    end

    subgraph Oversight["6 · Oversight"]
        Dash["Manager dashboard"]
        Audit["Audit logs"]
        ShipOut --> Dash
        Receive & Move & Cons & ShipOut --> Audit
    end
```

### State machines

**Production order**

```mermaid
stateDiagram-v2
    [*] --> CREATED
    CREATED --> MATERIAL_REQUESTED
    MATERIAL_REQUESTED --> IN_PROGRESS
    IN_PROGRESS --> COMPLETED
    IN_PROGRESS --> QC_PENDING
    COMPLETED --> QC_PENDING
    QC_PENDING --> [*]
```

**Shipment**

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PICKING
    PICKING --> PACKED
    PACKED --> SHIPPED : deduct inventory\nQC-passed FG only
    SHIPPED --> [*]
```

**Lot QC**

```mermaid
stateDiagram-v2
    [*] --> PENDING
    PENDING --> PASSED
    PENDING --> FAILED
    PENDING --> HOLD
    HOLD --> PASSED : release pallets
    FAILED --> [*] : pallets quarantined
    PASSED --> [*]
```

---

## 8. Module Map

How functional modules map to code.

| Module | Backend route | Frontend page | Key permissions |
|--------|---------------|---------------|-----------------|
| Auth | `/api/auth` | LoginPage | public / session |
| Dashboard | `/api/dashboard` | DashboardPage | `dashboard.read` |
| Products | `/api/products` | ProductsPage | `products.read/write` |
| Lots | `/api/lots` | LotsPage | `lots.read/write` |
| Pallets | `/api/pallets` | PalletsPage | `pallets.read/move` |
| Locations | `/api/locations` | LocationsPage | `locations.read/write` |
| Receiving | `/api/receiving` | ReceivingPage | `receiving.read/write` |
| Production | `/api/production-orders` | ProductionOrdersPage | `production.*` |
| QC | `/api/qc` | QCPage | `qc.read/write` |
| Shipping | `/api/shipments` | ShippingPage | `shipping.read/write` |
| Inventory history | `/api/inventory-transactions` | InventoryTransactionsPage | `inventory.read` |
| Audit | `/api/audit-logs` | AuditLogsPage | `audit.read` |
| Users & roles | `/api/users`, `/api/roles` | UsersPage | `users.read`, `roles.read` |

---

## 9. Deployment Architecture (Local)

```mermaid
flowchart TB
    subgraph DevMachine["Developer Machine"]
        subgraph T1["Terminal 1"]
            BE["npm run dev\nbackend :3001"]
        end
        subgraph T2["Terminal 2"]
            FE["npm run dev\nfrontend :3000"]
        end
        DBFile[("backend/data/\nwarehouse.db")]
        BE --> DBFile
        FE -->|"proxy /api"| BE
    end

    Browser["Browser\nlocalhost:3000"] --> FE
```

| Concern | Local setup |
|---------|-------------|
| Frontend | http://localhost:3000 |
| API | http://localhost:3001 |
| Database | SQLite file, auto-init on first run |
| Secrets | `backend/.env` — JWT_SECRET, PORT |

---

## 10. Cross-Cutting Concerns

```mermaid
mindmap
  root((WarehouseOps))
    Security
      JWT auth
      RBAC permissions
      Viewer read-only
      bcrypt passwords
    Traceability
      inventory_transactions
      audit_logs
      lot numbers
      pallet IDs
    Data integrity
      Non-negative inventory
      Status transitions
      QC gate on ship
      Pallet required on ship/consume
    UX
      Role-based nav
      Status badges
      Search and filters
```

---

## 11. Future Architecture (not implemented)

Planned extensions that fit the current design without rewrites:

| Extension | Approach |
|-----------|----------|
| ERP integration | Webhook or polling adapter → `/api/receiving` |
| Barcode scanning | Frontend scanner component → pallet/location IDs |
| PostgreSQL | Swap `db/index.ts` driver; keep schema + services |
| Multi-warehouse | Add `warehouse_id` FK to locations/pallets |
| Inventory adjust API | New route gated on `inventory.adjust` |
| Real-time dashboard | SSE or WebSocket from dashboard service |

---

## Document map

| Document | Purpose |
|----------|---------|
| [spec.md](../spec.md) | What to build |
| [design.md](../design.md) | Technical design & API detail |
| **architecture.md** (this file) | Visual system architecture |
| [tasks.md](../tasks.md) | Implementation tasks |
| [README.md](../README.md) | How to run |
