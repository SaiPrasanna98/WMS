/** Returns whether the app is using Neon/Postgres (DATABASE_URL set). */
export function isPostgres(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/** Current timestamp expression for raw SQL. */
export function sqlNow(): string {
  return isPostgres()
    ? `TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`
    : `datetime('now')`;
}

/** Today's date as YYYY-MM-DD text (SQLite date('now') equivalent for TEXT columns). */
export function sqlToday(): string {
  return isPostgres() ? `TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')` : `date('now')`;
}

/** Date offset expression, e.g. sqlDateOffset('+7 days'). */
export function sqlDateOffset(offset: string): string {
  if (isPostgres()) {
    const match = offset.match(/^([+-]?\d+)\s+days?$/i);
    if (match) {
      const days = parseInt(match[1], 10);
      return `TO_CHAR(CURRENT_DATE + INTERVAL '${days} days', 'YYYY-MM-DD')`;
    }
    return sqlToday();
  }
  return `date('now', '${offset}')`;
}

/** Extract YYYY-MM-DD from a TEXT datetime column. */
export function sqlDateOf(column: string): string {
  return isPostgres() ? `SUBSTRING(${column}, 1, 10)` : `date(${column})`;
}

/** Convert ? placeholders to $1, $2, ... for Postgres. */
export function toPgPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/** Adapt SQLite-oriented SQL for Postgres execution. */
export function adaptSqlForPostgres(sql: string): string {
  if (!isPostgres()) return sql;

  let adapted = sql;

  adapted = adapted.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  adapted = adapted.replace(/datetime\('now'\)/gi, sqlNow());
  adapted = adapted.replace(/date\('now',\s*'([^']+)'\)/gi, (_m, offset: string) => sqlDateOffset(offset));
  adapted = adapted.replace(/date\('now'\)/gi, sqlToday());
  adapted = adapted.replace(/\bdate\(([a-z_][\w.]*)\)/gi, (_m, column: string) => sqlDateOf(column));

  return adapted;
}

/** Add ON CONFLICT DO NOTHING when INSERT OR IGNORE was stripped (simple unique-column heuristic). */
export function withInsertIgnoreConflict(sql: string, conflictColumn?: string): string {
  if (!conflictColumn || /ON\s+CONFLICT/i.test(sql)) return sql;
  const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*\([^)]+\)\s*VALUES/i);
  if (!match) return sql;
  return `${sql.trim()} ON CONFLICT (${conflictColumn}) DO NOTHING`;
}
