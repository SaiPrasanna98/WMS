import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { assignDriverToOrder } from '../services/fulfillment';
import { listDriversWithAvailability, refreshDriverStatus } from '../services/dispatch';
import { createAuditLog } from '../services/inventory';
import { queryOne, queryAll, queryRun } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('drivers.read'), async (_req: Request, res: Response) => {
  res.json(await listDriversWithAvailability());
});

router.get('/available', requirePermission('drivers.read'), async (_req: Request, res: Response) => {
  const drivers = await listDriversWithAvailability();
  res.json(drivers.filter(d => d.isAvailable));
});

router.get('/users-without-profile', requirePermission('drivers.write'), async (_req: Request, res: Response) => {
  const users = await queryAll(`
    SELECT u.id, u.full_name, u.email
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.name = 'Driver' AND u.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = u.id)
    ORDER BY u.full_name
  `);
  res.json(users);
});

router.get('/me', requirePermission('deliveries.read'), async (req: Request, res: Response) => {
  const driver = await queryOne(`
    SELECT d.*, u.full_name, u.email FROM drivers d
    JOIN users u ON u.id = d.user_id WHERE d.user_id = ? AND d.is_active = 1
  `, req.user!.id);
  if (!driver) { res.status(404).json({ error: 'Driver profile not found' }); return; }
  res.json(driver);
});

router.get('/:id', requirePermission('drivers.read'), async (req: Request, res: Response) => {
  const drivers = await listDriversWithAvailability();
  const driver = drivers.find((d) => (d as unknown as { id: number }).id === Number(req.params.id));
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  const deliveries = await queryAll(`
    SELECT d.id, d.status, d.priority, o.order_number, c.name as customer_name, d.assigned_at
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE d.driver_id = ? AND d.status NOT IN ('DELIVERED', 'DELIVERY_FAILED')
    ORDER BY d.assigned_at DESC
  `, req.params.id);

  res.json({ ...driver, activeDeliveryList: deliveries });
});

router.post('/', requirePermission('drivers.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { userId, licenseNumber, phone, vehicleInfo, maxActiveDeliveries } = req.body;
  if (!userId) { res.status(400).json({ error: 'User ID is required' }); return; }

  const existing = await queryOne('SELECT id FROM drivers WHERE user_id = ?', userId);
  if (existing) { res.status(400).json({ error: 'Driver already exists for this user' }); return; }

  const result = await queryRun(`
    INSERT INTO drivers (user_id, license_number, phone, vehicle_info, max_active_deliveries, status)
    VALUES (?, ?, ?, ?, ?, 'AVAILABLE')
  `, userId, licenseNumber ?? null, phone ?? null, vehicleInfo ?? null, maxActiveDeliveries ?? 3);

  await createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'driver', entityId: Number(result.lastInsertRowid) });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/:id/status', requirePermission('drivers.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { status } = req.body;
  if (!['AVAILABLE', 'ON_ROUTE', 'OFF_DUTY'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  const id = Number(req.params.id);
  const exists = await queryOne('SELECT id FROM drivers WHERE id = ?', id);
  if (!exists) { res.status(404).json({ error: 'Driver not found' }); return; }

  await queryRun('UPDATE drivers SET status = ? WHERE id = ?', status, id);
  if (status === 'AVAILABLE') await refreshDriverStatus(id);
  res.json({ message: 'Driver status updated' });
});

router.post('/:id/assign-order', requirePermission('deliveries.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { orderId, carrierName, trackingNumber, deliveryMethod } = req.body;
  if (!orderId) { res.status(400).json({ error: 'Order ID is required' }); return; }
  try {
    const deliveryId = await assignDriverToOrder(Number(orderId), Number(req.params.id), req.user!.id, {
      carrierName,
      trackingNumber,
      deliveryMethod: deliveryMethod ?? 'INTERNAL_DRIVER',
    });
    res.status(201).json({ deliveryId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
