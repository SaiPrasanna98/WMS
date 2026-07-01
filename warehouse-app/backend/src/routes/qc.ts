import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction } from '../services/inventory';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('qc.read'), (req: Request, res: Response) => {
  const { status, search } = req.query;
  let query = `
    SELECT l.id as lot_id, l.lot_number, l.qc_status, l.quantity, l.received_date,
           p.id as product_id, p.sku, p.name as product_name, p.product_type,
           (SELECT qr.inspected_at FROM qc_records qr WHERE qr.lot_id = l.id ORDER BY qr.inspected_at DESC LIMIT 1) as last_inspected_at,
           (SELECT u.full_name FROM qc_records qr JOIN users u ON u.id = qr.inspected_by WHERE qr.lot_id = l.id ORDER BY qr.inspected_at DESC LIMIT 1) as last_inspector
    FROM lots l JOIN products p ON p.id = l.product_id WHERE 1=1
  `;
  const params: string[] = [];

  if (status) {
    query += ' AND l.qc_status = ?';
    params.push(status as string);
  }
  if (search) {
    query += ' AND (l.lot_number LIKE ? OR p.sku LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY l.updated_at DESC';

  res.json(db.prepare(query).all(...params));
});

router.get('/records', requirePermission('qc.read'), (_req: Request, res: Response) => {
  const records = db.prepare(`
    SELECT qr.*, l.lot_number, p.sku, p.name as product_name, u.full_name as inspector_name
    FROM qc_records qr
    JOIN lots l ON l.id = qr.lot_id
    JOIN products p ON p.id = qr.product_id
    JOIN users u ON u.id = qr.inspected_by
    ORDER BY qr.inspected_at DESC
  `).all();
  res.json(records);
});

router.post('/:lotId/inspect', requirePermission('qc.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { status, notes } = req.body;
  const lotId = Number(req.params.lotId);
  const validStatuses = ['PENDING', 'PASSED', 'FAILED', 'HOLD'];

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid QC status' });
    return;
  }

  const lot = db.prepare('SELECT * FROM lots WHERE id = ?').get(lotId) as {
    id: number; product_id: number; qc_status: string;
  } | undefined;

  if (!lot) { res.status(404).json({ error: 'Lot not found' }); return; }

  const inspectTransaction = db.transaction(() => {
    db.prepare(`UPDATE lots SET qc_status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, lotId);

    const result = db.prepare(`
      INSERT INTO qc_records (lot_id, product_id, status, inspected_by, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(lotId, lot.product_id, status, req.user!.id, notes || null);

    if (status === 'HOLD' || status === 'FAILED') {
      createInventoryTransaction({
        transactionType: status === 'HOLD' ? 'QC_HOLD' : 'QC_HOLD',
        productId: lot.product_id,
        lotId,
        quantity: 0,
        performedBy: req.user!.id,
        notes: notes || `QC ${status}`,
      });
      db.prepare(`UPDATE pallets SET status = 'HOLD', updated_at = datetime('now') WHERE lot_id = ? AND status = 'ACTIVE'`).run(lotId);
    } else if (status === 'PASSED' && (lot.qc_status === 'HOLD' || lot.qc_status === 'FAILED')) {
      createInventoryTransaction({
        transactionType: 'QC_RELEASE',
        productId: lot.product_id,
        lotId,
        quantity: 0,
        performedBy: req.user!.id,
        notes: notes || 'QC Hold released',
      });
      db.prepare(`UPDATE pallets SET status = 'ACTIVE', updated_at = datetime('now') WHERE lot_id = ? AND status = 'HOLD'`).run(lotId);
    }

    return Number(result.lastInsertRowid);
  });

  const recordId = inspectTransaction();
  createAuditLog({
    userId: req.user!.id,
    action: 'STATUS_CHANGE',
    entityType: 'lot',
    entityId: lotId,
    oldValue: { qcStatus: lot.qc_status },
    newValue: { qcStatus: status, notes },
  });
  res.status(201).json({ id: recordId, message: 'QC inspection recorded' });
});

export default router;
