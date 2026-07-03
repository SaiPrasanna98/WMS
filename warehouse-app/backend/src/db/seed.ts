import bcrypt from 'bcryptjs';
import { sqlDateOffset, sqlToday } from './dialect';
import { isPostgres, queryAll, queryOne, queryRun, sqlNow } from './query';

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


function permissionInsertIgnoreSql(): string {
  return isPostgres()
    ? 'INSERT INTO permissions (code, name, module) VALUES (?, ?, ?) ON CONFLICT (code) DO NOTHING'
    : 'INSERT OR IGNORE INTO permissions (code, name, module) VALUES (?, ?, ?)';
}

function roleInsertIgnoreSql(): string {
  return isPostgres()
    ? 'INSERT INTO roles (name, description) VALUES (?, ?) ON CONFLICT (name) DO NOTHING'
    : 'INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)';
}

function userRoleInsertIgnoreSql(): string {
  return isPostgres()
    ? 'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING'
    : 'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)';
}

function driverInsertIgnoreSql(): string {
  return isPostgres()
    ? 'INSERT INTO drivers (user_id, license_number, phone) VALUES (?, ?, ?) ON CONFLICT (user_id) DO NOTHING'
    : 'INSERT OR IGNORE INTO drivers (user_id, license_number, phone) VALUES (?, ?, ?)';
}

/** Inserts missing permissions and roles for existing databases. */
export async function syncSchemaData(): Promise<void> {
  for (const p of PERMISSIONS) {
    await queryRun(permissionInsertIgnoreSql(), p.code, p.name, p.module);
  }
  for (const r of ROLES) {
    await queryRun(roleInsertIgnoreSql(), r.name, r.description);
  }
  await syncRolePermissions();

  const driverUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'driver@demo.com');
  if (!driverUser) {
    const hash = bcrypt.hashSync('password123', 10);
    const result = await queryRun(
      'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
      'driver@demo.com',
      hash,
      'Delivery Driver'
    );
    const userId = Number(result.lastInsertRowid);
    const role = await queryOne<{ id: number }>('SELECT id FROM roles WHERE name = ?', 'Driver');
    if (role) {
      await queryRun(userRoleInsertIgnoreSql(), userId, role.id);
    }
    await queryRun(driverInsertIgnoreSql(), userId, 'DL-DEMO-001', '555-0100');
  } else {
    const hasDriver = await queryOne('SELECT id FROM drivers WHERE user_id = ?', driverUser.id);
    if (!hasDriver) {
      await queryRun(
        'INSERT INTO drivers (user_id, license_number, phone) VALUES (?, ?, ?)',
        driverUser.id,
        'DL-DEMO-001',
        '555-0100'
      );
    }
  }

  const salesUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'sales@demo.com');
  if (!salesUser) {
    const hash = bcrypt.hashSync('password123', 10);
    const result = await queryRun(
      'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
      'sales@demo.com',
      hash,
      'Sales Representative'
    );
    const userId = Number(result.lastInsertRowid);
    const role = await queryOne<{ id: number }>('SELECT id FROM roles WHERE name = ?', 'Sales');
    if (role) {
      await queryRun(userRoleInsertIgnoreSql(), userId, role.id);
    }
  }

  await syncDemoCustomers();
}

async function syncDemoCustomers(): Promise<void> {
  const count = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM customers');
  if ((count?.c ?? 0) > 0) return;

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
    const result = await queryRun(
      'INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)',
      c.name,
      c.email,
      c.phone
    );
    const customerId = Number(result.lastInsertRowid);
    await queryRun(`
      INSERT INTO customer_addresses (customer_id, label, line1, city, state, postal_code, country, is_default)
      VALUES (?, 'Primary', ?, ?, ?, ?, 'US', 1)
    `, customerId, c.address.line1, c.address.city, c.address.state, c.address.postalCode);
  }
}

/** Keeps role permissions in sync when new permissions are added (existing databases). */
export async function syncRolePermissions(): Promise<void> {
  for (const [roleName, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await queryOne<{ id: number }>('SELECT id FROM roles WHERE name = ?', roleName);
    if (!role) continue;
    for (const permCode of perms) {
      const perm = await queryOne<{ id: number }>('SELECT id FROM permissions WHERE code = ?', permCode);
      if (!perm) continue;
      const exists = await queryOne(
        'SELECT 1 FROM role_permissions WHERE role_id = ? AND permission_id = ?',
        role.id,
        perm.id
      );
      if (exists) continue;
      await queryRun(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        role.id,
        perm.id
      );
    }
  }
}

export async function seedDatabase(): Promise<void> {
  const userCount = (await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM users'))?.count ?? 0;

  for (const p of PERMISSIONS) {
    await queryRun(permissionInsertIgnoreSql(), p.code, p.name, p.module);
  }
  for (const r of ROLES) {
    await queryRun(roleInsertIgnoreSql(), r.name, r.description);
  }
  await syncRolePermissions();

  if (userCount > 0) {
    await syncSchemaData();
    return;
  }

  for (const u of DEMO_USERS) {
    const existing = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', u.email);
    if (existing) continue;

    const hash = bcrypt.hashSync(u.password, 10);
    const result = await queryRun(
      'INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)',
      u.email,
      hash,
      u.fullName
    );
    const userId = Number(result.lastInsertRowid);
    const role = await queryOne<{ id: number }>('SELECT id FROM roles WHERE name = ?', u.role);
    if (role) {
      await queryRun(userRoleInsertIgnoreSql(), userId, role.id);
    }
  }

  await seedProducts();
  await seedLocations();
  await seedLotsAndPallets();
  await seedPurchaseOrders();
  await seedProductionOrders();
  await seedShipments();
  await seedInventoryTransactions();
  await seedFulfillment();
  await syncSchemaData();
}

async function seedProducts(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM products');
  if ((existing?.c ?? 0) > 0) return;

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

  for (const p of products) {
    await queryRun(`
      INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `, p.sku, p.name, p.type, p.uom, p.reorder, `${p.name} - demo product`);
  }
}

async function seedLocations(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM warehouse_locations');
  if ((existing?.c ?? 0) > 0) return;

  const zones = ['A', 'B', 'C', 'D'];
  const types = ['STORAGE', 'STAGING', 'PRODUCTION', 'SHIPPING', 'QC'] as const;

  let count = 0;
  for (const zone of zones) {
    for (let aisle = 1; aisle <= 5 && count < 20; aisle++) {
      const type = types[count % types.length];
      await queryRun(`
        INSERT INTO warehouse_locations (code, zone, aisle, rack, shelf, location_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
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

async function seedLotsAndPallets(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM lots');
  if ((existing?.c ?? 0) > 0) return;

  const products = await queryAll<{ id: number; sku: string; product_type: string }>(
    'SELECT id, sku, product_type FROM products'
  );
  const locations = await queryAll<{ id: number }>(
    'SELECT id FROM warehouse_locations WHERE location_type = ?',
    'STORAGE'
  );

  const lotData = [
    { lot: 'LOT-2024-001', productIdx: 0, qty: 1000, qc: 'PASSED' },
    { lot: 'LOT-2024-002', productIdx: 1, qty: 200, qc: 'PASSED' },
    { lot: 'LOT-2024-003', productIdx: 5, qty: 500, qc: 'PASSED' },
    { lot: 'LOT-2024-004', productIdx: 6, qty: 300, qc: 'HOLD' },
    { lot: 'LOT-2024-005', productIdx: 2, qty: 150, qc: 'PENDING' },
  ];

  let palletNum = 1;
  for (const l of lotData) {
    const product = products[l.productIdx];
    const lotResult = await queryRun(`
      INSERT INTO lots (lot_number, product_id, quantity, qc_status, received_date)
      VALUES (?, ?, ?, ?, ${sqlToday()})
    `, l.lot, product.id, l.qty, l.qc);
    const lotId = Number(lotResult.lastInsertRowid);

    const numPallets = l.productIdx < 5 ? 2 : 1;
    const qtyPerPallet = l.qty / numPallets;

    for (let i = 0; i < numPallets && palletNum <= 10; i++) {
      const loc = locations[(palletNum - 1) % locations.length];
      await queryRun(`
        INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id, status)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `,
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
  const topLoc = await queryOne<{ id: number }>(`
    SELECT id FROM warehouse_locations WHERE shelf = '01' AND location_type = 'STORAGE' LIMIT 1
  `);
  if (topLoc && products[0]) {
    const lot = await queryOne<{ id: number }>('SELECT id FROM lots WHERE lot_number = ?', 'LOT-2024-001');
    if (lot) {
      await queryRun(`
        INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id, status)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE')
      `, 'PLT-EMPTY-01', lot.id, products[0].id, 0, topLoc.id);
      await queryRun(`UPDATE pallets SET status = 'DEPLETED' WHERE pallet_id = 'PLT-EMPTY-01'`);
    }
  }
}

async function seedPurchaseOrders(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM purchase_orders');
  if ((existing?.c ?? 0) > 0) return;

  const admin = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'admin@demo.com');
  const rm = await queryOne<{ id: number }>('SELECT id FROM products WHERE sku = ?', 'RM-001');

  const po1 = await queryRun(`
    INSERT INTO purchase_orders (po_number, supplier_name, status, expected_date, created_by)
    VALUES ('PO-2024-001', 'ChemSupply Inc', 'RECEIVED', ${sqlDateOffset('+7 days')}, ?)
  `, admin?.id ?? 1);
  const po2 = await queryRun(`
    INSERT INTO purchase_orders (po_number, supplier_name, status, expected_date, created_by)
    VALUES ('PO-2024-002', 'Fragrance World Ltd', 'OPEN', ${sqlDateOffset('+14 days')}, ?)
  `, admin?.id ?? 1);

  if (rm) {
    await queryRun(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost)
      VALUES (?, ?, 500, 500, 12.5)
    `, Number(po1.lastInsertRowid), rm.id);
    await queryRun(`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, quantity_received, unit_cost)
      VALUES (?, ?, 1000, 0, 11.75)
    `, Number(po2.lastInsertRowid), rm.id);
  }
}

async function seedProductionOrders(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM production_orders');
  if ((existing?.c ?? 0) > 0) return;

  const admin = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'production@demo.com');
  const fgProduct = await queryOne<{ id: number }>('SELECT id FROM products WHERE sku = ?', 'FG-001');
  const lot = await queryOne<{ id: number }>('SELECT id FROM lots WHERE lot_number = ?', 'LOT-2024-003');

  if (!admin || !fgProduct || !lot) return;

  await queryRun(`
    INSERT INTO production_orders (order_number, product_id, quantity_planned, quantity_produced, status, lot_id, scheduled_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ${sqlDateOffset('+3 days')}, ?)
  `, 'PRO-2024-001', fgProduct.id, 500, 0, 'CREATED', null, admin.id);
  await queryRun(`
    INSERT INTO production_orders (order_number, product_id, quantity_planned, quantity_produced, status, lot_id, scheduled_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ${sqlDateOffset('+3 days')}, ?)
  `, 'PRO-2024-002', fgProduct.id, 300, 150, 'IN_PROGRESS', null, admin.id);
  await queryRun(`
    INSERT INTO production_orders (order_number, product_id, quantity_planned, quantity_produced, status, lot_id, scheduled_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ${sqlDateOffset('+3 days')}, ?)
  `, 'PRO-2024-003', fgProduct.id, 200, 200, 'QC_PENDING', lot.id, admin.id);

  const rmProducts = await queryAll<{ id: number }>(
    `SELECT id FROM products WHERE product_type = 'RAW_MATERIAL' LIMIT 3`
  );
  const po1 = await queryOne<{ id: number }>(
    'SELECT id FROM production_orders WHERE order_number = ?',
    'PRO-2024-001'
  );
  if (!po1 || rmProducts.length < 2) return;

  await queryRun(`
    INSERT INTO production_materials (production_order_id, product_id, quantity_required, status)
    VALUES (?, ?, ?, 'REQUESTED')
  `, po1.id, rmProducts[0].id, 50);
  await queryRun(`
    INSERT INTO production_materials (production_order_id, product_id, quantity_required, status)
    VALUES (?, ?, ?, 'REQUESTED')
  `, po1.id, rmProducts[1].id, 10);
}

async function seedShipments(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM shipments');
  if ((existing?.c ?? 0) > 0) return;

  const shippingUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'shipping@demo.com');
  const fgProduct = await queryOne<{ id: number }>('SELECT id FROM products WHERE sku = ?', 'FG-001');
  const passedLot = await queryOne<{ id: number }>(
    'SELECT id FROM lots WHERE qc_status = ? LIMIT 1',
    'PASSED'
  );

  if (!shippingUser || !fgProduct || !passedLot) return;

  const s1 = await queryRun(`
    INSERT INTO shipments (shipment_number, customer_name, status, created_by)
    VALUES (?, ?, ?, ?)
  `, 'SHP-2024-001', 'Luxury Retail Co', 'DRAFT', shippingUser.id);
  await queryRun(`
    INSERT INTO shipment_items (shipment_id, product_id, lot_id, quantity)
    VALUES (?, ?, ?, ?)
  `, Number(s1.lastInsertRowid), fgProduct.id, passedLot.id, 100);

  const s2 = await queryRun(`
    INSERT INTO shipments (shipment_number, customer_name, status, created_by)
    VALUES (?, ?, ?, ?)
  `, 'SHP-2024-002', 'Beauty Boutique', 'PICKING', shippingUser.id);
  await queryRun(`
    INSERT INTO shipment_items (shipment_id, product_id, lot_id, quantity)
    VALUES (?, ?, ?, ?)
  `, Number(s2.lastInsertRowid), fgProduct.id, passedLot.id, 50);

  const s3 = await queryRun(`
    INSERT INTO shipments (shipment_number, customer_name, status, created_by)
    VALUES (?, ?, ?, ?)
  `, 'SHP-2024-003', 'Online Store Direct', 'PACKED', shippingUser.id);
  await queryRun(`
    INSERT INTO shipment_items (shipment_id, product_id, lot_id, quantity)
    VALUES (?, ?, ?, ?)
  `, Number(s3.lastInsertRowid), fgProduct.id, passedLot.id, 75);
}

async function seedInventoryTransactions(): Promise<void> {
  const existing = await queryOne<{ c: number }>('SELECT COUNT(*) as c FROM inventory_transactions');
  if ((existing?.c ?? 0) > 0) return;

  const receiver = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'receiver@demo.com');
  const worker = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'worker@demo.com');
  const products = await queryAll<{ id: number }>('SELECT id FROM products LIMIT 3');
  const lots = await queryAll<{ id: number }>('SELECT id FROM lots LIMIT 3');
  const pallets = await queryAll<{ id: number; location_id: number }>(
    'SELECT id, location_id FROM pallets LIMIT 3'
  );
  const locations = await queryAll<{ id: number }>('SELECT id FROM warehouse_locations LIMIT 5');

  if (!receiver || !worker || products.length < 3 || lots.length < 3 || pallets.length < 3 || locations.length < 3) {
    return;
  }

  await queryRun(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'RECEIVE', products[0].id, lots[0].id, pallets[0].id, null, pallets[0].location_id, 500, receiver.id, 'Initial receiving');
  await queryRun(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'RECEIVE', products[1].id, lots[1].id, pallets[1].id, null, pallets[1].location_id, 100, receiver.id, 'Fragrance oil received');
  await queryRun(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'MOVE', products[0].id, lots[0].id, pallets[0].id, locations[0].id, locations[1].id, 500, worker.id, 'Moved to staging');
  await queryRun(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'PICK', products[2].id, lots[2].id, pallets[2].id, locations[2].id, null, 50, worker.id, 'Picked for production');
  await queryRun(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, 'CONSUME', products[0].id, lots[0].id, null, locations[1].id, null, 25, worker.id, 'Consumed in production');
}

async function seedFulfillment(): Promise<void> {
  const existing = await queryOne<{ c: number }>(
    'SELECT COUNT(*) as c FROM orders WHERE order_number = ?',
    'ORD-2026-00001'
  );
  if ((existing?.c ?? 0) > 0) return;

  const admin = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'admin@demo.com');
  const driverUser = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'driver@demo.com');
  const fgProduct = await queryOne<{ id: number }>('SELECT id FROM products WHERE sku = ?', 'FG-001');

  if (!admin || !driverUser || !fgProduct) return;

  await queryRun(driverInsertIgnoreSql(), driverUser.id, 'DL-DEMO-001', '555-0100');
  const driver = await queryOne<{ id: number }>('SELECT id FROM drivers WHERE user_id = ?', driverUser.id);
  if (!driver) return;

  const custResult = await queryRun(
    `INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)`,
    'Luxury Retail Co',
    'orders@luxuryretail.com',
    '555-1000'
  );
  const customerId = Number(custResult.lastInsertRowid);

  const addrResult = await queryRun(`
    INSERT INTO customer_addresses (customer_id, label, line1, city, state, postal_code, country, is_default)
    VALUES (?, 'HQ', '100 Fashion Ave', 'New York', 'NY', '10001', 'US', 1)
  `, customerId);
  const addressId = Number(addrResult.lastInsertRowid);

  const orderResult = await queryRun(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, estimated_ship_date, estimated_delivery_date, created_by)
    VALUES ('ORD-2026-00001', ?, ?, 'ALLOCATED', 'HIGH', ${sqlDateOffset('+1 day')}, ${sqlDateOffset('+3 days')}, ?)
  `, customerId, addressId, admin.id);
  const orderId = Number(orderResult.lastInsertRowid);

  const itemResult = await queryRun(`
    INSERT INTO order_items (order_id, product_id, quantity_ordered, quantity_reserved)
    VALUES (?, ?, 100, 100)
  `, orderId, fgProduct.id);
  const orderItemId = Number(itemResult.lastInsertRowid);

  const pallet = await queryOne<{ id: number; lot_id: number; quantity: number }>(`
    SELECT pl.id, pl.lot_id, pl.quantity FROM pallets pl
    JOIN lots l ON l.id = pl.lot_id
    WHERE pl.product_id = ? AND pl.status = 'ACTIVE' AND l.qc_status = 'PASSED' LIMIT 1
  `, fgProduct.id);

  if (pallet) {
    await queryRun(`
      INSERT INTO inventory_reservations (order_id, order_item_id, product_id, pallet_id, lot_id, quantity_reserved, status)
      VALUES (?, ?, ?, ?, ?, 100, 'RESERVED')
    `, orderId, orderItemId, fgProduct.id, pallet.id, pallet.lot_id);

    const plResult = await queryRun(`INSERT INTO pick_lists (order_id, status) VALUES (?, 'PENDING')`, orderId);
    const pickListId = Number(plResult.lastInsertRowid);
    const loc = await queryOne<{ location_id: number }>(
      'SELECT location_id FROM pallets WHERE id = ?',
      pallet.id
    );

    if (loc) {
      await queryRun(`
        INSERT INTO pick_list_items (pick_list_id, order_item_id, pallet_id, lot_id, product_id, location_id, quantity_to_pick)
        VALUES (?, ?, ?, ?, ?, ?, 100)
      `, pickListId, orderItemId, pallet.id, pallet.lot_id, fgProduct.id, loc.location_id);
    }

    await queryRun(`
      INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
      VALUES (?, 'PICK', 'PENDING', 'HIGH', ${sqlToday()})
    `, orderId);
    await queryRun(`
      INSERT INTO fulfillment_tasks (order_id, task_type, status, priority, due_date)
      VALUES (?, 'PACK', 'PENDING', 'HIGH', ${sqlToday()})
    `, orderId);
  }

  await queryRun(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, created_by, notes)
    VALUES ('ORD-2026-00002', ?, ?, 'INVENTORY_CHECK', 'NORMAL', ?, 'Awaiting inventory check')
  `, customerId, addressId, admin.id);

  await queryRun(`
    INSERT INTO order_items (order_id, product_id, quantity_ordered)
    SELECT id, ?, 500 FROM orders WHERE order_number = 'ORD-2026-00002'
  `, fgProduct.id);

  await queryRun(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, estimated_ship_date, estimated_delivery_date, created_by)
    VALUES ('ORD-2026-00003', ?, ?, 'READY_FOR_PICKUP', 'URGENT', ${sqlToday()}, ${sqlDateOffset('+1 day')}, ?)
  `, customerId, addressId, admin.id);

  const readyOrder = await queryOne<{ id: number }>(
    'SELECT id FROM orders WHERE order_number = ?',
    'ORD-2026-00003'
  );
  if (!readyOrder) return;

  await queryRun(
    `INSERT INTO order_items (order_id, product_id, quantity_ordered, quantity_reserved, quantity_picked, quantity_packed) VALUES (?, ?, 50, 50, 50, 50)`,
    readyOrder.id,
    fgProduct.id
  );

  await queryRun(`
    INSERT INTO packages (order_id, package_barcode, status, packed_by, packed_at)
    VALUES (?, 'PKG-3-001', 'PACKED', ?, ${sqlNow()})
  `, readyOrder.id, admin.id);

  await queryRun(`
    INSERT INTO deliveries (order_id, driver_id, status, delivery_address_id, priority, package_count, assigned_at, pickup_location)
    VALUES (?, ?, 'ASSIGNED', ?, 'URGENT', 1, ${sqlNow()}, 'Main Warehouse')
  `, readyOrder.id, driver.id, addressId);

  const delivery = await queryOne<{ id: number }>(
    'SELECT id FROM deliveries WHERE order_id = ?',
    readyOrder.id
  );
  if (delivery) {
    await queryRun(
      `INSERT INTO driver_assignments (driver_id, delivery_id, order_id, status) VALUES (?, ?, ?, 'ASSIGNED')`,
      driver.id,
      delivery.id,
      readyOrder.id
    );
  }
}
