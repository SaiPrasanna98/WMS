import db from '../db';

export function generatePoNumber(): string {
  const year = new Date().getFullYear();
  const last = db.prepare(`
    SELECT po_number FROM purchase_orders WHERE po_number LIKE ?
    ORDER BY id DESC LIMIT 1
  `).get(`PO-${year}-%`) as { po_number: string } | undefined;

  let seq = 1;
  if (last) {
    const parts = last.po_number.split('-');
    seq = Number(parts[2] ?? 0) + 1;
  }
  return `PO-${year}-${String(seq).padStart(5, '0')}`;
}

export function enrichPurchaseOrder(po: Record<string, unknown>) {
  const items = db.prepare(`
    SELECT poi.*, p.sku, p.name as product_name, p.unit_of_measure
    FROM purchase_order_items poi
    JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = ?
    ORDER BY poi.id
  `).all(po.id);

  const received = db.prepare(`
    SELECT COUNT(*) as c FROM receiving_records WHERE purchase_order_id = ?
  `).get(po.id) as { c: number };

  return { ...po, items, receiveCount: received.c };
}

export function recalculatePoStatus(purchaseOrderId: number): void {
  const lines = db.prepare(`
    SELECT quantity_ordered, quantity_received FROM purchase_order_items WHERE purchase_order_id = ?
  `).all(purchaseOrderId) as Array<{ quantity_ordered: number; quantity_received: number }>;

  if (!lines.length) return;

  const allReceived = lines.every(l => l.quantity_received >= l.quantity_ordered);
  const anyReceived = lines.some(l => l.quantity_received > 0);
  const status = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : 'OPEN';

  db.prepare(`UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, purchaseOrderId);
}

export function applyPoLineReceipt(
  purchaseOrderId: number,
  productId: number,
  quantity: number,
  purchaseOrderLineId?: number
): void {
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(purchaseOrderId) as
    { status: string } | undefined;
  if (!po) throw new Error('Purchase order not found');
  if (po.status === 'CANCELLED' || po.status === 'RECEIVED') {
    throw new Error('Purchase order is not open for receiving');
  }

  let line: { id: number; quantity_ordered: number; quantity_received: number } | undefined;
  if (purchaseOrderLineId) {
    line = db.prepare(`
      SELECT id, quantity_ordered, quantity_received FROM purchase_order_items
      WHERE id = ? AND purchase_order_id = ?
    `).get(purchaseOrderLineId, purchaseOrderId) as typeof line;
  } else {
    line = db.prepare(`
      SELECT id, quantity_ordered, quantity_received FROM purchase_order_items
      WHERE purchase_order_id = ? AND product_id = ?
    `).get(purchaseOrderId, productId) as typeof line;
  }

  if (!line) throw new Error('Product is not on this purchase order');

  const remaining = line.quantity_ordered - line.quantity_received;
  if (quantity > remaining + 0.0001) {
    throw new Error(`Cannot receive ${quantity} — only ${remaining} remaining on PO line`);
  }

  db.prepare(`
    UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE id = ?
  `).run(quantity, line.id);

  recalculatePoStatus(purchaseOrderId);
}
