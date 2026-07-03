import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { adaptSqlForPostgres, sqlToday, sqlDateOf } from '../db/dialect';

describe('Postgres SQL dialect adaptation', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('compares created_at date to today as text', () => {
    const sql = adaptSqlForPostgres(`SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')`);
    assert.equal(sql, `SELECT COUNT(*) as c FROM orders WHERE ${sqlDateOf('created_at')} = ${sqlToday()}`);
  });

  it('compares delivery dates to today as text', () => {
    const sql = adaptSqlForPostgres(`
      SELECT COUNT(*) as c FROM orders
      WHERE status NOT IN ('DELIVERED', 'CANCELLED') AND estimated_delivery_date < date('now')
    `);
    assert.match(sql, /estimated_delivery_date < TO_CHAR\(CURRENT_DATE, 'YYYY-MM-DD'\)/);
  });

  it('inserts today into text date columns', () => {
    const sql = adaptSqlForPostgres(`INSERT INTO tasks (due_date) VALUES (date('now'))`);
    assert.match(sql, /VALUES \(TO_CHAR\(CURRENT_DATE, 'YYYY-MM-DD'\)\)/);
  });
});
