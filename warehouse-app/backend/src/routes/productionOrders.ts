import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction, ensureNonNegativeInventory, generateId } from '../services/inventory';
import { assertPositiveQuantity, assertValidTransition, PRODUCTION_TRANSITIONS } from '../services/validation';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('production.read'), (req: Request, res: Response) => {
  const { status, search } = req.query;
  let query = `
    SELECT po.*, p.sku, p.name as product_name, u.full_name as created_by_name
    FROM production_orders po
    JOIN products p ON p.id = po.product_id
    JOIN users u ON u.id = po.created_by
    WHERE 1=1
  `;
  const params: string[] = [];

  if (status) {
    query += ' AND po.status = ?';
    params.push(status as string);
  }
  if (search) {
    query += ' AND (po.order_number LIKE ? OR p.sku LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY po.created_at DESC';

  res.json(db.prepare(query).all(...params));
});

router.get('/:id', requirePermission('production.read'), (req: Request, res: Response) => {
  const order = db.prepare(`
    SELECT po.*, p.sku, p.name as product_name
    FROM production_orders po JOIN products p ON p.id = po.product_id WHERE po.id = ?
  `).get(req.params.id);
  if (!order) { res.status(404).json({ error: 'Production order not found' }); return; }

  const materials = db.prepare(`
    SELECT pm.*, p.sku, p.name as product_name
    FROM production_materials pm JOIN products p ON p.id = pm.product_id
    WHERE pm.production_order_id = ?
  `).all(req.params.id);

  res.json({ ...order, materials });
});

router.post('/', requirePermission('production.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { productId, quantityPlanned, scheduledDate, notes, materials } = req.body;
  if (!productId || !quantityPlanned) {
    res.status(400).json({ error: 'Product ID and planned quantity are required' });
    return;
  }

  try {
    const qty = assertPositiveQuantity(quantityPlanned, 'quantity planned');
    const orderNumber = generateId('PRO');

    const createOrder = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO production_orders (order_number, product_id, quantity_planned, scheduled_date, created_by, notes)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(orderNumber, productId, qty, scheduledDate || null, req.user!.id, notes || null);
      const orderId = Number(result.lastInsertRowid);

      if (materials?.length) {
        const insertMat = db.prepare(`
          INSERT INTO production_materials (production_order_id, product_id, quantity_required)
          VALUES (?, ?, ?)
        `);
        for (const m of materials) {
          insertMat.run(orderId, m.productId, assertPositiveQuantity(m.quantityRequired, 'quantity required'));
        }
      }

      return orderId;
    });

    const orderId = createOrder();
    createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'production_order', entityId: orderId, newValue: { productId, quantityPlanned: qty } });
    res.status(201).json({ id: orderId, orderNumber });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/:id/status', requirePermission('production.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { status } = req.body;
  const id = Number(req.params.id);
  const validStatuses = ['CREATED', 'MATERIAL_REQUESTED', 'IN_PROGRESS', 'COMPLETED', 'QC_PENDING'];

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const existing = db.prepare('SELECT * FROM production_orders WHERE id = ?').get(id) as { status: string } | undefined;
  if (!existing) { res.status(404).json({ error: 'Production order not found' }); return; }

  if (existing.status === status) {
    res.json({ message: 'Status unchanged' });
    return;
  }

  try {
    assertValidTransition(existing.status, status, PRODUCTION_TRANSITIONS);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  if (status === 'COMPLETED' || status === 'QC_PENDING') {
    db.prepare(`UPDATE production_orders SET status = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(status, id);
  } else {
    db.prepare(`UPDATE production_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
  }

  if (status === 'MATERIAL_REQUESTED') {
    db.prepare(`UPDATE production_materials SET status = 'REQUESTED', updated_at = datetime('now') WHERE production_order_id = ?`).run(id);
  }

  createAuditLog({
    userId: req.user!.id,
    action: 'STATUS_CHANGE',
    entityType: 'production_order',
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status },
  });
  res.json({ message: 'Status updated' });
});

router.post('/:id/consume', requirePermission('production.consume'), blockViewerWrite, (req: Request, res: Response) => {
  const { materialId, palletId, quantity } = req.body;
  const orderId = Number(req.params.id);

  if (!materialId || !palletId || !quantity) {
    res.status(400).json({ error: 'Material ID, pallet ID, and quantity are required' });
    return;
  }

  try {
    const qty = assertPositiveQuantity(quantity);

    const material = db.prepare(`
      SELECT pm.*, p.sku FROM production_materials pm
      JOIN products p ON p.id = pm.product_id
      WHERE pm.id = ? AND pm.production_order_id = ?
    `).get(materialId, orderId) as { product_id: number; quantity_required: number; quantity_consumed: number } | undefined;

    if (!material) { res.status(404).json({ error: 'Material not found' }); return; }

    if (material.quantity_consumed + qty > material.quantity_required) {
      res.status(400).json({ error: 'Consumption would exceed required quantity' });
      return;
    }

    const pallet = db.prepare(`
      SELECT pl.*, l.qc_status FROM pallets pl
      JOIN lots l ON l.id = pl.lot_id
      WHERE pl.id = ? AND pl.status = 'ACTIVE'
    `).get(palletId) as { id: number; product_id: number; lot_id: number; quantity: number; location_id: number; qc_status: string } | undefined;

    if (!pallet) { res.status(404).json({ error: 'Pallet not found or not active' }); return; }
    if (pallet.product_id !== material.product_id) {
      res.status(400).json({ error: 'Pallet product does not match material' });
      return;
    }
    if (pallet.qc_status === 'FAILED' || pallet.qc_status === 'HOLD') {
      res.status(400).json({ error: 'Cannot consume from lot on QC hold or failed' });
      return;
    }
    if (pallet.quantity < qty) {
      res.status(400).json({ error: 'Insufficient pallet quantity' });
      return;
    }

    ensureNonNegativeInventory(material.product_id, -qty);

    const consumeTransaction = db.transaction(() => {
      const newConsumed = material.quantity_consumed + qty;
      const newStatus = newConsumed >= material.quantity_required ? 'CONSUMED' : 'ALLOCATED';

      db.prepare(`
        UPDATE production_materials SET quantity_consumed = ?, status = ?, pallet_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newConsumed, newStatus, palletId, materialId);

      const newQty = pallet.quantity - qty;
      db.prepare(`
        UPDATE pallets SET quantity = ?, status = ?, updated_at = datetime('now') WHERE id = ?
      `).run(newQty, newQty <= 0 ? 'DEPLETED' : 'ACTIVE', pallet.id);

      createInventoryTransaction({
        transactionType: 'CONSUME',
        productId: material.product_id,
        lotId: pallet.lot_id,
        palletId: pallet.id,
        fromLocationId: pallet.location_id,
        quantity: qty,
        referenceType: 'production_order',
        referenceId: orderId,
        performedBy: req.user!.id,
        notes: `Consumed for production order ${orderId}`,
      });
    });

    consumeTransaction();
    createAuditLog({
      userId: req.user!.id,
      action: 'UPDATE',
      entityType: 'production_material',
      entityId: materialId,
      newValue: { quantity: qty, orderId, palletId },
    });
    res.json({ message: 'Material consumed' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
