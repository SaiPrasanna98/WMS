import db from '../db';

export type NotificationType =
  | 'ORDER_CREATED'
  | 'ORDER_CONFIRMED'
  | 'DELIVERY_SCHEDULED'
  | 'INVOICE_SENT'
  | 'DELIVERED';

interface NotifyParams {
  customerId: number;
  orderId?: number;
  type: NotificationType;
  recipient: string;
  subject: string;
  body: string;
}

export function sendCustomerNotification(params: NotifyParams): number {
  const status = process.env.NOTIFICATIONS_ENABLED === 'false' ? 'QUEUED' : 'SENT';
  const result = db.prepare(`
    INSERT INTO customer_notifications (
      customer_id, order_id, channel, notification_type, recipient, subject, body, status, sent_at
    ) VALUES (?, ?, 'EMAIL', ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    params.customerId,
    params.orderId ?? null,
    params.type,
    params.recipient,
    params.subject,
    params.body,
    status,
  );

  if (process.env.NODE_ENV !== 'test') {
    console.log(`[notification] ${params.type} → ${params.recipient}: ${params.subject}`);
  }

  return Number(result.lastInsertRowid);
}

export function notifyOrderCreated(
  customerId: number,
  orderId: number,
  orderNumber: string,
  estimatedDelivery?: string,
  invoiceNumber?: string,
): void {
  const customer = db.prepare('SELECT name, email FROM customers WHERE id = ?').get(customerId) as
    { name: string; email: string | null } | undefined;
  if (!customer?.email) return;

  const lines = [
    `Dear ${customer.name},`,
    '',
    `We received your order ${orderNumber}.`,
    estimatedDelivery ? `Estimated delivery: ${estimatedDelivery}.` : '',
    invoiceNumber ? `Invoice reference: ${invoiceNumber}.` : '',
    '',
    'Thank you for your business.',
  ].filter(Boolean);

  sendCustomerNotification({
    customerId,
    orderId,
    type: 'ORDER_CREATED',
    recipient: customer.email,
    subject: `Order ${orderNumber} received`,
    body: lines.join('\n'),
  });
}

export function notifyOrderDelivered(
  customerId: number,
  orderId: number,
  orderNumber: string,
  invoiceNumber?: string,
): void {
  const customer = db.prepare('SELECT name, email FROM customers WHERE id = ?').get(customerId) as
    { name: string; email: string | null } | undefined;
  if (!customer?.email) return;

  sendCustomerNotification({
    customerId,
    orderId,
    type: 'DELIVERED',
    recipient: customer.email,
    subject: `Order ${orderNumber} delivered`,
    body: [
      `Dear ${customer.name},`,
      '',
      `Your order ${orderNumber} has been delivered.`,
      invoiceNumber ? `Invoice ${invoiceNumber} is attached to your account.` : '',
    ].filter(Boolean).join('\n'),
  });
}
