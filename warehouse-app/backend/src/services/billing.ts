import db from '../db';
import { createAuditLog } from './inventory';

export function generateInvoiceNumber(): string {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const row = db.prepare(`
    SELECT MAX(CAST(SUBSTR(invoice_number, ? + 1) AS INTEGER)) as max_seq
    FROM invoices
    WHERE invoice_number LIKE ?
  `).get(prefix.length, `${prefix}%`) as { max_seq: number | null };
  const next = (row.max_seq ?? 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

export interface InvoiceTotals {
  subtotal: number;
  handlingFee: number;
  shippingFee: number;
  taxAmount: number;
  totalAmount: number;
}

export function calculateOrderInvoiceTotals(orderId: number, priority: string): InvoiceTotals {
  const items = db.prepare(`
    SELECT oi.quantity_ordered, COALESCE(p.unit_price, 0) as unit_price
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `).all(orderId) as Array<{ quantity_ordered: number; unit_price: number }>;

  const subtotal = items.reduce((sum, i) => sum + i.quantity_ordered * i.unit_price, 0);
  const totalUnits = items.reduce((sum, i) => sum + i.quantity_ordered, 0);

  const handlingFee = 15 + totalUnits * 0.5;
  const shippingFee = priority === 'URGENT' ? 45 : priority === 'HIGH' ? 30 : priority === 'NORMAL' ? 20 : 12;
  const taxAmount = Math.round((subtotal + handlingFee + shippingFee) * 0.08 * 100) / 100;
  const totalAmount = Math.round((subtotal + handlingFee + shippingFee + taxAmount) * 100) / 100;

  return { subtotal, handlingFee, shippingFee, taxAmount, totalAmount };
}

export function createQuoteInvoice(orderId: number, userId: number): number {
  const existing = db.prepare('SELECT id FROM invoices WHERE order_id = ?').get(orderId) as { id: number } | undefined;
  if (existing) return existing.id;

  const order = db.prepare('SELECT customer_id, priority FROM orders WHERE id = ?').get(orderId) as {
    customer_id: number; priority: string;
  } | undefined;
  if (!order) throw new Error('Order not found');

  const totals = calculateOrderInvoiceTotals(orderId, order.priority);
  const invoiceNumber = generateInvoiceNumber();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const result = db.prepare(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_id, status,
      subtotal, handling_fee, shipping_fee, tax_amount, total_amount,
      issued_at, due_date, notes
    ) VALUES (?, ?, ?, 'QUOTE', ?, ?, ?, ?, ?, datetime('now'), ?, ?)
  `).run(
    invoiceNumber, orderId, order.customer_id,
    totals.subtotal, totals.handlingFee, totals.shippingFee, totals.taxAmount, totals.totalAmount,
    dueDate.toISOString().slice(0, 10),
    'Auto-generated quote on order confirmation'
  );

  const invoiceId = Number(result.lastInsertRowid);

  const items = db.prepare(`
    SELECT oi.product_id, oi.quantity_ordered, p.name, COALESCE(p.unit_price, 0) as unit_price
    FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?
  `).all(orderId) as Array<{ product_id: number; quantity_ordered: number; name: string; unit_price: number }>;

  const insertLine = db.prepare(`
    INSERT INTO invoice_line_items (invoice_id, product_id, description, quantity, unit_price, line_total)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    insertLine.run(
      invoiceId, item.product_id, item.name, item.quantity_ordered,
      item.unit_price, item.quantity_ordered * item.unit_price
    );
  }

  createAuditLog({
    userId, action: 'CREATE', entityType: 'invoice', entityId: invoiceId,
    newValue: { invoiceNumber, orderId, status: 'QUOTE', total: totals.totalAmount },
  });

  return invoiceId;
}

export function sendInvoice(invoiceId: number, userId: number): void {
  db.prepare(`
    UPDATE invoices SET status = 'SENT', updated_at = datetime('now') WHERE id = ? AND status IN ('QUOTE', 'SENT')
  `).run(invoiceId);
  createAuditLog({ userId, action: 'UPDATE', entityType: 'invoice', entityId: invoiceId, newValue: { status: 'SENT' } });
}

export function markInvoicePaid(invoiceId: number, userId: number): void {
  db.prepare(`
    UPDATE invoices SET status = 'PAID', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `).run(invoiceId);
  createAuditLog({ userId, action: 'UPDATE', entityType: 'invoice', entityId: invoiceId, newValue: { status: 'PAID' } });
}

export function finalizeInvoiceOnDelivery(orderId: number, userId: number): void {
  const invoice = db.prepare('SELECT id, status FROM invoices WHERE order_id = ?').get(orderId) as {
    id: number; status: string;
  } | undefined;
  if (!invoice) return;
  if (invoice.status === 'PAID' || invoice.status === 'VOID') return;

  db.prepare(`
    UPDATE invoices SET status = 'SENT', updated_at = datetime('now') WHERE id = ?
  `).run(invoice.id);

  createAuditLog({
    userId, action: 'UPDATE', entityType: 'invoice', entityId: invoice.id,
    newValue: { status: 'SENT', event: 'DELIVERY_COMPLETED' },
  });
}

export function enrichInvoice(invoiceId: number) {
  const invoice = db.prepare(`
    SELECT i.*, o.order_number, c.name as customer_name
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(invoiceId);
  if (!invoice) return null;
  const lineItems = db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(invoiceId);
  return { ...invoice, lineItems };
}
