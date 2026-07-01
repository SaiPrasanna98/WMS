/**
 * Isolated test: pick confirmation must reduce pallet and lot quantities automatically.
 * Uses a dedicated test database (set before db module loads).
 */
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(__dirname, '../../data/test-pick-inventory.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_PATH = TEST_DB;

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { initializeDatabase } from '../db';
import { queryOne, queryRun } from '../db/query';
import { completePickItem } from '../services/fulfillment';

async function seedPickScenario() {
  const suffix = Date.now();
  const user = await queryRun(
    `INSERT INTO users (email, password_hash, full_name) VALUES (?, 'x', 'Picker')`,
    `picker-${suffix}@test.com`
  );
  const userId = user.lastInsertRowid;

  const product = await queryRun(`
    INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level)
    VALUES (?, 'Test Mist', 'FINISHED_GOOD', 'EA', 10)
  `, `FG-TEST-${suffix}`);
  const productId = product.lastInsertRowid;

  const customer = await queryRun(
    `INSERT INTO customers (name, email) VALUES ('Test Shop', ?)`,
    `shop-${suffix}@test.com`
  );
  const customerId = customer.lastInsertRowid;

  const addr = await queryRun(`
    INSERT INTO customer_addresses (customer_id, label, line1, city, country, is_default)
    VALUES (?, 'Main', '1 Test St', 'NYC', 'US', 1)
  `, customerId);
  const addressId = addr.lastInsertRowid;

  const lot = await queryRun(`
    INSERT INTO lots (lot_number, product_id, quantity, qc_status, received_date)
    VALUES (?, ?, 300, 'PASSED', date('now'))
  `, `LOT-PICK-${suffix}`, productId);
  const lotId = lot.lastInsertRowid;

  const loc = await queryRun(`
    INSERT INTO warehouse_locations (code, zone, aisle, rack, shelf, location_type)
    VALUES (?, 'A', '1', '1', '1', 'STORAGE')
  `, `LOC-${suffix}`);
  const locationId = loc.lastInsertRowid;

  const palletCode = `PLT-PICK-${suffix}`;
  const pallet = await queryRun(`
    INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id, status)
    VALUES (?, ?, ?, 300, ?, 'ACTIVE')
  `, palletCode, lotId, productId, locationId);
  const palletId = pallet.lastInsertRowid;

  const order = await queryRun(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, created_by)
    VALUES (?, ?, ?, 'PICKING', 'NORMAL', ?)
  `, `ORD-TEST-${suffix}`, customerId, addressId, userId);
  const orderId = order.lastInsertRowid;

  const orderItem = await queryRun(`
    INSERT INTO order_items (order_id, product_id, quantity_ordered, quantity_reserved)
    VALUES (?, ?, 200, 200)
  `, orderId, productId);
  const orderItemId = orderItem.lastInsertRowid;

  await queryRun(`
    INSERT INTO inventory_reservations (order_id, order_item_id, product_id, pallet_id, lot_id, quantity_reserved, status)
    VALUES (?, ?, ?, ?, ?, 200, 'RESERVED')
  `, orderId, orderItemId, productId, palletId, lotId);

  const pickList = await queryRun(`INSERT INTO pick_lists (order_id, status) VALUES (?, 'IN_PROGRESS')`, orderId);
  const pickListId = pickList.lastInsertRowid;

  const pickItem = await queryRun(`
    INSERT INTO pick_list_items (pick_list_id, order_item_id, pallet_id, lot_id, product_id, location_id, quantity_to_pick, status)
    VALUES (?, ?, ?, ?, ?, ?, 200, 'PENDING')
  `, pickListId, orderItemId, palletId, lotId, productId, locationId);
  const pickListItemId = pickItem.lastInsertRowid;

  return { userId, pickListItemId, palletCode };
}

describe('Pick inventory deduction (automatic)', () => {
  let pickListItemId: number;
  let palletCode: string;
  let userId: number;

  before(async () => {
    await initializeDatabase();
    const seeded = await seedPickScenario();
    pickListItemId = seeded.pickListItemId;
    palletCode = seeded.palletCode;
    userId = seeded.userId;
  });

  it('reduces pallet and lot quantity when pick is confirmed', async () => {
    const before = await queryOne<{ pallet_qty: number; lot_qty: number }>(`
      SELECT pl.quantity as pallet_qty, l.quantity as lot_qty
      FROM pallets pl JOIN lots l ON l.id = pl.lot_id WHERE pl.pallet_id = ?
    `, palletCode);
    assert.ok(before);
    assert.equal(before.pallet_qty, 300);
    assert.equal(before.lot_qty, 300);

    await completePickItem(pickListItemId, 200, palletCode, userId);

    const after = await queryOne<{ pallet_qty: number; lot_qty: number; status: string }>(`
      SELECT pl.quantity as pallet_qty, l.quantity as lot_qty, pl.status
      FROM pallets pl JOIN lots l ON l.id = pl.lot_id WHERE pl.pallet_id = ?
    `, palletCode);
    assert.ok(after);
    assert.equal(after.pallet_qty, 100);
    assert.equal(after.lot_qty, 100);
    assert.equal(after.status, 'ACTIVE');
  });
});
