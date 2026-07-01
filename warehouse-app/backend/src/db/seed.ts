import bcrypt from 'bcryptjs';
import db from './index';

const PERMISSIONS = [
  { code: 'users.read', name: 'View Users', module: 'users' },
  { code: 'users.write', name: 'Manage Users', module: 'users' },
  { code: 'roles.read', name: 'View Roles', module: 'roles' },
  { code: 'roles.write', name: 'Manage Roles', module: 'roles' },
  { code: 'products.read', name: 'View Products', module: 'products' },
  { code: 'products.write', name: 'Manage Products', module: 'products' },
  { code: 'lots.read', name: 'View Lots', module: 'lots' },
  { code: 'lots.write', name: 'Manage Lots', module: 'lots' },
  { code: 'pallets.read', name: 'View Pallets', module: 'pallets' },
  { code: 'pallets.write', name: 'Manage Pallets', module: 'pallets' },
  { code: 'pallets.move', name: 'Move Pallets', module: 'pallets' },
  { code: 'locations.read', name: 'View Locations', module: 'locations' },
  { code: 'locations.write', name: 'Manage Locations', module: 'locations' },
  { code: 'receiving.read', name: 'View Receiving', module: 'receiving' },
  { code: 'receiving.write', name: 'Receive Inventory', module: 'receiving' },
  { code: 'production.read', name: 'View Production Orders', module: 'production' },
  { code: 'production.write', name: 'Manage Production Orders', module: 'production' },
  { code: 'production.consume', name: 'Consume Materials', module: 'production' },
  { code: 'qc.read', name: 'View QC Records', module: 'qc' },
  { code: 'qc.write', name: 'Update QC Status', module: 'qc' },
  { code: 'shipping.read', name: 'View Shipments', module: 'shipping' },
  { code: 'shipping.write', name: 'Manage Shipments', module: 'shipping' },
  { code: 'inventory.read', name: 'View Inventory Transactions', module: 'inventory' },
  { code: 'inventory.adjust', name: 'Approve Inventory Adjustments', module: 'inventory' },
  { code: 'audit.read', name: 'View Audit Logs', module: 'audit' },
  { code: 'dashboard.read', name: 'View Dashboard', module: 'dashboard' },
  { code: 'customers.read', name: 'View Customers', module: 'customers' },
  { code: 'customers.write', name: 'Manage Customers', module: 'customers' },
  { code: 'orders.read', name: 'View Orders', module: 'orders' },
  { code: 'orders.write', name: 'Create Orders', module: 'orders' },
  { code: 'orders.confirm', name: 'Confirm Orders', module: 'orders' },
  { code: 'orders.override', name: 'Override Inventory Check', module: 'orders' },
  { code: 'fulfillment.read', name: 'View Fulfillment', module: 'fulfillment' },
  { code: 'fulfillment.pick', name: 'Execute Picking', module: 'fulfillment' },
  { code: 'fulfillment.pack', name: 'Execute Packing', module: 'fulfillment' },
  { code: 'drivers.read', name: 'View Drivers', module: 'drivers' },
  { code: 'drivers.write', name: 'Manage Drivers', module: 'drivers' },
  { code: 'deliveries.read', name: 'View Deliveries', module: 'deliveries' },
  { code: 'deliveries.write', name: 'Manage Deliveries', module: 'deliveries' },
  { code: 'deliveries.proof', name: 'Submit Proof of Delivery', module: 'deliveries' },
  { code: 'invoices.read', name: 'View Invoices', module: 'invoices' },
  { code: 'invoices.write', name: 'Manage Invoices', module: 'invoices' },
  { code: 'purchase_orders.read', name: 'View Purchase Orders', module: 'purchase_orders' },
  { code: 'purchase_orders.write', name: 'Manage Purchase Orders', module: 'purchase_orders' },
  { code: 'notifications.read', name: 'View Customer Notifications', module: 'notifications' },
];

const ROLES = [
  { name: 'Admin', description: 'Full system access' },
  { name: 'Warehouse Manager', description: 'View all inventory, approve adjustments, dashboards' },
  { name: 'Receiver', description: 'Receive purchase orders, create pallets, assign locations' },
  { name: 'Warehouse Worker', description: 'Move pallets, pick inventory, cycle counts' },
  { name: 'Production User', description: 'Create production orders, request and consume materials' },
  { name: 'QC User', description: 'Update QC status on lots/batches' },
  { name: 'Shipping User', description: 'Create shipments, pick and ship finished goods' },
  { name: 'Viewer', description: 'Read-only access' },
  { name: 'Driver', description: 'Deliver orders and capture proof of delivery' },
  { name: 'Sales', description: 'Create customer orders and manage shop accounts' },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  'Admin': PERMISSIONS.map(p => p.code),
  'Warehouse Manager': [
    'products.read', 'lots.read', 'lots.write', 'pallets.read', 'pallets.write', 'pallets.move',
    'locations.read', 'locations.write',
    'receiving.read', 'production.read', 'qc.read', 'shipping.read',
    'inventory.read', 'inventory.adjust', 'audit.read', 'dashboard.read',
    'customers.read', 'customers.write', 'orders.read', 'orders.write', 'orders.confirm', 'orders.override',
    'fulfillment.read', 'fulfillment.pick', 'fulfillment.pack',
    'drivers.read', 'drivers.write', 'deliveries.read', 'deliveries.write',
    'invoices.read', 'invoices.write',
    'purchase_orders.read', 'purchase_orders.write',
    'notifications.read',
  ],
  'Receiver': [
    'products.read', 'lots.read', 'lots.write', 'pallets.read', 'pallets.write',
    'locations.read', 'receiving.read', 'receiving.write', 'inventory.read', 'dashboard.read',
    'purchase_orders.read',
  ],
  'Warehouse Worker': [
    'products.read', 'lots.read', 'pallets.read', 'pallets.move',
    'locations.read', 'inventory.read', 'dashboard.read',
    'fulfillment.read', 'fulfillment.pick', 'fulfillment.pack', 'deliveries.write',
  ],
  'Production User': [
    'products.read', 'lots.read', 'pallets.read', 'locations.read',
    'production.read', 'production.write', 'production.consume',
    'inventory.read', 'dashboard.read',
  ],
  'QC User': [
    'products.read', 'lots.read', 'qc.read', 'qc.write', 'dashboard.read',
  ],
  'Shipping User': [
    'products.read', 'lots.read', 'pallets.read', 'locations.read',
    'shipping.read', 'shipping.write', 'inventory.read', 'dashboard.read',
    'customers.read', 'customers.write', 'orders.read', 'orders.write', 'orders.confirm',
    'fulfillment.read', 'fulfillment.pick', 'fulfillment.pack',
    'drivers.read', 'drivers.write', 'deliveries.read', 'deliveries.write',
    'invoices.read', 'invoices.write',
  ],
  'Viewer': [
    'products.read', 'lots.read', 'pallets.read', 'locations.read',
    'receiving.read', 'production.read', 'qc.read', 'shipping.read',
    'inventory.read', 'dashboard.read',
    'customers.read', 'orders.read', 'fulfillment.read', 'deliveries.read', 'invoices.read',
  ],
  'Driver': [
    'dashboard.read', 'deliveries.read', 'deliveries.write', 'deliveries.proof',
  ],
  'Sales': [
    'dashboard.read', 'customers.read', 'customers.write',
    'orders.read', 'orders.write', 'orders.confirm',
    'fulfillment.read', 'invoices.read', 'notifications.read',
  ],
};

const DEMO_USERS = [
  { email: 'admin@demo.com', password: 'password123', fullName: 'Admin User', role: 'Admin' },
  { email: 'manager@demo.com', password: 'password123', fullName: 'Warehouse Manager', role: 'Warehouse Manager' },
  { email: 'receiver@demo.com', password: 'password123', fullName: 'Receiving Clerk', role: 'Receiver' },
  { email: 'worker@demo.com', password: 'password123', fullName: 'Warehouse Worker', role: 'Warehouse Worker' },
  { email: 'production@demo.com', password: 'password123', fullName: 'Production Operator', role: 'Production User' },
  { email: 'qc@demo.com', password: 'password123', fullName: 'QC Inspector', role: 'QC User' },
  { email: 'shipping@demo.com', password: 'password123', fullName: 'Shipping Clerk', role: 'Shipping User' },
  { email: 'viewer@demo.com', password: 'password123', fullName: 'Read Only Viewer', role: 'Viewer' },
  { email: 'driver@demo.com', password: 'password123', fullName: 'Delivery Driver', role: 'Driver' },
  { email: 'sales@demo.com', password: 'password123', fullName: 'Sales Representative', role: 'Sales' },
];

/** Inserts missing permissions and roles for existing databases. */
export function syncSchemaData(): void {
  const insertPerm = db.prepare('INSERT OR IGNORE INTO permissions (code, name, module) VALUES (?, ?, ?)');
  for (const p of PERMISSIONS) {
    insertPerm.run(p.code, p.name, p.module);
  }
  const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
  for (const r of ROLES) {
    insertRole.run(r.name, r.description);
  }
  syncRolePermissions();

  const driverUser = db.prepare('SELECT id FROM users WHERE email = ?').get('driver@demo.com') as { id: number } | undefined;
  if (!driverUser) {
    const hash = bcrypt.hashSync('password123', 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)')
      .run('driver@demo.com', hash, 'Delivery Driver');
    const userId = Number(result.lastInsertRowid);
    const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('Driver') as { id: number } | undefined;
    if (role) {
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, role.id);
    }
    db.prepare('INSERT OR IGNORE INTO drivers (user_id, license_number, phone) VALUES (?, ?, ?)')
      .run(userId, 'DL-DEMO-001', '555-0100');
  } else {
    const hasDriver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(driverUser.id);
    if (!hasDriver) {
      db.prepare('INSERT INTO drivers (user_id, license_number, phone) VALUES (?, ?, ?)')
        .run(driverUser.id, 'DL-DEMO-001', '555-0100');
    }
  }

  const salesUser = db.prepare('SELECT id FROM users WHERE email = ?').get('sales@demo.com') as { id: number } | undefined;
  if (!salesUser) {
    const hash = bcrypt.hashSync('password123', 10);
    const result = db.prepare('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)')
      .run('sales@demo.com', hash, 'Sales Representative');
    const userId = Number(result.lastInsertRowid);
    const role = db.prepare('SELECT id FROM roles WHERE name = ?').get('Sales') as { id: number } | undefined;
    if (role) {
      db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, role.id);
    }
  }

  syncDemoCustomers();
}

function syncDemoCustomers(): void {
  const count = db.prepare('SELECT COUNT(*) as c FROM customers').get() as { c: number };
  if (count.c > 0) return;

  const demoCustomers = [
    {
      name: 'Luxury Retail Co',
      email: 'orders@luxuryretail.com',
      phone: '555-1000',
      address: { line1: '100 Fashion Ave', city: 'New York', state: 'NY', postalCode: '10001' },
    },
    {
      name: 'Beauty Boutique',
      email: 'buyer@beautyboutique.com',
      phone: '555-2000',
      address: { line1: '42 Market Street', city: 'Chicago', state: 'IL', postalCode: '60601' },
    },
    {
      name: 'Online Store Direct',
      email: 'fulfillment@onlinestore.com',
      phone: '555-3000',
      address: { line1: '500 Commerce Blvd', city: 'Dallas', state: 'TX', postalCode: '75201' },
    },
  ];

  for (const c of demoCustomers) {
    const result = db.prepare('INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)').run(c.name, c.email, c.phone);
    const customerId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO customer_addresses (customer_id, label, line1, city, state, postal_code, country, is_default)
      VALUES (?, 'Primary', ?, ?, ?, ?, 'US', 1)
    `).run(customerId, c.address.line1, c.address.city, c.address.state, c.address.postalCode);
  }
}

/** Keeps role permissions in sync when new permissions are added (existing databases). */
export function syncRolePermissions(): void {
  const getPermId = db.prepare('SELECT id FROM permissions WHERE code = ?');
  const getRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');
  const hasRolePerm = db.prepare('SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?');
  const insertRolePerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = getRoleId.get(roleName) as { id: number } | undefined;
    if (!role) continue;
    for (const permCode of perms) {
      const perm = getPermId.get(permCode) as { id: number } | undefined;
      if (!perm || hasRolePerm.get(role.id, perm.id)) continue;
      insertRolePerm.run(role.id, perm.id);
    }
  }
}

export function seedDatabase(): void {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count > 0) {
    syncSchemaData();
    return;
  }

  const insertPerm = db.prepare('INSERT INTO permissions (code, name, module) VALUES (?, ?, ?)');
  for (const p of PERMISSIONS) {
    insertPerm.run(p.code, p.name, p.module);
  }

  const insertRole = db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)');
  for (const r of ROLES) {
    insertRole.run(r.name, r.description);
  }

  const getPermId = db.prepare('SELECT id FROM permissions WHERE code = ?');
  const getRoleId = db.prepare('SELECT id FROM roles WHERE name = ?');
  const insertRolePerm = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = getRoleId.get(roleName) as { id: number };
    for (const permCode of perms) {
      const perm = getPermId.get(permCode) as { id: number };
      insertRolePerm.run(role.id, perm.id);
    }
  }

  const insertUser = db.prepare('INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)');
  const insertUserRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');

  for (const u of DEMO_USERS) {
    const hash = bcrypt.hashSync(u.password, 10);
    const result = insertUser.run(u.email, hash, u.fullName);
    const userId = Number(result.lastInsertRowid);
    const role = getRoleId.get(u.role) as { id: number };
    insertUserRole.run(userId, role.id);
  }

  seedProducts();
  seedLocations();
  seedLotsAndPallets();
  seedPurchaseOrders();
  seedProductionOrders();
  seedShipments();
  seedInventoryTransactions();
  seedFulfillment();
  syncSchemaData();
}

function seedProducts(): void {
  const products = [
    { sku: 'RM-001', name: 'Ethanol 96%', type: 'RAW_MATERIAL', uom: 'L', reorder: 500 },
    { sku: 'RM-002', name: 'Fragrance Oil - Rose', type: 'RAW_MATERIAL', uom: 'KG', reorder: 50 },
    { sku: 'RM-003', name: 'Fragrance Oil - Lavender', type: 'RAW_MATERIAL', uom: 'KG', reorder: 50 },
    { sku: 'RM-004', name: 'Distilled Water', type: 'RAW_MATERIAL', uom: 'L', reorder: 1000 },
    { sku: 'RM-005', name: 'Glycerin USP', type: 'RAW_MATERIAL', uom: 'KG', reorder: 100 },
    { sku: 'FG-001', name: 'Rose Eau de Parfum 50ml', type: 'FINISHED_GOOD', uom: 'EA', reorder: 200 },
    { sku: 'FG-002', name: 'Lavender Body Mist 100ml', type: 'FINISHED_GOOD', uom: 'EA', reorder: 300 },
    { sku: 'FG-003', name: 'Vanilla Perfume 30ml', type: 'FINISHED_GOOD', uom: 'EA', reorder: 150 },
    { sku: 'FG-004', name: 'Citrus Cologne 75ml', type: 'FINISHED_GOOD', uom: 'EA', reorder: 250 },
    { sku: 'FG-005', name: 'Floral Gift Set', type: 'FINISHED_GOOD', uom: 'EA', reorder: 100 },
  ];

  const insert = db.prepare(`
    INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const p of products) {
    insert.run(p.sku, p.name, p.type, p.uom, p.reorder, `${p.name} - demo product`);
  }
}

function seedLocations(): void {
  const zones = ['A', 'B', 'C', 'D'];
  const types = ['STORAGE', 'STAGING', 'PRODUCTION', 'SHIPPING', 'QC'] as const;
  const insert = db.prepare(`
    INSERT INTO warehouse_locations (code, zone, aisle, rack, shelf, location_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  for (const zone of zones) {
    for (let aisle = 1; aisle <= 5 && count < 20; aisle++) {
      const type = types[count % types.length];
      insert.run(
        `${zone}-${String(aisle).padStart(2, '0')}-01`,
        zone,
        String(aisle),
        '01',
        '01',
        type
      );
      count++;
    }
  }
}

function seedLotsAndPallets(): void {
  const products = db.prepare('SELECT id, sku, product_type FROM products').all() as {
    id: number; sku: string; product_type: string;
  }[];
  const locations = db.prepare('SELECT id FROM warehouse_locations WHERE location_type = ?').all('STORAGE') as { id: number }[];

  const lotData = [
    { lot: 'LOT-2024-001', productIdx: 0, qty: 1000, qc: 'PASSED' },
    { lot: 'LOT-2024-002', productIdx: 1, qty: 200, qc: 'PASSED' },
    { lot: 'LOT-2024-003', productIdx: 5, qty: 500, qc: 'PASSED' },
    { lot: 'LOT-2024-004', productIdx: 6, qty: 300, qc: 'HOLD' },
    { lot: 'LOT-2024-005', productIdx: 2, qty: 150, qc: 'PENDING' },
  ];

  const insertLot = db.prepare(`
    INSERT INTO lots (lot_number, product_id, quantity, qc_status, received_date)
    VALUES (?, ?, ?, ?, date('now'))
  `);
  const insertPallet = db.prepare(`
    INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id, status)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
  `);

  let palletNum = 1;
  for (const l of lotData) {
    const product = products[l.productIdx];
    const lotResult = insertLot.run(l.lot, product.id, l.qty, l.qc);
    const lotId = Number(lotResult.lastInsertRowid);

    const numPallets = l.productIdx < 5 ? 2 : 1;
    const qtyPerPallet = l.qty / numPallets;

    for (let i = 0; i < numPallets && palletNum <= 10; i++) {
      const loc = locations[(palletNum - 1) % locations.length];
      insertPallet.run(
        `PLT-${String(palletNum).padStart(4, '0')}`,
        lotId,
        product.id,
        qtyPerPallet,
        loc.id
      );
      palletNum++;
    }
  }

  // Demo empty pallet on upper shelf — use Relocate to move to lower location
  const topLoc = db.prepare(`
    SELECT id FROM warehouse_locations WHERE shelf = '01' AND location_type = 'STORAGE' LIMIT 1
  `).get() as { id: number } | undefined;
  if (topLoc && products[0]) {
    const lot = db.prepare('SELECT id FROM lots WHERE lot_number = ?').get('LOT-2024-001') as { id: number };
    insertPallet.run('PLT-EMPTY-01', lot.id, products[0].id, 0, topLoc.id);
    db.prepare(`UPDATE pallets SET status = 'DEPLETED' WHERE pallet_id = 'PLT-EMPTY-01'`).run();
  }
}

function seedPurchaseOrders(): void {
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@demo.com') as { id: number } | undefined;
  const rm = db.prepare('SELECT id FROM products WHERE sku = ?').get('RM-001') as { id: number } | undefined;

  const po1 = db.prepare(`
    INSERT INTO purchase_orders (po_number, supplier_name, status, expected_date, created_by)
    VALUES ('PO-2024-001', 'ChemSupply Inc', 'RECEIVED', date('now', '+7 days'), ?)
  `).run(admin?.id ?? 1);
  const po2 = db.prepare(`
    INSERT INTO purchase_orders (po_number, supplier_name, status, expected_date, created_by)
    VALUES ('PO-2024-002', 'Fragrance World Ltd', 'OPEN', date('now', '+14 days'), ?)
  `).run(admin?.id ?? 1);

  if (rm) {
    db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost)
      VALUES (?, ?, 500, 500, 12.5)
    `).run(Number(po1.lastInsertRowid), rm.id);
    db.prepare(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost)
      VALUES (?, ?, 1000, 0, 11.75)
    `).run(Number(po2.lastInsertRowid), rm.id);
  }
}

function seedProductionOrders(): void {
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('production@demo.com') as { id: number };
  const fgProduct = db.prepare('SELECT id FROM products WHERE sku = ?').get('FG-001') as { id: number };
  const lot = db.prepare('SELECT id FROM lots WHERE lot_number = ?').get('LOT-2024-003') as { id: number };

  const insertPO = db.prepare(`
    INSERT INTO production_orders (order_number, product_id, quantity_planned, quantity_produced, status, lot_id, scheduled_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, date('now', '+3 days'), ?)
  `);

  insertPO.run('PRO-2024-001', fgProduct.id, 500, 0, 'CREATED', null, admin.id);
  insertPO.run('PRO-2024-002', fgProduct.id, 300, 150, 'IN_PROGRESS', null, admin.id);
  insertPO.run('PRO-2024-003', fgProduct.id, 200, 200, 'QC_PENDING', lot.id, admin.id);

  const rmProducts = db.prepare(`SELECT id FROM products WHERE product_type = 'RAW_MATERIAL' LIMIT 3`).all() as { id: number }[];
  const po1 = db.prepare('SELECT id FROM production_orders WHERE order_number = ?').get('PRO-2024-001') as { id: number };
  const insertMat = db.prepare(`
    INSERT INTO production_materials (production_order_id, product_id, quantity_required, status)
    VALUES (?, ?, ?, 'REQUESTED')
  `);
  insertMat.run(po1.id, rmProducts[0].id, 50);
  insertMat.run(po1.id, rmProducts[1].id, 10);
}

function seedShipments(): void {
  const shippingUser = db.prepare('SELECT id FROM users WHERE email = ?').get('shipping@demo.com') as { id: number };
  const fgProduct = db.prepare('SELECT id FROM products WHERE sku = ?').get('FG-001') as { id: number };
  const passedLot = db.prepare('SELECT id FROM lots WHERE qc_status = ? LIMIT 1').get('PASSED') as { id: number };

  const insertShip = db.prepare(`
    INSERT INTO shipments (shipment_number, customer_name, status, created_by)
    VALUES (?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO shipment_items (shipment_id, product_id, lot_id, quantity)
    VALUES (?, ?, ?, ?)
  `);

  const s1 = insertShip.run('SHP-2024-001', 'Luxury Retail Co', 'DRAFT', shippingUser.id);
  insertItem.run(Number(s1.lastInsertRowid), fgProduct.id, passedLot.id, 100);

  const s2 = insertShip.run('SHP-2024-002', 'Beauty Boutique', 'PICKING', shippingUser.id);
  insertItem.run(Number(s2.lastInsertRowid), fgProduct.id, passedLot.id, 50);

  const s3 = insertShip.run('SHP-2024-003', 'Online Store Direct', 'PACKED', shippingUser.id);
  insertItem.run(Number(s3.lastInsertRowid), fgProduct.id, passedLot.id, 75);
}

function seedInventoryTransactions(): void {
  const receiver = db.prepare('SELECT id FROM users WHERE email = ?').get('receiver@demo.com') as { id: number };
  const worker = db.prepare('SELECT id FROM users WHERE email = ?').get('worker@demo.com') as { id: number };
  const products = db.prepare('SELECT id FROM products LIMIT 3').all() as { id: number }[];
  const lots = db.prepare('SELECT id FROM lots LIMIT 3').all() as { id: number }[];
  const pallets = db.prepare('SELECT id, location_id FROM pallets LIMIT 3').all() as { id: number; location_id: number }[];
  const locations = db.prepare('SELECT id FROM warehouse_locations LIMIT 5').all() as { id: number }[];

  const insert = db.prepare(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run('RECEIVE', products[0].id, lots[0].id, pallets[0].id, null, pallets[0].location_id, 500, receiver.id, 'Initial receiving');
  insert.run('RECEIVE', products[1].id, lots[1].id, pallets[1].id, null, pallets[1].location_id, 100, receiver.id, 'Fragrance oil received');
  insert.run('MOVE', products[0].id, lots[0].id, pallets[0].id, locations[0].id, locations[1].id, 500, worker.id, 'Moved to staging');
  insert.run('PICK', products[2].id, lots[2].id, pallets[2].id, locations[2].id, null, 50, worker.id, 'Picked for production');
  insert.run('CONSUME', products[0].id, lots[0].id, null, locations[1].id, null, 25, worker.id, 'Consumed in production');
}

function seedFulfillment(): void {
  const admin = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@demo.com') as { id: number };
  const driverUser = db.prepare('SELECT id FROM users WHERE email = ?').get('driver@demo.com') as { id: number };
  const fgProduct = db.prepare('SELECT id FROM products WHERE sku = ?').get('FG-001') as { id: number };

  db.prepare('INSERT INTO drivers (user_id, license_number, phone) VALUES (?, ?, ?)')
    .run(driverUser.id, 'DL-DEMO-001', '555-0100');
  const driver = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(driverUser.id) as { id: number };

  const custResult = db.prepare(`INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)`)
    .run('Luxury Retail Co', 'orders@luxuryretail.com', '555-1000');
  const customerId = Number(custResult.lastInsertRowid);

  const addrResult = db.prepare(`
    INSERT INTO customer_addresses (customer_id, label, line1, city, state, postal_code, country, is_default)
    VALUES (?, 'HQ', '100 Fashion Ave', 'New York', 'NY', '10001', 'US', 1)
  `).run(customerId);
  const addressId = Number(addrResult.lastInsertRowid);

  const orderResult = db.prepare(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, estimated_ship_date, estimated_delivery_date, created_by)
    VALUES ('ORD-2026-00001', ?, ?, 'ALLOCATED', 'HIGH', date('now', '+1 day'), date('now', '+3 days'), ?)
  `).run(customerId, addressId, admin.id);
  const orderId = Number(orderResult.lastInsertRowid);

  const itemResult = db.prepare(`
    INSERT INTO order_items (order_id, product_id, quantity_ordered, quantity_reserved)
    VALUES (?, ?, 100, 100)
  `).run(orderId, fgProduct.id);
  const orderItemId = Number(itemResult.lastInsertRowid);

  const pallet = db.prepare(`
    SELECT pl.id, pl.lot_id, pl.quantity FROM pallets pl
    JOIN lots l ON l.id = pl.lot_id
    WHERE pl.product_id = ? AND pl.status = 'ACTIVE' AND l.qc_status = 'PASSED' LIMIT 1
  `).get(fgProduct.id) as { id: number; lot_id: number; quantity: number };

  if (pallet) {
    db.prepare(`
      INSERT INTO inventory_reservations (order_id, order_item_id, product_id, pallet_id, lot_id, quantity_reserved, status)
      VALUES (?, ?, ?, ?, ?, 100, 'RESERVED')
    `).run(orderId, orderItemId, fgProduct.id, pallet.id, pallet.lot_id);

    const plResult = db.prepare(`INSERT INTO pick_lists (order_id, status) VALUES (?, 'PENDING')`).run(orderId);
    const pickListId = Number(plResult.lastInsertRowid);
    const loc = db.prepare('SELECT location_id FROM pallets WHERE id = ?').get(pallet.id) as { location_id: number };

    db.prepare(`
      INSERT INTO pick_list_items (pick_list_id, order_item_id, pallet_id, lot_id, product_id, location_id, quantity_to_pick)
      VALUES (?, ?, ?, ?, ?, ?, 100)
    `).run(pickListId, orderItemId, pallet.id, pallet.lot_id, fgProduct.id, loc.location_id);

    db.prepare(`INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date) VALUES (?, 'PICK', 'PENDING', 'HIGH', date('now'))`).run(orderId);
    db.prepare(`INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date) VALUES (?, 'PACK', 'PENDING', 'HIGH', date('now'))`).run(orderId);
  }

  db.prepare(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, created_by, notes)
    VALUES ('ORD-2026-00002', ?, ?, 'INVENTORY_CHECK', 'NORMAL', ?, 'Awaiting inventory check')
  `).run(customerId, addressId, admin.id);

  db.prepare(`
    INSERT INTO order_items (order_id, product_id, quantity_ordered)
    SELECT id, ?, 500 FROM orders WHERE order_number = 'ORD-2026-00002'
  `).run(fgProduct.id);

  db.prepare(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, estimated_ship_date, estimated_delivery_date, created_by)
    VALUES ('ORD-2026-00003', ?, ?, 'READY_FOR_PICKUP', 'URGENT', date('now'), date('now', '+1 day'), ?)
  `).run(customerId, addressId, admin.id);

  const readyOrder = db.prepare('SELECT id FROM orders WHERE order_number = ?').get('ORD-2026-00003') as { id: number };
  db.prepare(`INSERT INTO order_items (order_id, product_id, quantity_ordered, quantity_reserved, quantity_picked, quantity_packed) VALUES (?, ?, 50, 50, 50, 50)`)
    .run(readyOrder.id, fgProduct.id);

  db.prepare(`
    INSERT INTO packages (order_id, package_barcode, status, packed_by, packed_at)
    VALUES (?, 'PKG-3-001', 'PACKED', ?, datetime('now'))
  `).run(readyOrder.id, admin.id);

  db.prepare(`
    INSERT INTO deliveries (order_id, driver_id, status, delivery_address_id, priority, package_count, assigned_at, pickup_location)
    VALUES (?, ?, 'ASSIGNED', ?, 'URGENT', 1, datetime('now'), 'Main Warehouse')
  `).run(readyOrder.id, driver.id, addressId);

  const delivery = db.prepare('SELECT id FROM deliveries WHERE order_id = ?').get(readyOrder.id) as { id: number };
  db.prepare(`INSERT INTO driver_assignments (driver_id, delivery_id, order_id, status) VALUES (?, ?, ?, 'ASSIGNED')`)
    .run(driver.id, delivery.id, readyOrder.id);
}
