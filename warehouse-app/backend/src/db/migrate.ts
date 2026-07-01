import { isPostgres, queryExec, queryRun, sqlNow } from './query';

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

export async function runMigrations(): Promise<void> {
  for (const sql of COLUMN_MIGRATIONS) {
    try {
      await queryExec(sql);
    } catch {
      // column already exists
    }
  }

  await queryRun(`
    UPDATE products SET unit_price = CASE sku
      WHEN 'FG-001' THEN 24.99
      WHEN 'FG-002' THEN 34.99
      WHEN 'FG-003' THEN 29.99
      WHEN 'FG-004' THEN 19.99
      ELSE unit_price
    END
    WHERE unit_price = 0 AND product_type = 'FINISHED_GOOD'
  `);

  await seedOrganizationSettings();
}

async function seedOrganizationSettings(): Promise<void> {
  const now = sqlNow();
  if (isPostgres()) {
    await queryExec(`
      INSERT INTO organization_settings (id, org_name, allowed_domains, invite_expiry_days, updated_at)
      VALUES (1, 'Warehouse Operations', 'demo.com', 7, ${now})
      ON CONFLICT (id) DO NOTHING
    `);
  } else {
    await queryRun(`
      INSERT INTO organization_settings (id, org_name, allowed_domains, invite_expiry_days)
      VALUES (1, 'Warehouse Operations', 'demo.com', 7)
      ON CONFLICT(id) DO NOTHING
    `);
  }
}
