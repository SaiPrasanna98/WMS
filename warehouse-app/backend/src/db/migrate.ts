import db from './index';

const COLUMN_MIGRATIONS = [
  `ALTER TABLE products ADD COLUMN unit_price REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE orders ADD COLUMN estimated_pick_date TEXT`,
  `ALTER TABLE orders ADD COLUMN estimated_pack_date TEXT`,
  `ALTER TABLE orders ADD COLUMN estimated_transit_days INTEGER`,
  `ALTER TABLE orders ADD COLUMN promise_notes TEXT`,
  `ALTER TABLE drivers ADD COLUMN vehicle_info TEXT`,
  `ALTER TABLE drivers ADD COLUMN status TEXT NOT NULL DEFAULT 'AVAILABLE'`,
  `ALTER TABLE drivers ADD COLUMN max_active_deliveries INTEGER NOT NULL DEFAULT 3`,
  `ALTER TABLE deliveries ADD COLUMN carrier_name TEXT`,
  `ALTER TABLE deliveries ADD COLUMN tracking_number TEXT`,
  `ALTER TABLE deliveries ADD COLUMN delivery_method TEXT NOT NULL DEFAULT 'INTERNAL_DRIVER'`,
  `ALTER TABLE purchase_orders ADD COLUMN created_by INTEGER REFERENCES users(id)`,
];

const TABLE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL UNIQUE,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status TEXT NOT NULL DEFAULT 'QUOTE' CHECK (status IN ('QUOTE', 'SENT', 'PAID', 'VOID')),
    subtotal REAL NOT NULL DEFAULT 0,
    handling_fee REAL NOT NULL DEFAULT 0,
    shipping_fee REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    issued_at TEXT,
    due_date TEXT,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    description TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL DEFAULT 0,
    line_total REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id)`,
  `CREATE TABLE IF NOT EXISTS order_idempotency_keys (
    idempotency_key TEXT PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS organization_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    org_name TEXT NOT NULL DEFAULT 'Warehouse Operations',
    allowed_domains TEXT NOT NULL DEFAULT 'demo.com',
    invite_expiry_days INTEGER NOT NULL DEFAULT 7,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS user_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role_ids TEXT NOT NULL,
    invited_by INTEGER NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
    expires_at TEXT NOT NULL,
    accepted_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email)`,
  `CREATE INDEX IF NOT EXISTS idx_invitations_status ON user_invitations(status)`,
  `CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_ordered REAL NOT NULL CHECK (quantity_ordered > 0),
    quantity_received REAL NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id)`,
  `CREATE TABLE IF NOT EXISTS customer_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    order_id INTEGER REFERENCES orders(id),
    channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'SMS')),
    notification_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_customer ON customer_notifications(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_order ON customer_notifications(order_id)`,
];

export function runMigrations(): void {
  for (const sql of TABLE_MIGRATIONS) {
    db.exec(sql);
  }
  for (const sql of COLUMN_MIGRATIONS) {
    try {
      db.exec(sql);
    } catch {
      // column already exists
    }
  }

  db.prepare(`
    UPDATE products SET unit_price = CASE sku
      WHEN 'FG-001' THEN 24.99
      WHEN 'FG-002' THEN 34.99
      WHEN 'FG-003' THEN 29.99
      WHEN 'FG-004' THEN 19.99
      ELSE unit_price
    END
    WHERE unit_price = 0 AND product_type = 'FINISHED_GOOD'
  `).run();

  seedOrganizationSettings();
}

function seedOrganizationSettings(): void {
  db.prepare(`
    INSERT INTO organization_settings (id, org_name, allowed_domains, invite_expiry_days)
    VALUES (1, 'Warehouse Operations', 'demo.com', 7)
    ON CONFLICT(id) DO NOTHING
  `).run();
}
