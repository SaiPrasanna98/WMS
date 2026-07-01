import { defineConfig } from 'drizzle-kit';
import path from 'path';

const usePostgres = Boolean(process.env.DATABASE_URL);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: usePostgres ? './drizzle/postgres' : './drizzle/sqlite',
  dialect: usePostgres ? 'postgresql' : 'sqlite',
  dbCredentials: usePostgres
    ? { url: process.env.DATABASE_URL! }
    : { url: process.env.DATABASE_PATH || path.join(__dirname, 'data/warehouse.db') },
});
