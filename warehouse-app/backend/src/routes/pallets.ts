import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction, ensureNonNegativeInventory } from '../services/inventory';
import { assertPositiveQuantity } from '../services/validation';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('pallets.read'), async (req: Request, res: Response) => {
  const { search, status } = req.query;
  let query = `
    SELECT pl.*, p.sku, p.name as product_name, l.lot_number, l.qc_status,
           wl.code as location_code, wl.zone, wl.aisle, wl.rack, wl.shelf
    FROM pallets pl
    JOIN products p ON p.id = pl.product_id
    JOIN lots l ON l.id = pl.lot_id
    LEFT JOIN warehouse_locations wl ON wl.id = pl.location_id
    WHERE 1=1
  `;
  const params: string[] = [];

  if (search) {
    query += ' AND (pl.pallet_id LIKE ? OR p.sku LIKE ? OR l.lot_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) {
    query += ' AND pl.status = ?';
    params.push(status as string);
  }
  if (req.query.productId) {
    query += ' AND pl.product_id = ?';
    params.push(String(req.query.productId));
  }
  query += ' ORDER BY pl.created_at DESC';

  res.json(await queryAll(query, ...params));
});

router.get('/:id', requirePermission('pallets.read'), async (req: Request, res: Response) => {
  const pallet = await queryOne(`
    SELECT pl.*, p.sku, p.name as product_name, l.lot_number, l.qc_status,
           wl.code as location_code
    FROM pallets pl
    JOIN products p ON p.id = pl.product_id
    JOIN lots l ON l.id = pl.lot_id
    LEFT JOIN warehouse_locations wl ON wl.id = pl.location_id
    WHERE pl.id = ?
  `, req.params.id);
  if (!pallet) { res.status(404).json({ error: 'Pallet not found' }); return; }
  res.json(pallet);
});

router.post('/', requirePermission('pallets.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { palletId, lotId, productId, quantity, locationId } = req.body;
  if (!palletId || !lotId || !productId || quantity === undefined) {
    res.status(400).json({ error: 'Pallet ID, lot ID, product ID, and quantity are required' });
    return;
  }

  try {
    const qty = assertPositiveQuantity(quantity);

    const lot = await queryOne('SELECT product_id FROM lots WHERE id = ?', lotId) as { product_id: number } | undefined;
    if (!lot) { res.status(404).json({ error: 'Lot not found' }); return; }
    if (lot.product_id !== productId) {
      res.status(400).json({ error: 'Product ID does not match lot product' });
      return;
    }

    const result = await queryRun(`
      INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id)
      VALUES (?, ?, ?, ?, ?)
    `, palletId, lotId, productId, qty, locationId || null);

    const id = Number(result.lastInsertRowid);
    await createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'pallet', entityId: id, newValue: { palletId, lotId, productId, quantity: qty } });
    res.status(201).json({ id, palletId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/move', requirePermission('pallets.move', 'pallets.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { toLocationId, notes } = req.body;
  const palletId = Number(req.params.id);

  if (!toLocationId) {
    res.status(400).json({ error: 'Destination location is required' });
    return;
  }

  const pallet = await queryOne(`
    SELECT pl.*, l.qc_status FROM pallets pl
    JOIN lots l ON l.id = pl.lot_id WHERE pl.id = ?
  `, palletId) as {
    id: number; product_id: number; lot_id: number; quantity: number; location_id: number; status: string; qc_status: string;
  } | undefined;

  if (!pallet) { res.status(404).json({ error: 'Pallet not found' }); return; }

  const isEmpty = pallet.quantity === 0 || pallet.status === 'DEPLETED';

  if (!isEmpty) {
    if (pallet.status !== 'ACTIVE') {
      res.status(400).json({ error: 'Cannot move pallet with this status' });
      return;
    }
    if (pallet.qc_status === 'FAILED') {
      res.status(400).json({ error: 'Cannot move pallet with failed QC lot' });
      return;
    }
  }

  const location = await queryOne('SELECT id FROM warehouse_locations WHERE id = ? AND is_active = 1', toLocationId);
  if (!location) { res.status(404).json({ error: 'Destination location not found or inactive' }); return; }

  if (pallet.location_id === toLocationId) {
    res.status(400).json({ error: 'Pallet is already at this location' });
    return;
  }

  const fromLocationId = pallet.location_id;

  await queryRun(`
    UPDATE pallets SET location_id = ?, updated_at = ${sqlNow()} WHERE id = ?
  `, toLocationId, palletId);

  await createInventoryTransaction({
    transactionType: 'MOVE',
    productId: pallet.product_id,
    lotId: pallet.lot_id,
    palletId: pallet.id,
    fromLocationId: fromLocationId || undefined,
    toLocationId,
    quantity: pallet.quantity,
    performedBy: req.user!.id,
    notes: notes || (isEmpty ? 'Relocated empty pallet' : `Moved pallet to location ${toLocationId}`),
  });

  await createAuditLog({
    userId: req.user!.id,
    action: 'STATUS_CHANGE',
    entityType: 'pallet',
    entityId: palletId,
    oldValue: { locationId: fromLocationId },
    newValue: { locationId: toLocationId },
  });

  res.json({ message: 'Pallet moved successfully' });
});

router.post('/:id/mark-depleted', requirePermission('pallets.write', 'pallets.move'), blockViewerWrite, async (req: Request, res: Response) => {
  const palletId = Number(req.params.id);
  const pallet = await queryOne('SELECT * FROM pallets WHERE id = ?', palletId) as {
    id: number; quantity: number; status: string; product_id: number; lot_id: number; location_id: number | null;
  } | undefined;

  if (!pallet) { res.status(404).json({ error: 'Pallet not found' }); return; }
  if (pallet.status === 'DEPLETED') {
    res.status(400).json({ error: 'Pallet is already marked as depleted' });
    return;
  }
  if (pallet.quantity > 0) {
    res.status(400).json({ error: 'Pallet still has stock. Consume or ship remaining quantity first.' });
    return;
  }

  await queryRun(`
    UPDATE pallets SET status = 'DEPLETED', updated_at = ${sqlNow()} WHERE id = ?
  `, palletId);

  await createAuditLog({
    userId: req.user!.id,
    action: 'STATUS_CHANGE',
    entityType: 'pallet',
    entityId: palletId,
    oldValue: { status: pallet.status },
    newValue: { status: 'DEPLETED' },
  });

  res.json({ message: 'Pallet marked as depleted. You can now relocate it to free up the shelf.' });
});

router.put('/:id', requirePermission('pallets.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { quantity, locationId, status } = req.body;
  const id = Number(req.params.id);
  const existing = await queryOne('SELECT * FROM pallets WHERE id = ?', id) as { product_id: number; quantity: number } | undefined;
  if (!existing) { res.status(404).json({ error: 'Pallet not found' }); return; }

  if (quantity !== undefined) {
    const newQty = Number(quantity);
    if (!Number.isFinite(newQty) || newQty < 0) {
      res.status(400).json({ error: 'Quantity must be zero or positive' });
      return;
    }
    if (newQty > existing.quantity) {
      res.status(400).json({ error: 'Direct quantity increases are not allowed; use receiving or adjustment workflow' });
      return;
    }
    if (newQty < existing.quantity) {
      await ensureNonNegativeInventory(existing.product_id, newQty - existing.quantity);
    }
  }

  await queryRun(`
    UPDATE pallets SET
      quantity = COALESCE(?, quantity),
      location_id = COALESCE(?, location_id),
      status = COALESCE(?, status),
      updated_at = ${sqlNow()}
    WHERE id = ?
  `, quantity, locationId, status, id);

  await createAuditLog({
    userId: req.user!.id,
    action: 'UPDATE',
    entityType: 'pallet',
    entityId: id,
    oldValue: { quantity: existing.quantity },
    newValue: { quantity, locationId, status },
  });
  res.json({ message: 'Pallet updated' });
});

export default router;
