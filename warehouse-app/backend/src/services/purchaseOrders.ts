import { queryAll, queryOne, queryRun, sqlNow } from '../db/query';

export async function generatePoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const last = await queryOne<{ po_number: string }>(`
    SELECT po_number FROM purchase_orders WHERE po_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `, `PO-${year}-%`);

  let seq = 1;
  if (last) {
    const parts = last.po_number.split('-');
    seq = Number(parts[2] ?? 0) + 1;
  }
  return `PO-${year}-${String(seq).padStart(5, '0')}`;
}

export async function enrichPurchaseOrder(po: Record<string, unknown>) {
  const items = await queryAll(`
    SELECT poi.*, p.sku, p.name as product_name, p.unit_of_measure
    FROM purchase_order_items poi
    JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = ?
    ORDER BY poi.id
  `, po.id);

  const received = await queryOne<{ c: number }>(`
    SELECT COUNT(*) as c FROM receiving_records WHERE purchase_order_id = ?
  `, po.id);

  return { ...po, items, receiveCount: received?.c ?? 0 };
}

export async function recalculatePoStatus(purchaseOrderId: number): Promise<void> {
  const lines = await queryAll<{ quantity_ordered: number; quantity_received: number }>(`
    SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE purchase_order_id = ?
  `, purchaseOrderId);

  if (!lines.length) return;

  const allReceived = lines.every(l => l.quantity_received >= l.quantity_ordered);
  const anyReceived = lines.some(l => l.quantity_received > 0);
  const status = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : 'OPEN';

  await queryRun(`UPDATE purchase_orders SET status = ?, updated_at = ${sqlNow()} WHERE id = ?`, status, purchaseOrderId);
}

export async function applyPoLineReceipt(
  purchaseOrderId: number,
  productId: number,
  quantity: number,
  purchaseOrderLineId?: number
): Promise<void> {
  const po = await queryOne<{ status: string }>(
    'SELECT status FROM purchase_orders WHERE id = ?',
    purchaseOrderId
  );
  if (!po) throw new Error('Purchase order not found');
  if (po.status === 'CANCELLED' || po.status === 'RECEIVED') {
    throw new Error('Purchase order is not open for receiving');
  }

  let line: { id: number; quantity_ordered: number; quantity_received: number } | undefined;
  if (purchaseOrderLineId) {
    line = await queryOne<{ id: number; quantity_ordered: number; quantity_received: number }>(`
      SELECT id, quantity_ordered, quantity_received FROM purchase_order_items
      WHERE id = ? AND purchase_order_id = ?
    `, purchaseOrderLineId, purchaseOrderId);
  } else {
    line = await queryOne<{ id: number; quantity_ordered: number; quantity_received: number }>(`
      SELECT id, quantity_ordered, quantity_received FROM purchase_order_items
      WHERE purchase_order_id = ? AND product_id = ?
    `, purchaseOrderId, productId);
  }

  if (!line) throw new Error('Product is not on this purchase order');

  const remaining = line.quantity_ordered - line.quantity_received;
  if (quantity > remaining + 0.0001) {
    throw new Error(`Cannot receive ${quantity} — only ${remaining} remaining on PO line`);
  }

  await queryRun(`
    UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?
  `, quantity, line.id);

  await recalculatePoStatus(purchaseOrderId);
}
