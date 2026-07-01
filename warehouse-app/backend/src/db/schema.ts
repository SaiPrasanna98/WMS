/**
 * Drizzle ORM schema — source of truth for table definitions.
 * Runtime queries use the async query layer in query.ts for dual SQLite/Postgres support.
 */
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  fullName: text('full_name').notNull(),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const roles = sqliteTable('roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});

export const permissions = sqliteTable('permissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  module: text('module').notNull(),
  createdAt: text('created_at').notNull(),
});

export const userRoles = sqliteTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

export const products = sqliteTable('products', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  productType: text('product_type').notNull(),
  unitOfMeasure: text('unit_of_measure').notNull().default('EA'),
  unitPrice: real('unit_price').notNull().default(0),
  reorderLevel: real('reorder_level').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Additional tables are defined in schema.sql / schema.postgres.sql and managed via migrations.
