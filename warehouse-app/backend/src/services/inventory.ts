import db from '../db';
import { AuditAction } from '../types';

export function createAuditLog(params: {
  userId?: number;
  action: AuditAction;
  entityType: string;
  entityId?: number;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
}): void {
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.userId ?? null,
    params.action,
    params.entityType,
    params.entityId ?? null,
    params.oldValue != null ? JSON.stringify(params.oldValue) : null,
    params.newValue != null ? JSON.stringify(params.newValue) : null,
    params.ipAddress ?? null
  );
}

export function getProductInventory(productId: number): number {
  const result = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) as total
    FROM pallets
    WHERE product_id = ? AND status = 'ACTIVE'
  `).get(productId) as { total: number };
  return result.total;
}

export function ensureNonNegativeInventory(productId: number, quantityChange: number): void {
  const current = getProductInventory(productId);
  if (current + quantityChange < 0) {
    throw new Error('Inventory cannot go negative');
  }
}

export function createInventoryTransaction(params: {
  transactionType: string;
  productId: number;
  lotId?: number;
  palletId?: number;
  fromLocationId?: number;
  toLocationId?: number;
  quantity: number;
  referenceType?: string;
  referenceId?: number;
  performedBy: number;
  notes?: string;
}): number {
  const result = db.prepare(`
    INSERT INTO inventory_transactions (
      transaction_type, product_id, lot_id, pallet_id,
      from_location_id, to_location_id, quantity,
      reference_type, reference_id, performed_by, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    params.transactionType,
    params.productId,
    params.lotId ?? null,
    params.palletId ?? null,
    params.fromLocationId ?? null,
    params.toLocationId ?? null,
    params.quantity,
    params.referenceType ?? null,
    params.referenceId ?? null,
    params.performedBy,
    params.notes ?? null
  );
  return Number(result.lastInsertRowid);
}

export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}
