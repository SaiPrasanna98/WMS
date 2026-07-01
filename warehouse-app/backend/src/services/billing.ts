import { queryAll, queryOne, queryRun, sqlNow } from '../db/query';
import { createAuditLog } from './inventory';

export async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const row = await queryOne<{ max_seq: number | null }>(`
    SELECT MAX(CAST(SUBSTR(invoice_number, ? + 1) AS INTEGER)) as max_seq
    FROM invoices
    WHERE invoice_number LIKE ?
  `, prefix.length, `${prefix}%`);
  const next = (row?.max_seq ?? 0) + 1;
  return `${prefix}${String(next).padStart(5, '0')}`;
}

export interface InvoiceTotals {
  subtotal: number;
  handlingFee: number;
  shippingFee: number;
  taxAmount: number;
  totalAmount: number;
}

export async function calculateOrderInvoiceTotals(orderId: number, priority: string): Promise<InvoiceTotals> {
  const items = await queryAll<{ quantity_ordered: number; unit_price: number }>(`
    SELECT oi.quantity_ordered, COALESCE(p.unit_price, 0) as unit_price
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ?
  `, orderId);

  const subtotal = items.reduce((sum, i) => sum + i.quantity_ordered * i.unit_price, 0);
  const totalUnits = items.reduce((sum, i) => sum + i.quantity_ordered, 0);

  const handlingFee = 15 + totalUnits * 0.5;
  const shippingFee = priority === 'URGENT' ? 45 : priority === 'HIGH' ? 30 : priority === 'NORMAL' ? 20 : 12;
  const taxAmount = Math.round((subtotal + handlingFee + shippingFee) * 0.08 * 100) / 100;
  const totalAmount = Math.round((subtotal + handlingFee + shippingFee + taxAmount) * 100) / 100;

  return { subtotal, handlingFee, shippingFee, taxAmount, totalAmount };
}

export async function createQuoteInvoice(orderId: number, userId: number): Promise<number> {
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM invoices WHERE order_id = ?',
    orderId
  );
  if (existing) return existing.id;

  const order = await queryOne<{ customer_id: number; priority: string }>(
    'SELECT customer_id, priority FROM orders WHERE id = ?',
    orderId
  );
  if (!order) throw new Error('Order not found');

  const totals = await calculateOrderInvoiceTotals(orderId, order.priority);
  const invoiceNumber = await generateInvoiceNumber();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const result = await queryRun(`
    INSERT INTO invoices (
      invoice_number, order_id, customer_id, status,
      subtotal, handling_fee, shipping_fee, tax_amount, total_amount,
      issued_at, due_date, notes
    ) VALUES (?, ?, ?, 'QUOTE', ?, ?, ?, ?, ?, ${sqlNow()}, ?, ?)
  `,
    invoiceNumber, orderId, order.customer_id,
    totals.subtotal, totals.handlingFee, totals.shippingFee, totals.taxAmount, totals.totalAmount,
    dueDate.toISOString().slice(0, 10),
    'Auto-generated quote on order confirmation'
  );

  const invoiceId = Number(result.lastInsertRowid);

  const items = await queryAll<{ product_id: number; quantity_ordered: number; name: string; unit_price: number }>(`
    SELECT oi.product_id, oi.quantity_ordered, p.name, COALESCE(p.unit_price, 0) as unit_price
    FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?
  `, orderId);

  for (const item of items) {
    await queryRun(`
      INSERT INTO invoice_line_items (invoice_id, product_id, description, quantity, unit_price, line_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      invoiceId, item.product_id, item.name, item.quantity_ordered,
      item.unit_price, item.quantity_ordered * item.unit_price
    );
  }

  await createAuditLog({
    userId, action: 'CREATE', entityType: 'invoice', entityId: invoiceId,
    newValue: { invoiceNumber, orderId, status: 'QUOTE', total: totals.totalAmount },
  });

  return invoiceId;
}

export async function sendInvoice(invoiceId: number, userId: number): Promise<void> {
  await queryRun(`
    UPDATE invoices SET status = 'SENT', updated_at = ${sqlNow()} WHERE id = ? AND status IN ('QUOTE', 'SENT')
  `, invoiceId);
  await createAuditLog({ userId, action: 'UPDATE', entityType: 'invoice', entityId: invoiceId, newValue: { status: 'SENT' } });
}

export async function markInvoicePaid(invoiceId: number, userId: number): Promise<void> {
  await queryRun(`
    UPDATE invoices SET status = 'PAID', paid_at = ${sqlNow()}, updated_at = ${sqlNow()} WHERE id = ?
  `, invoiceId);
  await createAuditLog({ userId, action: 'UPDATE', entityType: 'invoice', entityId: invoiceId, newValue: { status: 'PAID' } });
}

export async function finalizeInvoiceOnDelivery(orderId: number, userId: number): Promise<void> {
  const invoice = await queryOne<{ id: number; status: string }>(
    'SELECT id, status FROM invoices WHERE order_id = ?',
    orderId
  );
  if (!invoice) return;
  if (invoice.status === 'PAID' || invoice.status === 'VOID') return;

  await queryRun(`
    UPDATE invoices SET status = 'SENT', updated_at = ${sqlNow()} WHERE id = ?
  `, invoice.id);

  await createAuditLog({
    userId, action: 'UPDATE', entityType: 'invoice', entityId: invoice.id,
    newValue: { status: 'SENT', event: 'DELIVERY_COMPLETED' },
  });
}

export async function enrichInvoice(invoiceId: number) {
  const invoice = await queryOne(`
    SELECT i.*, o.order_number, c.name as customer_name
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `, invoiceId);
  if (!invoice) return null;
  const lineItems = await queryAll('SELECT * FROM invoice_line_items WHERE invoice_id = ?', invoiceId);
  return { ...invoice, lineItems };
}
