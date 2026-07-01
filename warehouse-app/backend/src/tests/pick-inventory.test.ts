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
import db, { initializeDatabase } from '../db';
import { completePickItem } from '../services/fulfillment';

function seedPickScenario() {
  const suffix = Date.now();
  const user = db.prepare(`INSERT INTO users (email, password_hash, full_name) VALUES (?, 'x', 'Picker')`).run(`picker-${suffix}@test.com`);
  const userId = Number(user.lastInsertRowid);

  const product = db.prepare(`
    INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level)
    VALUES (?, 'Test Mist', 'FINISHED_GOOD', 'EA', 10)
  `).run(`FG-TEST-${suffix}`);
  const productId = Number(product.lastInsertRowid);

  const customer = db.prepare(`INSERT INTO customers (name, email) VALUES ('Test Shop', ?)`).run(`shop-${suffix}@test.com`);
  const customerId = Number(customer.lastInsertRowid);

  const addr = db.prepare(`
    INSERT INTO customer_addresses (customer_id, label, line1, city, country, is_default)
    VALUES (?, 'Main', '1 Test St', 'NYC', 'US', 1)
  `).run(customerId);
  const addressId = Number(addr.lastInsertRowid);

  const lot = db.prepare(`
    INSERT INTO lots (lot_number, product_id, quantity, qc_status, received_date)
    VALUES (?, ?, 300, 'PASSED', date('now'))
  `).run(`LOT-PICK-${suffix}`, productId);
  const lotId = Number(lot.lastInsertRowid);

  const loc = db.prepare(`
    INSERT INTO warehouse_locations (code, zone, aisle, rack, shelf, location_type)
    VALUES (?, 'A', '1', '1', '1', 'STORAGE')
  `).run(`LOC-${suffix}`);
  const locationId = Number(loc.lastInsertRowid);

  const palletCode = `PLT-PICK-${suffix}`;
  const pallet = db.prepare(`
    INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id, status)
    VALUES (?, ?, ?, 300, ?, 'ACTIVE')
  `).run(palletCode, lotId, productId, locationId);
  const palletId = Number(pallet.lastInsertRowid);

  const order = db.prepare(`
    INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, created_by)
    VALUES (?, ?, ?, 'PICKING', 'NORMAL', ?)
  `).run(`ORD-TEST-${suffix}`, customerId, addressId, userId);
  const orderId = Number(order.lastInsertRowid);

  const orderItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, quantity_ordered, quantity_reserved)
    VALUES (?, ?, 200, 200)
  `).run(orderId, productId);
  const orderItemId = Number(orderItem.lastInsertRowid);

  db.prepare(`
    INSERT INTO inventory_reservations (order_id, order_item_id, product_id, pallet_id, lot_id, quantity_reserved, status)
    VALUES (?, ?, ?, ?, ?, 200, 'RESERVED')
  `).run(orderId, orderItemId, productId, palletId, lotId);

  const pickList = db.prepare(`INSERT INTO pick_lists (order_id, status) VALUES (?, 'IN_PROGRESS')`).run(orderId);
  const pickListId = Number(pickList.lastInsertRowid);

  const pickItem = db.prepare(`
    INSERT INTO pick_list_items (pick_list_id, order_item_id, pallet_id, lot_id, product_id, location_id, quantity_to_pick, status)
    VALUES (?, ?, ?, ?, ?, ?, 200, 'PENDING')
  `).run(pickListId, orderItemId, palletId, lotId, productId, locationId);
  const pickListItemId = Number(pickItem.lastInsertRowid);

  return { userId, pickListItemId, palletCode };
}

describe('Pick inventory deduction (automatic)', () => {
  let pickListItemId: number;
  let palletCode: string;
  let userId: number;

  before(() => {
    initializeDatabase();
    const seeded = seedPickScenario();
    pickListItemId = seeded.pickListItemId;
    palletCode = seeded.palletCode;
    userId = seeded.userId;
  });

  it('reduces pallet and lot quantity when pick is confirmed', () => {
    const before = db.prepare(`
      SELECT pl.quantity as pallet_qty, l.quantity as lot_qty
      FROM pallets pl JOIN lots l ON l.id = pl.lot_id WHERE pl.pallet_id = ?
    `).get(palletCode) as { pallet_qty: number; lot_qty: number };
    assert.equal(before.pallet_qty, 300);
    assert.equal(before.lot_qty, 300);

    completePickItem(pickListItemId, 200, palletCode, userId);

    const after = db.prepare(`
      SELECT pl.quantity as pallet_qty, l.quantity as lot_qty, pl.status
      FROM pallets pl JOIN lots l ON l.id = pl.lot_id WHERE pl.pallet_id = ?
    `).get(palletCode) as { pallet_qty: number; lot_qty: number; status: string };
    assert.equal(after.pallet_qty, 100);
    assert.equal(after.lot_qty, 100);
    assert.equal(after.status, 'ACTIVE');
  });
});
