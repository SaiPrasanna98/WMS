import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('lots.read'), (req: Request, res: Response) => {
  const { search, qcStatus } = req.query;
  let query = `
    SELECT l.*, p.sku, p.name as product_name, p.product_type
    FROM lots l JOIN products p ON p.id = l.product_id WHERE 1=1
  `;
  const params: string[] = [];

  if (search) {
    query += ' AND (l.lot_number LIKE ? OR p.sku LIKE ? OR p.name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (qcStatus) {
    query += ' AND l.qc_status = ?';
    params.push(qcStatus as string);
  }
  query += ' ORDER BY l.created_at DESC';

  res.json(db.prepare(query).all(...params));
});

router.get('/:id', requirePermission('lots.read'), (req: Request, res: Response) => {
  const lot = db.prepare(`
    SELECT l.*, p.sku, p.name as product_name FROM lots l
    JOIN products p ON p.id = l.product_id WHERE l.id = ?
  `).get(req.params.id);
  if (!lot) { res.status(404).json({ error: 'Lot not found' }); return; }
  res.json(lot);
});

router.post('/', requirePermission('lots.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { lotNumber, productId, quantity, expiryDate, notes } = req.body;
  if (!lotNumber || !productId) {
    res.status(400).json({ error: 'Lot number and product ID are required' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO lots (lot_number, product_id, quantity, expiry_date, received_date, notes)
    VALUES (?, ?, ?, ?, date('now'), ?)
  `).run(lotNumber, productId, quantity || 0, expiryDate || null, notes || null);

  const id = Number(result.lastInsertRowid);
  createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'lot', entityId: id, newValue: req.body });
  res.status(201).json({ id, lotNumber });
});

router.put('/:id', requirePermission('lots.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { expiryDate, notes } = req.body;
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM lots WHERE id = ?').get(id);
  if (!existing) { res.status(404).json({ error: 'Lot not found' }); return; }

  db.prepare(`
    UPDATE lots SET expiry_date = COALESCE(?, expiry_date),
    notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ?
  `).run(expiryDate ?? null, notes ?? null, id);

  createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'lot', entityId: id, oldValue: existing, newValue: req.body });
  res.json({ message: 'Lot updated' });
});

export default router;
