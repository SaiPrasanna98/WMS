import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { assignDriverToOrder } from '../services/fulfillment';
import { listDriversWithAvailability, refreshDriverStatus } from '../services/dispatch';
import { createAuditLog } from '../services/inventory';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('drivers.read'), (_req: Request, res: Response) => {
  res.json(listDriversWithAvailability());
});

router.get('/available', requirePermission('drivers.read'), (_req: Request, res: Response) => {
  res.json(listDriversWithAvailability().filter(d => d.isAvailable));
});

router.get('/users-without-profile', requirePermission('drivers.write'), (_req: Request, res: Response) => {
  const users = db.prepare(`
    SELECT u.id, u.full_name, u.email
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.name = 'Driver' AND u.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = u.id)
    ORDER BY u.full_name
  `).all();
  res.json(users);
});

router.get('/me', requirePermission('deliveries.read'), (req: Request, res: Response) => {
  const driver = db.prepare(`
    SELECT d.*, u.full_name, u.email FROM drivers d
    JOIN users u ON u.id = d.user_id WHERE d.user_id = ? AND d.is_active = 1
  `).get(req.user!.id);
  if (!driver) { res.status(404).json({ error: 'Driver profile not found' }); return; }
  res.json(driver);
});

router.get('/:id', requirePermission('drivers.read'), (req: Request, res: Response) => {
  const driver = listDriversWithAvailability().find(d => d.id === Number(req.params.id));
  if (!driver) { res.status(404).json({ error: 'Driver not found' }); return; }

  const deliveries = db.prepare(`
    SELECT d.id, d.status, d.priority, o.order_number, c.name as customer_name, d.assigned_at
    FROM deliveries d
    JOIN orders o ON o.id = d.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE d.driver_id = ? AND d.status NOT IN ('DELIVERED', 'DELIVERY_FAILED')
    ORDER BY d.assigned_at DESC
  `).all(req.params.id);

  res.json({ ...driver, activeDeliveryList: deliveries });
});

router.post('/', requirePermission('drivers.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { userId, licenseNumber, phone, vehicleInfo, maxActiveDeliveries } = req.body;
  if (!userId) { res.status(400).json({ error: 'User ID is required' }); return; }

  const existing = db.prepare('SELECT id FROM drivers WHERE user_id = ?').get(userId);
  if (existing) { res.status(400).json({ error: 'Driver already exists for this user' }); return; }

  const result = db.prepare(`
    INSERT INTO drivers (user_id, license_number, phone, vehicle_info, max_active_deliveries, status)
    VALUES (?, ?, ?, ?, ?, 'AVAILABLE')
  `).run(userId, licenseNumber ?? null, phone ?? null, vehicleInfo ?? null, maxActiveDeliveries ?? 3);

  createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'driver', entityId: Number(result.lastInsertRowid) });
  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

router.put('/:id/status', requirePermission('drivers.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { status } = req.body;
  if (!['AVAILABLE', 'ON_ROUTE', 'OFF_DUTY'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM drivers WHERE id = ?').get(id);
  if (!exists) { res.status(404).json({ error: 'Driver not found' }); return; }

  db.prepare('UPDATE drivers SET status = ? WHERE id = ?').run(status, id);
  if (status === 'AVAILABLE') refreshDriverStatus(id);
  res.json({ message: 'Driver status updated' });
});

router.post('/:id/assign-order', requirePermission('deliveries.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { orderId, carrierName, trackingNumber, deliveryMethod } = req.body;
  if (!orderId) { res.status(400).json({ error: 'Order ID is required' }); return; }
  try {
    const deliveryId = assignDriverToOrder(Number(orderId), Number(req.params.id), req.user!.id, {
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
