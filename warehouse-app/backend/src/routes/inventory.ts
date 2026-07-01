import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction, ensureNonNegativeInventory, getProductInventory } from '../services/inventory';
import { getAtpQuantity, getReservedQuantity } from '../services/fulfillment';
import { assertPositiveQuantity } from '../services/validation';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('inventory.read'), async (req: Request, res: Response) => {
  const { search, type, stock } = req.query;

  let query = 'SELECT * FROM products WHERE is_active = 1';
  const params: string[] = [];

  if (search) {
    query += ' AND (sku LIKE ? OR name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (type) {
    query += ' AND product_type = ?';
    params.push(type as string);
  }
  query += ' ORDER BY name';

  const products = await queryAll(query, ...params) as {
    id: number;
    sku: string;
    name: string;
    product_type: string;
    unit_of_measure: string;
    reorder_level: number;
  }[];

  let items = await Promise.all(products.map(async (p) => {
    const onHand = await getProductInventory(p.id);
    const reserved = await getReservedQuantity(p.id);
    const atp = await getAtpQuantity(p.id);
    const palletCount = await queryOne(`
      SELECT COUNT(*) as count FROM pallets WHERE product_id = ? AND status = 'ACTIVE' AND quantity > 0
    `, p.id) as { count: number };

    let stockStatus: 'OK' | 'LOW' | 'OUT' = 'OK';
    if (onHand <= 0) stockStatus = 'OUT';
    else if (onHand <= p.reorder_level) stockStatus = 'LOW';

    return {
      productId: p.id,
      code: p.sku,
      name: p.name,
      type: p.product_type,
      unit: p.unit_of_measure,
      onHand,
      reserved,
      atp,
      reorderLevel: p.reorder_level,
      palletCount: palletCount.count,
      stockStatus,
    };
  }));

  if (stock === 'low') items = items.filter(i => i.stockStatus === 'LOW');
  if (stock === 'out') items = items.filter(i => i.stockStatus === 'OUT');

  const summary = {
    totalProducts: items.length,
    totalOnHand: items.reduce((s, i) => s + i.onHand, 0),
    lowStock: items.filter(i => i.stockStatus === 'LOW').length,
    outOfStock: items.filter(i => i.stockStatus === 'OUT').length,
  };

  res.json({ summary, items });
});

router.post('/adjust', requirePermission('inventory.adjust'), blockViewerWrite, async (req: Request, res: Response) => {
  const { palletId, newQuantity, reason } = req.body;
  if (!palletId || newQuantity === undefined) {
    res.status(400).json({ error: 'Pallet ID and new quantity are required' });
    return;
  }

  const qty = Number(newQuantity);
  if (!Number.isFinite(qty) || qty < 0) {
    res.status(400).json({ error: 'Quantity must be zero or positive' });
    return;
  }

  const pallet = await queryOne(`
    SELECT pl.*, l.qc_status FROM pallets pl
    JOIN lots l ON l.id = pl.lot_id WHERE pl.id = ?
  `, Number(palletId)) as {
    id: number; product_id: number; lot_id: number; quantity: number; location_id: number | null; status: string;
  } | undefined;

  if (!pallet) { res.status(404).json({ error: 'Pallet not found' }); return; }
  if (pallet.status === 'HOLD') {
    res.status(400).json({ error: 'Cannot adjust pallet on hold' });
    return;
  }

  const delta = qty - pallet.quantity;
  if (delta < 0) {
    await ensureNonNegativeInventory(pallet.product_id, delta);
  }

  const newStatus = qty === 0 ? 'DEPLETED' : (pallet.status === 'DEPLETED' && qty > 0 ? 'ACTIVE' : pallet.status);

  await queryRun(`
    UPDATE pallets SET quantity = ?, status = ?, updated_at = ${sqlNow()} WHERE id = ?
  `, qty, newStatus, pallet.id);

  await createInventoryTransaction({
    transactionType: 'ADJUST',
    productId: pallet.product_id,
    lotId: pallet.lot_id,
    palletId: pallet.id,
    fromLocationId: pallet.location_id ?? undefined,
    quantity: Math.abs(delta),
    performedBy: req.user!.id,
    notes: reason || `Cycle count adjustment: ${pallet.quantity} → ${qty}`,
  });

  await createAuditLog({
    userId: req.user!.id,
    action: 'UPDATE',
    entityType: 'pallet',
    entityId: pallet.id,
    oldValue: { quantity: pallet.quantity, status: pallet.status },
    newValue: { quantity: qty, status: newStatus, reason },
  });

  res.json({ message: 'Inventory adjusted', quantity: qty, status: newStatus });
});

export default router;
