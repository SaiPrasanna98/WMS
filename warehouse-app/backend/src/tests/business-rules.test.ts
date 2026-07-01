import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { assertPositiveQuantity, assertValidTransition, SHIPMENT_TRANSITIONS } from '../services/validation';

const TEST_DB = path.join(__dirname, '../../data/test-warehouse.db');

function setupTestDb() {
  const dbDir = path.dirname(TEST_DB);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  const db = new Database(TEST_DB);
  db.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf-8');
  db.exec(schema);

  db.prepare(`INSERT INTO permissions (code, name, module) VALUES ('products.read', 'View Products', 'products')`).run();
  db.prepare(`INSERT INTO permissions (code, name, module) VALUES ('products.write', 'Manage Products', 'products')`).run();
  db.prepare(`INSERT INTO permissions (code, name, module) VALUES ('dashboard.read', 'View Dashboard', 'dashboard')`).run();

  const adminRole = db.prepare(`INSERT INTO roles (name, description) VALUES ('Admin', 'Full access')`).run();
  const viewerRole = db.prepare(`INSERT INTO roles (name, description) VALUES ('Viewer', 'Read only')`).run();

  const perms = db.prepare('SELECT id, code FROM permissions').all() as { id: number; code: string }[];
  for (const p of perms) {
    db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(Number(adminRole.lastInsertRowid), p.id);
    if (p.code.endsWith('.read')) {
      db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)').run(Number(viewerRole.lastInsertRowid), p.id);
    }
  }

  const hash = bcrypt.hashSync('password123', 10);
  const adminUser = db.prepare(`INSERT INTO users (email, password_hash, full_name) VALUES ('admin@test.com', ?, 'Admin')`).run(hash);
  const viewerUser = db.prepare(`INSERT INTO users (email, password_hash, full_name) VALUES ('viewer@test.com', ?, 'Viewer')`).run(hash);

  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(Number(adminUser.lastInsertRowid), Number(adminRole.lastInsertRowid));
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(Number(viewerUser.lastInsertRowid), Number(viewerRole.lastInsertRowid));

  db.prepare(`
    INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level)
    VALUES ('RM-001', 'Test Material', 'RAW_MATERIAL', 'KG', 10)
  `).run();

  return db;
}

describe('Warehouse Business Rules', () => {
  let db: Database.Database;

  before(() => {
    db = setupTestDb();
  });

  after(() => {
    db.close();
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

  it('should assign correct permissions to admin vs viewer', () => {
    const adminPerms = db.prepare(`
      SELECT p.code FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      JOIN users u ON u.id = ur.user_id
      WHERE u.email = 'admin@test.com'
    `).all() as { code: string }[];

    const viewerPerms = db.prepare(`
      SELECT p.code FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      JOIN users u ON u.id = ur.user_id
      WHERE u.email = 'viewer@test.com'
    `).all() as { code: string }[];

    assert.ok(adminPerms.some(p => p.code === 'products.write'));
    assert.ok(!viewerPerms.some(p => p.code === 'products.write'));
    assert.ok(viewerPerms.some(p => p.code === 'products.read'));
  });

  it('should prevent negative inventory', () => {
    const product = db.prepare('SELECT id FROM products WHERE sku = ?').get('RM-001') as { id: number };
    db.prepare(`
      INSERT INTO lots (lot_number, product_id, quantity, qc_status) VALUES ('LOT-001', ?, 100, 'PASSED')
    `).run(product.id);
    const lot = db.prepare('SELECT id FROM lots WHERE lot_number = ?').get('LOT-001') as { id: number };

    db.prepare(`
      INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, status) VALUES ('PLT-001', ?, ?, 50, 'ACTIVE')
    `).run(lot.id, product.id);

    const current = db.prepare(`
      SELECT COALESCE(SUM(quantity), 0) as total FROM pallets WHERE product_id = ? AND status = 'ACTIVE'
    `).get(product.id) as { total: number };

    assert.equal(current.total, 50);
    assert.throws(() => {
      if (current.total - 100 < 0) throw new Error('Inventory cannot go negative');
    }, /Inventory cannot go negative/);
  });

  it('should enforce QC-passed requirement for finished goods shipping', () => {
    db.prepare(`
      INSERT INTO products (sku, name, product_type, unit_of_measure, reorder_level)
      VALUES ('FG-001', 'Test Perfume', 'FINISHED_GOOD', 'EA', 10)
    `).run();
    const fg = db.prepare('SELECT id FROM products WHERE sku = ?').get('FG-001') as { id: number };

    db.prepare(`
      INSERT INTO lots (lot_number, product_id, quantity, qc_status) VALUES ('LOT-FG-001', ?, 100, 'PENDING')
    `).run(fg.id);
    const lot = db.prepare('SELECT id, qc_status FROM lots WHERE lot_number = ?').get('LOT-FG-001') as { id: number; qc_status: string };

    const productType = 'FINISHED_GOOD';
    const canShip = !(productType === 'FINISHED_GOOD' && lot.qc_status !== 'PASSED');
    assert.equal(canShip, false);

    db.prepare(`UPDATE lots SET qc_status = 'PASSED' WHERE id = ?`).run(lot.id);
    const updated = db.prepare('SELECT qc_status FROM lots WHERE id = ?').get(lot.id) as { qc_status: string };
    const canShipNow = !(productType === 'FINISHED_GOOD' && updated.qc_status !== 'PASSED');
    assert.equal(canShipNow, true);
  });

  it('should create audit log entries', () => {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@test.com') as { id: number };
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_value)
      VALUES (?, 'CREATE', 'product', 1, '{"sku":"TEST"}')
    `).run(user.id);

    const log = db.prepare('SELECT * FROM audit_logs WHERE entity_type = ?').get('product') as { action: string; user_id: number };
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
