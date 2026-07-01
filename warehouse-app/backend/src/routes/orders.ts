import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import {
  checkOrderInventory, confirmOrder, generateOrderNumber, logOrderAudit, updateOrderStatus,
} from '../services/fulfillment';
import { createAuditLog } from '../services/inventory';
import { getOrderPipeline, onOrderCreated } from '../services/orderPipeline';

const router = Router();
router.use(authenticate);

function enrichOrder(order: Record<string, unknown>) {
  const items = db.prepare(`
    SELECT oi.*, p.sku, p.name as product_name
    FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?
  `).all(order.id);
  const customer = db.prepare('SELECT name, email, phone FROM customers WHERE id = ?').get(order.customer_id);
  const address = db.prepare('SELECT * FROM customer_addresses WHERE id = ?').get(order.delivery_address_id);
  const invoice = db.prepare(`
    SELECT id, invoice_number, status, total_amount, subtotal, handling_fee, shipping_fee, tax_amount
    FROM invoices WHERE order_id = ?
  `).get(order.id);
  const delivery = db.prepare(`
    SELECT d.id, d.status, d.tracking_number, d.carrier_name, d.delivery_method, u.full_name as driver_name
    FROM deliveries d
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE d.order_id = ? AND d.status NOT IN ('DELIVERY_FAILED')
    ORDER BY d.id DESC LIMIT 1
  `).get(order.id);
  return { ...order, items, customer, deliveryAddress: address, invoice, delivery };
}

router.get('/', requirePermission('orders.read'), (req: Request, res: Response) => {
  const { status, search } = req.query;
  let query = `
    SELECT o.*, c.name as customer_name, u.full_name as created_by_name
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN users u ON u.id = o.created_by
    WHERE 1=1
  `;
  const params: string[] = [];
  if (status) { query += ' AND o.status = ?'; params.push(status as string); }
  if (search) {
    query += ' AND (o.order_number LIKE ? OR c.name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY o.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/:id', requirePermission('orders.read'), (req: Request, res: Response) => {
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, u.full_name as created_by_name
    FROM orders o JOIN customers c ON c.id = o.customer_id
    JOIN users u ON u.id = o.created_by WHERE o.id = ?
  `).get(req.params.id) as Record<string, unknown> | undefined;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  res.json(enrichOrder(order));
});

router.post('/', requirePermission('orders.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { customerId, deliveryAddressId, priority, notes, items, idempotencyKey } = req.body;
  if (!customerId || !deliveryAddressId || !items?.length) {
    res.status(400).json({ error: 'Customer, delivery address, and items are required' });
    return;
  }

  if (idempotencyKey && typeof idempotencyKey === 'string') {
    const existing = db.prepare(`
      SELECT response_json FROM order_idempotency_keys WHERE idempotency_key = ?
    `).get(idempotencyKey) as { response_json: string } | undefined;
    if (existing) {
      res.status(201).json(JSON.parse(existing.response_json));
      return;
    }
  }

  try {
    const created = db.transaction(() => {
      const orderNumber = generateOrderNumber();
      const result = db.prepare(`
        INSERT INTO orders (order_number, customer_id, delivery_address_id, status, priority, created_by, notes)
        VALUES (?, ?, ?, 'NEW', ?, ?, ?)
      `).run(orderNumber, customerId, deliveryAddressId, priority ?? 'NORMAL', req.user!.id, notes ?? null);
      const orderId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, quantity_ordered) VALUES (?, ?, ?)
      `);
      for (const item of items) {
        if (!item.productId || !item.quantity) {
          throw new Error('Each item needs productId and quantity');
        }
        insertItem.run(orderId, item.productId, item.quantity);
      }

      updateOrderStatus(orderId, 'INVENTORY_CHECK');
      logOrderAudit(req.user!.id, orderId, 'ORDER_CREATED', 'NEW', 'INVENTORY_CHECK');
      createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'order', entityId: orderId, newValue: { orderNumber } });

      const pipeline = onOrderCreated(orderId, req.user!.id);
      const finalOrder = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string };

      const response = {
        id: orderId,
        orderNumber,
        status: finalOrder.status,
        message: pipeline.blockers.length
          ? `Order ${orderNumber} created. Awaiting inventory allocation.`
          : `Order ${orderNumber} created and confirmed.`,
      };

      if (idempotencyKey && typeof idempotencyKey === 'string') {
        db.prepare(`
          INSERT INTO order_idempotency_keys (idempotency_key, order_id, response_json)
          VALUES (?, ?, ?)
        `).run(idempotencyKey, orderId, JSON.stringify(response));
      }

      return response;
    })();

    res.status(201).json(created);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes('productId and quantity')) {
      res.status(400).json({ error: message });
      return;
    }
    res.status(500).json({ error: message || 'Failed to create order' });
  }
});

router.get('/:id/pipeline', requirePermission('orders.read'), (req: Request, res: Response) => {
  try {
    res.json(getOrderPipeline(Number(req.params.id)));
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.get('/:id/inventory-check', requirePermission('orders.read'), (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  res.json(checkOrderInventory(orderId));
});

router.post('/:id/confirm', requirePermission('orders.confirm'), blockViewerWrite, (req: Request, res: Response) => {
  try {
    const { managerOverride, overrideReason } = req.body;
    if (managerOverride && !req.user!.permissions.includes('orders.override')) {
      res.status(403).json({ error: 'Manager override permission required' });
      return;
    }
    confirmOrder(Number(req.params.id), req.user!.id, Boolean(managerOverride), overrideReason);
    const pipeline = getOrderPipeline(Number(req.params.id));
    res.json({ message: 'Order confirmed', pipeline });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/cancel', requirePermission('orders.write'), blockViewerWrite, (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string } | undefined;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  if (['DELIVERED', 'IN_TRANSIT', 'CANCELLED'].includes(order.status)) {
    res.status(400).json({ error: 'Order cannot be cancelled' });
    return;
  }

  db.prepare(`UPDATE inventory_reservations SET status = 'RELEASED' WHERE order_id = ?`).run(orderId);
  updateOrderStatus(orderId, 'CANCELLED');
  logOrderAudit(req.user!.id, orderId, 'ORDER_CANCELLED', order.status, 'CANCELLED');
  res.json({ message: 'Order cancelled' });
});

const EDITABLE_ORDER_STATUSES = ['NEW', 'INVENTORY_CHECK'];

router.put('/:id', requirePermission('orders.write'), blockViewerWrite, (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as { status: string } | undefined;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  if (!EDITABLE_ORDER_STATUSES.includes(order.status)) {
    res.status(400).json({
      error: 'Order can only be edited before confirmation. Cancel and create a new order, or contact a manager.',
    });
    return;
  }

  const { priority, notes, deliveryAddressId, items } = req.body;

  if (deliveryAddressId) {
    const addr = db.prepare('SELECT id FROM customer_addresses WHERE id = ?').get(deliveryAddressId);
    if (!addr) { res.status(400).json({ error: 'Invalid delivery address' }); return; }
  }

  db.prepare(`
    UPDATE orders SET
      priority = COALESCE(?, priority),
      notes = COALESCE(?, notes),
      delivery_address_id = COALESCE(?, delivery_address_id),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(priority ?? null, notes ?? null, deliveryAddressId ?? null, orderId);

  if (items?.length) {
    for (const item of items) {
      if (!item.productId || !item.quantity || Number(item.quantity) <= 0) {
        res.status(400).json({ error: 'Each line item needs a valid product and quantity' });
        return;
      }
    }
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, quantity_ordered) VALUES (?, ?, ?)
    `);
    for (const item of items) {
      insertItem.run(orderId, item.productId, item.quantity);
    }
  }

  logOrderAudit(req.user!.id, orderId, 'ORDER_UPDATED', order.status, order.status, req.body);
  createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'order', entityId: orderId, newValue: req.body });
  res.json({ message: 'Order updated', order: enrichOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown>) });
});

router.post('/:id/start-picking', requirePermission('fulfillment.pick'), blockViewerWrite, (req: Request, res: Response) => {
  const orderId = Number(req.params.id);
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string } | undefined;
  if (!order) { res.status(404).json({ error: 'Order not found' }); return; }
  if (!['ALLOCATED', 'PICKING'].includes(order.status)) {
    res.status(400).json({ error: 'Picking cannot start until inventory is reserved' });
    return;
  }

  const hasReservations = db.prepare(`
    SELECT COUNT(*) as c FROM inventory_reservations WHERE order_id = ? AND status = 'RESERVED'
  `).get(orderId) as { c: number };
  if (hasReservations.c === 0) {
    res.status(400).json({ error: 'No reserved inventory for this order' });
    return;
  }

  updateOrderStatus(orderId, 'PICKING');
  db.prepare(`UPDATE pick_lists SET status = 'IN_PROGRESS' WHERE order_id = ?`).run(orderId);
  db.prepare(`
    UPDATE fulfillment_tasks SET status = 'IN_PROGRESS', assigned_to = ?, updated_at = datetime('now')
    WHERE order_id = ? AND task_type = 'PICK'
  `).run(req.user!.id, orderId);
  logOrderAudit(req.user!.id, orderId, 'PICK_STARTED', order.status, 'PICKING');
  res.json({ message: 'Picking started' });
});

export default router;
