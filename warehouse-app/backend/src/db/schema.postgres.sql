-- Warehouse Operations Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS permissions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  product_type TEXT NOT NULL CHECK (product_type IN ('RAW_MATERIAL', 'FINISHED_GOOD', 'PACKAGING')),
  unit_of_measure TEXT NOT NULL DEFAULT 'EA',
  unit_price REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  zone TEXT NOT NULL,
  aisle TEXT,
  rack TEXT,
  shelf TEXT,
  location_type TEXT NOT NULL CHECK (location_type IN ('STORAGE', 'STAGING', 'PRODUCTION', 'SHIPPING', 'QC')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS lots (
  id SERIAL PRIMARY KEY,
  lot_number TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  qc_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (qc_status IN ('PENDING', 'PASSED', 'FAILED', 'HOLD')),
  expiry_date TEXT,
  received_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS pallets (
  id SERIAL PRIMARY KEY,
  pallet_id TEXT NOT NULL UNIQUE,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  location_id INTEGER REFERENCES warehouse_locations(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DEPLETED', 'HOLD')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL', 'RECEIVED', 'CANCELLED')),
  expected_date TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_ordered REAL NOT NULL CHECK (quantity_ordered > 0),
  quantity_received REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS receiving_records (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER REFERENCES purchase_orders(id),
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  pallet_id INTEGER NOT NULL REFERENCES pallets(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_received REAL NOT NULL,
  received_by INTEGER NOT NULL REFERENCES users(id),
  location_id INTEGER REFERENCES warehouse_locations(id),
  received_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'RECEIVE', 'MOVE', 'PICK', 'CONSUME', 'ADJUST', 'SHIP', 'QC_HOLD', 'QC_RELEASE'
  )),
  product_id INTEGER NOT NULL REFERENCES products(id),
  lot_id INTEGER REFERENCES lots(id),
  pallet_id INTEGER REFERENCES pallets(id),
  from_location_id INTEGER REFERENCES warehouse_locations(id),
  to_location_id INTEGER REFERENCES warehouse_locations(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  reference_type TEXT,
  reference_id INTEGER,
  performed_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS production_orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_planned REAL NOT NULL,
  quantity_produced REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED', 'MATERIAL_REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'QC_PENDING'
  )),
  lot_id INTEGER REFERENCES lots(id),
  scheduled_date TEXT,
  completed_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS production_materials (
  id SERIAL PRIMARY KEY,
  production_order_id INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_required REAL NOT NULL,
  quantity_consumed REAL NOT NULL DEFAULT 0,
  pallet_id INTEGER REFERENCES pallets(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'ALLOCATED', 'CONSUMED')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS qc_records (
  id SERIAL PRIMARY KEY,
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PASSED', 'FAILED', 'HOLD')),
  inspected_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  inspected_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS shipments (
  id SERIAL PRIMARY KEY,
  shipment_number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PICKING', 'PACKED', 'SHIPPED')),
  ship_date TEXT,
  tracking_number TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS shipment_items (
  id SERIAL PRIMARY KEY,
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  pallet_id INTEGER REFERENCES pallets(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'LOGIN')),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_pallets_location ON pallets(location_id);
CREATE INDEX IF NOT EXISTS idx_pallets_lot ON pallets(lot_id);
CREATE INDEX IF NOT EXISTS idx_lots_product ON lots(product_id);
CREATE INDEX IF NOT EXISTS idx_lots_qc_status ON lots(qc_status);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_product ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_created ON inventory_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders(status);
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);

-- Order Fulfillment & Delivery Management

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Primary',
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  delivery_address_id INTEGER NOT NULL REFERENCES customer_addresses(id),
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN (
    'NEW', 'INVENTORY_CHECK', 'CONFIRMED', 'ALLOCATED', 'PICKING', 'PACKING',
    'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'
  )),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  estimated_ship_date TEXT,
  estimated_delivery_date TEXT,
  estimated_pick_date TEXT,
  estimated_pack_date TEXT,
  estimated_transit_days INTEGER,
  promise_notes TEXT,
  manager_override INTEGER NOT NULL DEFAULT 0,
  override_reason TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_ordered REAL NOT NULL CHECK (quantity_ordered > 0),
  quantity_reserved REAL NOT NULL DEFAULT 0,
  quantity_picked REAL NOT NULL DEFAULT 0,
  quantity_packed REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  pallet_id INTEGER NOT NULL REFERENCES pallets(id),
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  quantity_reserved REAL NOT NULL CHECK (quantity_reserved > 0),
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'PICKED', 'PACKED', 'RELEASED')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS fulfillment_tasks (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('PICK', 'PACK', 'RELEASE')),
  assigned_to INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS pick_lists (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS pick_list_items (
  id SERIAL PRIMARY KEY,
  pick_list_id INTEGER NOT NULL REFERENCES pick_lists(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  pallet_id INTEGER NOT NULL REFERENCES pallets(id),
  lot_id INTEGER NOT NULL REFERENCES lots(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  location_id INTEGER REFERENCES warehouse_locations(id),
  quantity_to_pick REAL NOT NULL CHECK (quantity_to_pick > 0),
  quantity_picked REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PICKED', 'SKIPPED')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS packages (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  package_barcode TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED', 'PACKED', 'RELEASED', 'IN_TRANSIT', 'DELIVERED')),
  packed_by INTEGER REFERENCES users(id),
  packed_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS package_items (
  id SERIAL PRIMARY KEY,
  package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS drivers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  license_number TEXT,
  phone TEXT,
  vehicle_info TEXT,
  status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'ON_ROUTE', 'OFF_DUTY')),
  max_active_deliveries INTEGER NOT NULL DEFAULT 3,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  driver_id INTEGER REFERENCES drivers(id),
  status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN (
    'ASSIGNED', 'ARRIVED_AT_WAREHOUSE', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED'
  )),
  pickup_location TEXT NOT NULL DEFAULT 'Main Warehouse',
  delivery_address_id INTEGER NOT NULL REFERENCES customer_addresses(id),
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  package_count INTEGER NOT NULL DEFAULT 0,
  assigned_at TEXT,
  picked_up_at TEXT,
  delivered_at TEXT,
  delivery_notes TEXT,
  carrier_name TEXT,
  tracking_number TEXT,
  delivery_method TEXT NOT NULL DEFAULT 'INTERNAL_DRIVER' CHECK (delivery_method IN ('INTERNAL_DRIVER', 'CARRIER')),
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS driver_assignments (
  id SERIAL PRIMARY KEY,
  driver_id INTEGER NOT NULL REFERENCES drivers(id),
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN (
    'ASSIGNED', 'ARRIVED_AT_WAREHOUSE', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'DELIVERY_FAILED'
  )),
  assigned_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS delivery_proofs (
  id SERIAL PRIMARY KEY,
  delivery_id INTEGER NOT NULL UNIQUE REFERENCES deliveries(id),
  recipient_name TEXT NOT NULL,
  delivered_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  signature_data TEXT,
  photo_data TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
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
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_price REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order ON inventory_reservations(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_pallet ON inventory_reservations(pallet_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_tasks_order ON fulfillment_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_tasks_assigned ON fulfillment_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_pick_lists_order ON pick_lists(order_id);
CREATE INDEX IF NOT EXISTS idx_packages_order ON packages(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);

CREATE TABLE IF NOT EXISTS customer_notifications (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  channel TEXT NOT NULL DEFAULT 'EMAIL' CHECK (channel IN ('EMAIL', 'SMS')),
  notification_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT' CHECK (status IN ('QUEUED', 'SENT', 'FAILED')),
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS order_idempotency_keys (
  idempotency_key TEXT PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS organization_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  org_name TEXT NOT NULL DEFAULT 'Warehouse Operations',
  allowed_domains TEXT NOT NULL DEFAULT 'demo.com',
  invite_expiry_days INTEGER NOT NULL DEFAULT 7,
  updated_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE TABLE IF NOT EXISTS user_invitations (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_ids TEXT NOT NULL,
  invited_by INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON user_invitations(status);
CREATE INDEX IF NOT EXISTS idx_notifications_customer ON customer_notifications(customer_id);
CREATE INDEX IF NOT EXISTS idx_notifications_order ON customer_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(purchase_order_id);
