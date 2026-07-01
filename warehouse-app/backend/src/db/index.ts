import fs from 'fs';
import path from 'path';
import { runMigrations } from './migrate';
import { getSqliteDb } from './client';
import { isPostgres, queryExec } from './query';

export { isPostgres, pingDb, queryAll, queryOne, queryRun, queryExec, transaction, getDbDriver } from './query';
export { getSqliteDb, getPgPool, closeConnections } from './client';

function resolveDbFile(filename: string): string {
  const candidates = [
    path.join(__dirname, filename),
    path.join(__dirname, '../../src/db', filename),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Database schema file not found: ${filename}`);
}

export async function initializeDatabase(): Promise<void> {
  if (isPostgres()) {
    const schemaPath = resolveDbFile('schema.postgres.sql');
    const schema = fs
      .readFileSync(schemaPath, 'utf-8')
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const statement of statements) {
      try {
        await queryExec(`${statement};`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('already exists')) continue;
        throw err;
      }
    }
    await runMigrations();
    return;
  }

  const schemaPath = resolveDbFile('schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  getSqliteDb().exec(schema);
  await runMigrations();
}

/** @deprecated Import from ./query instead */
export { default } from './query';
