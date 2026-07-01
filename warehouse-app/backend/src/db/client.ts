import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Pool, PoolClient } from 'pg';
import { isPostgres } from './dialect';

function resolveDbPath(): string {
  return process.env.DATABASE_PATH || path.join(__dirname, '../../data/warehouse.db');
}

let sqliteDb: Database.Database | null = null;
let pgPool: Pool | null = null;

export function getSqliteDb(): Database.Database {
  if (!sqliteDb) {
    const dbPath = resolveDbPath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    sqliteDb = new Database(dbPath);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
  }
  return sqliteDb;
}

export function getPgPool(): Pool {
  if (!pgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required for Postgres');
    }
    pgPool = new Pool({
      connectionString,
      ssl: connectionString.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
  }
  return pgPool;
}

export type TxClient = PoolClient | Database.Database;

let activePgClient: PoolClient | null = null;

export function setActivePgClient(client: PoolClient | null): void {
  activePgClient = client;
}

export function getActivePgClient(): PoolClient | null {
  return activePgClient;
}

export function getDriver(): 'postgres' | 'sqlite' {
  return isPostgres() ? 'postgres' : 'sqlite';
}

export async function closeConnections(): Promise<void> {
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
}
