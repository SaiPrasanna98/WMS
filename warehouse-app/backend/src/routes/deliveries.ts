import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { completeDelivery, driverPickup, failDelivery, logOrderAudit } from '../services/fulfillment';
import { refreshDriverStatus } from '../services/dispatch';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();
router.use(authenticate);

async function driverScope(req: Request): Promise<number | null> {
  const isDriverOnly = req.user!.roles.includes('Driver')
    && !req.user!.permissions.includes('orders.read');
  if (!isDriverOnly) return null;
  const driver = await queryOne('SELECT id FROM drivers WHERE user_id = ?', req.user!.id) as { id: number } | undefined;
  return driver?.id ?? -1;
}

router.get('/', requirePermission('deliveries.read'), async (req: Request, res: Response) => {
  const { status, includePending } = req.query;
  const driverId = await driverScope(req);

  let query = `
    SELECT d.*, o.order_number, o.status as order_status, c.name as customer_name,
           u.full_name as driver_name,
           ca.line1, ca.line2, ca.city, ca.state, ca.postal_code, ca.country,
           'delivery' as row_type
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN customer_addresses ca ON ca.id = d.delivery_address_id
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  if (driverId !== null && driverId > 0) { query += ' AND d.driver_id = ?'; params.push(driverId); }
  if (status) { query += ' AND d.status = ?'; params.push(status as string); }
  query += ` ORDER BY CASE d.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END, d.assigned_at DESC`;
  const deliveries = await queryAll(query, ...params) as Array<Record<string, unknown>>;

  if (includePending === 'true' && driverId === null) {
    const pending = await queryAll(`
      SELECT
        o.id as order_id,
        o.order_number,
        o.status as order_status,
        o.priority,
        c.name as customer_name,
        ca.line1, ca.city, ca.state, ca.postal_code,
        (SELECT COUNT(*) FROM packages p WHERE p.order_id = o.id AND p.status = 'PACKED') as package_count,
        'pending_dispatch' as row_type,
        NULL as id,
        'AWAITING_DISPATCH' as status,
        'Main Warehouse' as pickup_location,
        NULL as driver_name,
        NULL as tracking_number,
        NULL as carrier_name
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      JOIN customer_addresses ca ON ca.id = o.delivery_address_id
      WHERE o.status = 'READY_FOR_PICKUP'
        AND NOT EXISTS (
          SELECT 1 FROM deliveries d2 WHERE d2.order_id = o.id AND d2.status NOT IN ('DELIVERY_FAILED')
        )
      ORDER BY CASE o.priority WHEN 'URGENT' THEN 1 WHEN 'HIGH' THEN 2 ELSE 3 END
    `) as Array<Record<string, unknown>>;
    res.json([...pending, ...deliveries]);
    return;
  }

  res.json(deliveries);
});

router.get('/:id', requirePermission('deliveries.read'), async (req: Request, res: Response) => {
  const driverId = await driverScope(req);
  const delivery = await queryOne(`
    SELECT d.*, o.order_number, c.name as customer_name, u.full_name as driver_name,
           ca.line1, ca.line2, ca.city, ca.state, ca.postal_code, ca.country
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customers c ON c.id = o.customer_id
    JOIN customer_addresses ca ON ca.id = d.delivery_address_id
    LEFT JOIN drivers dr ON dr.id = d.driver_id
    LEFT JOIN users u ON u.id = dr.user_id
    WHERE d.id = ?
  `, req.params.id) as { driver_id: number } | undefined;

  if (!delivery) { res.status(404).json({ error: 'Delivery not found' }); return; }
  if (driverId !== null && driverId > 0 && delivery.driver_id !== driverId) {
    res.status(403).json({ error: 'Not assigned to this delivery' });
    return;
  }

  const packages = await queryAll('SELECT * FROM packages WHERE order_id = (SELECT order_id FROM deliveries WHERE id = ?)', req.params.id);
  res.json({ ...delivery, packages });
});

router.post('/:id/arrive', requirePermission('deliveries.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const delivery = await queryOne('SELECT driver_id FROM deliveries WHERE id = ?', req.params.id) as { driver_id: number } | undefined;
  if (!delivery) { res.status(404).json({ error: 'Delivery not found' }); return; }
  await queryRun(`UPDATE deliveries SET status = 'ARRIVED_AT_WAREHOUSE', updated_at = ${sqlNow()} WHERE id = ?`, req.params.id);
  await queryRun(`UPDATE driver_assignments SET status = 'ARRIVED_AT_WAREHOUSE' WHERE delivery_id = ?`, req.params.id);
  await refreshDriverStatus(delivery.driver_id);
  res.json({ message: 'Arrival recorded' });
});

router.post('/:id/pickup', requirePermission('deliveries.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { packageBarcodes, releasedByUserId } = req.body;
  const barcodes = Array.isArray(packageBarcodes)
    ? packageBarcodes.map((s: string) => String(s).trim()).filter(Boolean)
    : [];
  try {
    await driverPickup(
      Number(req.params.id),
      req.user!.id,
      barcodes,
      releasedByUserId ?? req.user!.id
    );
    res.json({ message: 'Pickup confirmed', status: 'IN_TRANSIT' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/start-transit', requirePermission('deliveries.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const delivery = await queryOne('SELECT order_id, status FROM deliveries WHERE id = ?', req.params.id) as {
    order_id: number; status: string;
  } | undefined;
  if (!delivery) { res.status(404).json({ error: 'Delivery not found' }); return; }

  await queryRun(`UPDATE deliveries SET status = 'IN_TRANSIT', updated_at = ${sqlNow()} WHERE id = ?`, req.params.id);
  await queryRun(`UPDATE driver_assignments SET status = 'IN_TRANSIT' WHERE delivery_id = ?`, req.params.id);
  await logOrderAudit(req.user!.id, delivery.order_id, 'IN_TRANSIT', 'IN_TRANSIT', 'IN_TRANSIT');
  res.json({ message: 'Delivery in transit' });
});

router.post('/:id/fail', requirePermission('deliveries.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { notes } = req.body;
  try {
    await failDelivery(Number(req.params.id), req.user!.id, notes ?? 'Delivery failed');
    res.json({ message: 'Delivery marked as failed' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/:id/tracking', requirePermission('deliveries.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { carrierName, trackingNumber, deliveryMethod } = req.body;
  const id = Number(req.params.id);
  const delivery = await queryOne('SELECT id FROM deliveries WHERE id = ?', id);
  if (!delivery) { res.status(404).json({ error: 'Delivery not found' }); return; }

  await queryRun(`
    UPDATE deliveries SET
      carrier_name = COALESCE(?, carrier_name),
      tracking_number = COALESCE(?, tracking_number),
      delivery_method = COALESCE(?, delivery_method),
      updated_at = ${sqlNow()}
    WHERE id = ?
  `, carrierName ?? null, trackingNumber ?? null, deliveryMethod ?? null, id);

  res.json({ message: 'Tracking updated' });
});

export default router;
