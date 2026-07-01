import { getActivePgClient, getDriver, getPgPool, getSqliteDb, setActivePgClient } from './client';
import { adaptSqlForPostgres, isPostgres, toPgPlaceholders } from './dialect';

export { isPostgres, sqlNow } from './dialect';

export async function pingDb(): Promise<boolean> {
  try {
    if (isPostgres()) {
      const client = getActivePgClient() ?? getPgPool();
      if ('query' in client) {
        await client.query('SELECT 1');
      }
    } else {
      getSqliteDb().prepare('SELECT 1').get();
    }
    return true;
  } catch {
    return false;
  }
}

export async function queryOne<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  const rows = await queryAll<T>(sql, ...params);
  return rows[0];
}

export async function queryAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  if (isPostgres()) {
    const pgSql = adaptSqlForPostgres(toPgPlaceholders(sql));
    const client = getActivePgClient() ?? getPgPool();
    const result = await client.query(pgSql, params);
    return result.rows as T[];
  }
  const rows = getSqliteDb().prepare(sql).all(...params) as T[];
  return rows;
}

export async function queryRun(
  sql: string,
  ...params: unknown[]
): Promise<{ lastInsertRowid: number; changes: number }> {
  if (isPostgres()) {
    let pgSql = adaptSqlForPostgres(toPgPlaceholders(sql));
    const isInsert = /^\s*INSERT/i.test(pgSql.trim());
    if (isInsert && !/RETURNING/i.test(pgSql)) {
      pgSql = `${pgSql.trim()} RETURNING id`;
    }
    const client = getActivePgClient() ?? getPgPool();
    try {
      const result = await client.query(pgSql, params);
      const id = result.rows[0]?.id ?? 0;
      return { lastInsertRowid: Number(id), changes: result.rowCount ?? 0 };
    } catch (err) {
      if (isInsert && /RETURNING id/i.test(pgSql)) {
        const fallbackSql = pgSql.replace(/\s+RETURNING\s+id\s*$/i, '');
        const result = await client.query(fallbackSql, params);
        return { lastInsertRowid: 0, changes: result.rowCount ?? 0 };
      }
      throw err;
    }
  }
  const result = getSqliteDb().prepare(sql).run(...params);
  return { lastInsertRowid: Number(result.lastInsertRowid), changes: result.changes };
}

export async function queryExec(sql: string): Promise<void> {
  if (isPostgres()) {
    const pgSql = adaptSqlForPostgres(sql);
    const client = getActivePgClient() ?? getPgPool();
    await client.query(pgSql);
    return;
  }
  getSqliteDb().exec(sql);
}

export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (isPostgres()) {
    const pool = getPgPool();
    const client = await pool.connect();
    setActivePgClient(client);
    try {
      await client.query('BEGIN');
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      setActivePgClient(null);
      client.release();
    }
  }

  const db = getSqliteDb();
  db.exec('BEGIN');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** @deprecated Use queryOne/queryAll/queryRun — kept for gradual migration */
export default {
  prepare(sql: string) {
    return {
      get: (...params: unknown[]) => {
        if (!isPostgres()) {
          return getSqliteDb().prepare(sql).get(...params);
        }
        throw new Error('Sync db.prepare().get() is not supported on Postgres. Use await queryOne().');
      },
      all: (...params: unknown[]) => {
        if (!isPostgres()) {
          return getSqliteDb().prepare(sql).all(...params);
        }
        throw new Error('Sync db.prepare().all() is not supported on Postgres. Use await queryAll().');
      },
      run: (...params: unknown[]) => {
        if (!isPostgres()) {
          return getSqliteDb().prepare(sql).run(...params);
        }
        throw new Error('Sync db.prepare().run() is not supported on Postgres. Use await queryRun().');
      },
    };
  },
  transaction(fn: () => void) {
    if (!isPostgres()) {
      return getSqliteDb().transaction(fn);
    }
    throw new Error('Sync db.transaction() is not supported on Postgres. Use await transaction().');
  },
  exec(sql: string) {
    if (!isPostgres()) {
      getSqliteDb().exec(sql);
      return;
    }
    throw new Error('Sync db.exec() is not supported on Postgres. Use await queryExec().');
  },
};

export function getDbDriver(): string {
  return getDriver();
}
