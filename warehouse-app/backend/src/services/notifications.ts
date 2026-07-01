import { queryOne, queryRun, sqlNow } from '../db/query';

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

export async function sendCustomerNotification(params: NotifyParams): Promise<number> {
  const status = process.env.NOTIFICATIONS_ENABLED === 'false' ? 'QUEUED' : 'SENT';
  const result = await queryRun(`
    INSERT INTO customer_notifications (
      customer_id, order_id, channel, notification_type, recipient, subject, body, status, sent_at
    ) VALUES (?, ?, 'EMAIL', ?, ?, ?, ?, ?, ${sqlNow()})
  `,
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

export async function notifyOrderCreated(
  customerId: number,
  orderId: number,
  orderNumber: string,
  estimatedDelivery?: string,
  invoiceNumber?: string,
): Promise<void> {
  const customer = await queryOne<{ name: string; email: string | null }>(
    'SELECT name, email FROM customers WHERE id = ?',
    customerId
  );
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

  await sendCustomerNotification({
    customerId,
    orderId,
    type: 'ORDER_CREATED',
    recipient: customer.email,
    subject: `Order ${orderNumber} received`,
    body: lines.join('\n'),
  });
}

export async function notifyOrderDelivered(
  customerId: number,
  orderId: number,
  orderNumber: string,
  invoiceNumber?: string,
): Promise<void> {
  const customer = await queryOne<{ name: string; email: string | null }>(
    'SELECT name, email FROM customers WHERE id = ?',
    customerId
  );
  if (!customer?.email) return;

  await sendCustomerNotification({
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
