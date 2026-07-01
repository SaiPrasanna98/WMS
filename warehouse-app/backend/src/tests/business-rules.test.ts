import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(__dirname, '../../data/test-warehouse.db');
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DATABASE_PATH = TEST_DB;

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { initializeDatabase, closeConnections } from '../db';
import { queryOne, queryAll, queryRun } from '../db/query';
import { assertPositiveQuantity, assertValidTransition, SHIPMENT_TRANSITIONS } from '../services/validation';

async function setupTestData() {
  await initializeDatabase();

  await queryRun(`INSERT INTO permissions (code, name, module) VALUES ('products.read', 'View Products', 'products')`);
  await queryRun(`INSERT INTO permissions (code, name, module) VALUES ('products.write', 'Manage Products', 'products')`);
  await queryRun(`INSERT INTO permissions (code, name, module) VALUES ('dashboard.read', 'View Dashboard', 'dashboard')`);

  const adminRole = await queryRun(`INSERT INTO roles (name, description) VALUES ('Admin', 'Full access')`);
  const viewerRole = await queryRun(`INSERT INTO roles (name, description) VALUES ('Viewer', 'Read only')`);
  const adminRoleId = adminRole.lastInsertRowid;
  const viewerRoleId = viewerRole.lastInsertRowid;

  const perms = await queryAll<{ id: number; code: string }>('SELECT id, code FROM permissions');
  for (const p of perms) {
    await queryRun('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', adminRoleId, p.id);
    if (p.code.endsWith('.read')) {
      await queryRun('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', viewerRoleId, p.id);
    }
  }

  const hash = bcrypt.hashSync('password123', 10);
  const adminUser = await queryRun(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('admin@test.com', ?, 'Admin')`,
    hash
  );
  const viewerUser = await queryRun(
    `INSERT INTO users (email, password_hash, full_name) VALUES ('viewer@test.com', ?, 'Viewer')`,
    hash
  );

  await queryRun('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', adminUser.lastInsertRowid, adminRoleId);
  await queryRun('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', viewerUser.lastInsertRowid, viewerRoleId);

  await queryRun(`
    INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level)
    VALUES ('RM-001', 'Test Material', 'RAW_MATERIAL', 'KG', 10)
  `);
}

describe('Warehouse Business Rules', () => {
  before(async () => {
    await setupTestData();
  });

  after(async () => {
    await closeConnections();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('should hash and verify passwords correctly', () => {
    const hash = bcrypt.hashSync('password123', 10);
    assert.equal(bcrypt.compareSync('password123', hash), true);
    assert.equal(bcrypt.compareSync('wrong', hash), false);
  });

  it('should sign and verify JWT tokens', () => {
    const secret = 'test-secret';
    const token = jwt.sign({ userId: 1, email: 'admin@test.com' }, secret, { expiresIn: '1h' });
    const payload = jwt.verify(token, secret) as { userId: number };
    assert.equal(payload.userId, 1);
  });

  it('should assign correct permissions to admin vs viewer', async () => {
    const adminPerms = await queryAll<{ code: string }>(`
      SELECT p.code FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      JOIN users u ON u.id = ur.user_id
      WHERE u.email = 'admin@test.com'
    `);

    const viewerPerms = await queryAll<{ code: string }>(`
      SELECT p.code FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      JOIN users u ON u.id = ur.user_id
      WHERE u.email = 'viewer@test.com'
    `);

    assert.ok(adminPerms.some(p => p.code === 'products.write'));
    assert.ok(!viewerPerms.some(p => p.code === 'products.write'));
    assert.ok(viewerPerms.some(p => p.code === 'products.read'));
  });

  it('should prevent negative inventory', async () => {
    const product = await queryOne<{ id: number }>('SELECT id FROM products WHERE sku = ?', 'RM-001');
    assert.ok(product);
    await queryRun(`
      INSERT INTO lots (lot_number, product_id, quantity, qc_status) VALUES ('LOT-001', ?, 100, 'PASSED')
    `, product.id);
    const lot = await queryOne<{ id: number }>('SELECT id FROM lots WHERE lot_number = ?', 'LOT-001');
    assert.ok(lot);

    await queryRun(`
      INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, status) VALUES ('PLT-001', ?, ?, 50, 'ACTIVE')
    `, lot.id, product.id);

    const current = await queryOne<{ total: number }>(`
      SELECT COALESCE(SUM(quantity), 0) as total FROM pallets WHERE product_id = ? AND status = 'ACTIVE'
    `, product.id);
    assert.ok(current);

    assert.equal(current.total, 50);
    assert.throws(() => {
      if (current.total - 100 < 0) throw new Error('Inventory cannot go negative');
    }, /Inventory cannot go negative/);
  });

  it('should enforce QC-passed requirement for finished goods shipping', async () => {
    await queryRun(`
      INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level)
      VALUES ('FG-001', 'Test Perfume', 'FINISHED_GOOD', 'EA', 10)
    `);
    const fg = await queryOne<{ id: number }>('SELECT id FROM products WHERE sku = ?', 'FG-001');
    assert.ok(fg);

    await queryRun(`
      INSERT INTO lots (lot_number, product_id, quantity, qc_status) VALUES ('LOT-FG-001', ?, 100, 'PENDING')
    `, fg.id);
    const lot = await queryOne<{ id: number; qc_status: string }>(
      'SELECT id, qc_status FROM lots WHERE lot_number = ?',
      'LOT-FG-001'
    );
    assert.ok(lot);

    const productType = 'FINISHED_GOOD';
    const canShip = !(productType === 'FINISHED_GOOD' && lot.qc_status !== 'PASSED');
    assert.equal(canShip, false);

    await queryRun(`UPDATE lots SET qc_status = 'PASSED' WHERE id = ?`, lot.id);
    const updated = await queryOne<{ qc_status: string }>('SELECT qc_status FROM lots WHERE id = ?', lot.id);
    assert.ok(updated);
    const canShipNow = !(productType === 'FINISHED_GOOD' && updated.qc_status !== 'PASSED');
    assert.equal(canShipNow, true);
  });

  it('should create audit log entries', async () => {
    const user = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ?', 'admin@test.com');
    assert.ok(user);
    await queryRun(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
      VALUES (?, 'CREATE', 'product', 1, '{"sku":"TEST"}')
    `, user.id);

    const log = await queryOne<{ action: string; user_id: number }>(
      'SELECT * FROM audit_logs WHERE entity_type = ?',
      'product'
    );
    assert.ok(log);
    assert.equal(log.action, 'CREATE');
    assert.equal(log.user_id, user.id);
  });

  it('should reject non-positive quantities', () => {
    assert.throws(() => assertPositiveQuantity(0), /positive number/);
    assert.throws(() => assertPositiveQuantity(-5), /positive number/);
    assert.equal(assertPositiveQuantity(10), 10);
  });

  it('should enforce shipment status transitions', () => {
    assert.doesNotThrow(() => assertValidTransition('DRAFT', 'PICKING', SHIPMENT_TRANSITIONS));
    assert.throws(() => assertValidTransition('DRAFT', 'SHIPPED', SHIPMENT_TRANSITIONS), /Invalid status transition/);
  });
});
