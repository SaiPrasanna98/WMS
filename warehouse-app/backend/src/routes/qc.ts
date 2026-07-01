import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction } from '../services/inventory';
import { queryOne, queryAll, queryRun, transaction, sqlNow } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('qc.read'), async (req: Request, res: Response) => {
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

  res.json(await queryAll(query, ...params));
});

router.get('/records', requirePermission('qc.read'), async (_req: Request, res: Response) => {
  const records = await queryAll(`
    SELECT qr.*, l.lot_number, p.sku, p.name as product_name, u.full_name as inspector_name
    FROM qc_records qr
    JOIN lots l ON l.id = qr.lot_id
    JOIN products p ON p.id = qr.product_id
    JOIN users u ON u.id = qr.inspected_by
    ORDER BY qr.inspected_at DESC
  `);
  res.json(records);
});

router.post('/:lotId/inspect', requirePermission('qc.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { status, notes } = req.body;
  const lotId = Number(req.params.lotId);
  const validStatuses = ['PENDING', 'PASSED', 'FAILED', 'HOLD'];

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid QC status' });
    return;
  }

  const lot = await queryOne('SELECT * FROM lots WHERE id = ?', lotId) as {
    id: number; product_id: number; qc_status: string;
  } | undefined;

  if (!lot) { res.status(404).json({ error: 'Lot not found' }); return; }

  const recordId = await transaction(async () => {
    await queryRun(`UPDATE lots SET qc_status = ?, updated_at = ${sqlNow()} WHERE id = ?`, status, lotId);

    const result = await queryRun(`
      INSERT INTO qc_records (lot_id, product_id, status, inspected_by, notes)
      VALUES (?, ?, ?, ?, ?)
    `, lotId, lot.product_id, status, req.user!.id, notes || null);

    if (status === 'HOLD' || status === 'FAILED') {
      await createInventoryTransaction({
        transactionType: status === 'HOLD' ? 'QC_HOLD' : 'QC_HOLD',
        productId: lot.product_id,
        lotId,
        quantity: 0,
        performedBy: req.user!.id,
        notes: notes || `QC ${status}`,
      });
      await queryRun(`UPDATE pallets SET status = 'HOLD', updated_at = ${sqlNow()} WHERE lot_id = ? AND status = 'ACTIVE'`, lotId);
    } else if (status === 'PASSED' && (lot.qc_status === 'HOLD' || lot.qc_status === 'FAILED')) {
      await createInventoryTransaction({
        transactionType: 'QC_RELEASE',
        productId: lot.product_id,
        lotId,
        quantity: 0,
        performedBy: req.user!.id,
        notes: notes || 'QC Hold released',
      });
      await queryRun(`UPDATE pallets SET status = 'ACTIVE', updated_at = ${sqlNow()} WHERE lot_id = ? AND status = 'HOLD'`, lotId);
    }

    return Number(result.lastInsertRowid);
  });
  await createAuditLog({
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
