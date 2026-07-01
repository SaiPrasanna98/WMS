import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('locations.read'), async (req: Request, res: Response) => {
  const { search, zone, type } = req.query;
  let query = 'SELECT * FROM warehouse_locations WHERE is_active = 1';
  const params: string[] = [];

  if (search) {
    query += ' AND code LIKE ?';
    params.push(`%${search}%`);
  }
  if (zone) {
    query += ' AND zone = ?';
    params.push(zone as string);
  }
  if (type) {
    query += ' AND location_type = ?';
    params.push(type as string);
  }
  query += ' ORDER BY code';

  const locations = await queryAll(query, ...params);
  const enriched = await Promise.all(locations.map(async (loc) => {
    const palletCount = await queryOne(`
      SELECT COUNT(*) as count FROM pallets WHERE location_id = ? AND status = 'ACTIVE'
    `, (loc as { id: number }).id) as { count: number };
    return { ...(loc as Record<string, unknown>), palletCount: palletCount.count };
  }));
  res.json(enriched);
});

router.get('/:id', requirePermission('locations.read'), async (req: Request, res: Response) => {
  const location = await queryOne('SELECT * FROM warehouse_locations WHERE id = ?', req.params.id);
  if (!location) { res.status(404).json({ error: 'Location not found' }); return; }
  res.json(location);
});

router.post('/', requirePermission('locations.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { code, zone, aisle, rack, shelf, locationType } = req.body;
  if (!code || !zone || !locationType) {
    res.status(400).json({ error: 'Code, zone, and location type are required' });
    return;
  }

  const result = await queryRun(`
    INSERT INTO warehouse_locations (code, zone, aisle, rack, shelf, location_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `, code, zone, aisle || null, rack || null, shelf || null, locationType);

  const id = Number(result.lastInsertRowid);
  await createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'warehouse_location', entityId: id, newValue: req.body });
  res.status(201).json({ id, code });
});

router.put('/:id', requirePermission('locations.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { zone, aisle, rack, shelf, locationType, isActive } = req.body;
  const id = Number(req.params.id);

  await queryRun(`
    UPDATE warehouse_locations SET
      zone = COALESCE(?, zone), aisle = COALESCE(?, aisle),
      rack = COALESCE(?, rack), shelf = COALESCE(?, shelf),
      location_type = COALESCE(?, location_type),
      is_active = COALESCE(?, is_active),
      updated_at = ${sqlNow()}
    WHERE id = ?
  `, zone, aisle, rack, shelf, locationType, isActive, id);

  await createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'warehouse_location', entityId: id, newValue: req.body });
  res.json({ message: 'Location updated' });
});

export default router;
