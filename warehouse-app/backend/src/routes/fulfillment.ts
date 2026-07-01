import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { completePickItem, logOrderAudit } from '../services/fulfillment';
import { tryAllocateOrder } from '../services/orderPipeline';
import { queryOne, queryAll } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/dashboard', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
  const isWorker = req.user!.permissions.includes('fulfillment.pick') && !req.user!.permissions.includes('orders.read');
  const userId = req.user!.id;

  const today = new Date().toISOString().slice(0, 10);

  const metrics = {
    ordersReceivedToday: (await queryOne(`
      SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')
    `) as { c: number }).c,
    ordersAwaitingInventory: (await queryOne(`
      SELECT COUNT(*) as c FROM orders WHERE status IN ('NEW', 'INVENTORY_CHECK')
    `) as { c: number }).c,
    ordersBeingPicked: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'PICKING'`) as { c: number }).c,
    ordersBeingPacked: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'PACKING'`) as { c: number }).c,
    readyForPickup: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'READY_FOR_PICKUP'`) as { c: number }).c,
    inTransit: (await queryOne(`SELECT COUNT(*) as c FROM orders WHERE status = 'IN_TRANSIT'`) as { c: number }).c,
    deliveredToday: (await queryOne(`
      SELECT COUNT(*) as c FROM orders WHERE status = 'DELIVERED' AND date(updated_at) = date('now')
    `) as { c: number }).c,
    delayedOrders: (await queryOne(`
      SELECT COUNT(*) as c FROM orders
      WHERE status NOT IN ('DELIVERED', 'CANCELLED')
        AND estimated_delivery_date < date('now')
    `) as { c: number }).c,
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

  const tasks = await queryAll(taskQuery);

  const dueToday = await queryAll(`
    SELECT o.*, c.name as customer_name FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.estimated_ship_date <= ? AND o.status NOT IN ('DELIVERED', 'CANCELLED')
    ORDER BY o.priority
  `, today);

  const priorityOrders = await queryAll(`
    SELECT o.*, c.name as customer_name FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.priority IN ('HIGH', 'URGENT') AND o.status NOT IN ('DELIVERED', 'CANCELLED')
    ORDER BY o.created_at DESC LIMIT 10
  `);

  res.json({ metrics, tasks, dueToday, priorityOrders });
});

router.get('/order-queue', requirePermission('fulfillment.read'), async (_req: Request, res: Response) => {
  const awaitingStock = await queryAll(`
    SELECT o.id, o.order_number, o.status, o.priority, c.name as customer_name,
           o.manager_override, o.override_reason
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM fulfillment_tasks ft WHERE ft.order_id = o.id AND ft.task_type = 'PICK'
    )
    ORDER BY o.created_at DESC
  `);

  const inFulfillment = await queryAll(`
    SELECT o.id, o.order_number, o.status, o.priority, c.name as customer_name,
           (SELECT COUNT(*) FROM packages p WHERE p.order_id = o.id AND p.status = 'PACKED') as package_count
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.status IN ('ALLOCATED', 'PICKING', 'PACKING', 'READY_FOR_PICKUP')
    ORDER BY CASE o.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, o.estimated_ship_date
  `);

  res.json({ awaitingStock, inFulfillment });
});

router.post('/orders/:orderId/try-allocate', requirePermission('orders.confirm'), async (req: Request, res: Response) => {
  const orderId = Number(req.params.orderId);
  const order = await queryOne('SELECT status FROM orders WHERE id = ?', orderId) as { status: string } | undefined;
  if (!order || order.status !== 'CONFIRMED') {
    res.status(400).json({ error: 'Only confirmed orders waiting on stock can be re-allocated' });
    return;
  }
  try {
    await tryAllocateOrder(orderId, req.user!.id);
    res.json({ message: 'Inventory allocated — picking can start' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/tasks', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
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
  res.json(await queryAll(query, ...params));
});

router.post('/pick/:itemId', requirePermission('fulfillment.pick'), async (req: Request, res: Response) => {
  const { pickedQty, scannedPalletCode } = req.body;
  if (!scannedPalletCode || pickedQty === undefined) {
    res.status(400).json({ error: 'Pallet scan and picked quantity are required' });
    return;
  }
  try {
    const row = await queryOne(`
      SELECT pk.order_id FROM pick_list_items pli
      JOIN pick_lists pk ON pk.id = pli.pick_list_id WHERE pli.id = ?
    `, req.params.itemId) as { order_id: number } | undefined;
    if (row) {
      await logOrderAudit(req.user!.id, row.order_id, 'PICK_ITEM', undefined, undefined, { pickListItemId: req.params.itemId });
    }
    await completePickItem(Number(req.params.itemId), Number(pickedQty), scannedPalletCode, req.user!.id);
    res.json({ message: 'Pick confirmed' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
