import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { completePickItem, logOrderAudit } from '../services/fulfillment';
import { tryAllocateOrder } from '../services/orderPipeline';

const router = Router();
router.use(authenticate);

router.get('/dashboard', requirePermission('fulfillment.read'), (req: Request, res: Response) => {
  const isWorker = req.user!.permissions.includes('fulfillment.pick') && !req.user!.permissions.includes('orders.read');
  const userId = req.user!.id;

  const today = new Date().toISOString().slice(0, 10);

  const metrics = {
    ordersReceivedToday: (db.prepare(`
      SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')
    `).get() as { c: number }).c,
    ordersAwaitingInventory: (db.prepare(`
      SELECT COUNT(*) as c FROM orders WHERE status IN ('NEW', 'INVENTORY_CHECK')
    `).get() as { c: number }).c,
    ordersBeingPicked: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'PICKING'`).get() as { c: number }).c,
    ordersBeingPacked: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'PACKING'`).get() as { c: number }).c,
    readyForPickup: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'READY_FOR_PICKUP'`).get() as { c: number }).c,
    inTransit: (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE status = 'IN_TRANSIT'`).get() as { c: number }).c,
    deliveredToday: (db.prepare(`
      SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERED' AND date(updated_at) = date('now')
    `).get() as { c: number }).c,
    delayedOrders: (db.prepare(`
      SELECT COUNT(*) as c FROM orders
      WHERE status NOT IN ('DELIVERED', 'CANCELLED')
        AND estimated_delivery_date < date('now')
    `).get() as { c: number }).c,
  };

  let taskQuery = `
    SELECT ft.*, o.order_number, o.priority, o.status as order_status, c.name as customer_name
    FROM fulfillment_tasks ft
    JOIN orders o ON o.id = ft.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE ft.status IN ('PENDING', 'IN_PROGRESS')
  `;
  if (isWorker) {
    taskQuery += ` AND (ft.assigned_to = ${userId} OR ft.assigned_to IS NULL)`;
  }
  taskQuery += ` ORDER BY CASE o.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'NORMAL' THEN 3 ELSE 4 END, ft.due_date`;

  const tasks = db.prepare(taskQuery).all();

  const dueToday = db.prepare(`
    SELECT o.*, c.name as customer_name FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.estimated_ship_date <= ? AND o.status NOT IN ('DELIVERED', 'CANCELLED')
    ORDER BY o.priority
  `).all(today);

  const priorityOrders = db.prepare(`
    SELECT o.*, c.name as customer_name FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.priority IN ('HIGH', 'URGENT') AND o.status NOT IN ('DELIVERED', 'CANCELLED')
    ORDER BY o.created_at DESC LIMIT 10
  `).all();

  res.json({ metrics, tasks, dueToday, priorityOrders });
});

router.get('/order-queue', requirePermission('fulfillment.read'), (_req: Request, res: Response) => {
  const awaitingStock = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.priority, c.name as customer_name,
           o.manager_override, o.override_reason
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM fulfillment_tasks ft WHERE ft.order_id = o.id AND ft.task_type = 'PICK'
    )
    ORDER BY o.created_at DESC
  `).all();

  const inFulfillment = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.priority, c.name as customer_name,
           (SELECT COUNT(*) FROM packages p WHERE p.order_id = o.id AND p.status = 'PACKED') as package_count
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ('ALLOCATED', 'PICKING', 'PACKING', 'READY_FOR_PICKUP')
    ORDER BY CASE o.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, o.estimated_ship_date
  `).all();

  res.json({ awaitingStock, inFulfillment });
});

router.post('/orders/:orderId/try-allocate', requirePermission('orders.confirm'), (req: Request, res: Response) => {
  const orderId = Number(req.params.orderId);
  const order = db.prepare('SELECT status FROM orders WHERE id = ?').get(orderId) as { status: string } | undefined;
  if (!order || order.status !== 'CONFIRMED') {
    res.status(400).json({ error: 'Only confirmed orders waiting on stock can be re-allocated' });
    return;
  }
  try {
    tryAllocateOrder(orderId, req.user!.id);
    res.json({ message: 'Inventory allocated — picking can start' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/tasks', requirePermission('fulfillment.read'), (req: Request, res: Response) => {
  const { type, status } = req.query;
  let query = `
    SELECT ft.*, o.order_number, o.priority, c.name as customer_name, u.full_name as assigned_to_name
    FROM fulfillment_tasks ft
    JOIN orders o ON o.id = ft.order_id
    JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = ft.assigned_to
    WHERE 1=1
  `;
  const params: string[] = [];
  if (type) { query += ' AND ft.task_type = ?'; params.push(type as string); }
  if (status) { query += ' AND ft.status = ?'; params.push(status as string); }
  if (req.user!.roles.includes('Warehouse Worker') && !req.user!.permissions.includes('orders.read')) {
    query += ' AND (ft.assigned_to = ? OR ft.assigned_to IS NULL)';
    params.push(String(req.user!.id));
  }
  query += ' ORDER BY ft.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.post('/pick/:itemId', requirePermission('fulfillment.pick'), (req: Request, res: Response) => {
  const { pickedQty, scannedPalletCode } = req.body;
  if (!scannedPalletCode || pickedQty === undefined) {
    res.status(400).json({ error: 'Pallet scan and picked quantity are required' });
    return;
  }
  try {
    const row = db.prepare(`
      SELECT pk.order_id FROM pick_list_items pli
      JOIN pick_lists pk ON pk.id = pli.pick_list_id WHERE pli.id = ?
    `).get(req.params.itemId) as { order_id: number } | undefined;
    if (row) {
      logOrderAudit(req.user!.id, row.order_id, 'PICK_ITEM', undefined, undefined, { pickListItemId: req.params.itemId });
    }
    completePickItem(Number(req.params.itemId), Number(pickedQty), scannedPalletCode, req.user!.id);
    res.json({ message: 'Pick confirmed' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
