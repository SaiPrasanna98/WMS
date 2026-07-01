import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction, generateId } from '../services/inventory';
import { assertPositiveQuantity } from '../services/validation';
import { applyPoLineReceipt } from '../services/purchaseOrders';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('receiving.read'), (_req: Request, res: Response) => {
  const records = db.prepare(`
    SELECT rr.*, p.sku, p.name as product_name, pl.pallet_id as pallet_code,
           l.lot_number, wl.code as location_code, u.full_name as received_by_name,
           po.po_number
    FROM receiving_records rr
    JOIN products p ON p.id = rr.product_id
    JOIN pallets pl ON pl.id = rr.pallet_id
    JOIN lots l ON l.id = rr.lot_id
    LEFT JOIN warehouse_locations wl ON wl.id = rr.location_id
    JOIN users u ON u.id = rr.received_by
    LEFT JOIN purchase_orders po ON po.id = rr.purchase_order_id
    ORDER BY rr.received_at DESC
  `).all();
  res.json(records);
});

router.get('/purchase-orders', requirePermission('receiving.read'), (_req: Request, res: Response) => {
  const orders = db.prepare(`
    SELECT po.*,
      (SELECT COUNT(*) FROM purchase_order_items WHERE purchase_order_id = po.id) as line_count
    FROM purchase_orders po
    WHERE po.status IN ('OPEN', 'PARTIAL')
    ORDER BY po.created_at DESC
  `).all();
  res.json(orders);
});

router.get('/purchase-orders/:id/lines', requirePermission('receiving.read'), (req: Request, res: Response) => {
  const lines = db.prepare(`
    SELECT poi.*, p.sku, p.name as product_name,
           (poi.quantity_ordered - poi.quantity_received) as quantity_remaining
    FROM purchase_order_items poi
    JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = ?
    ORDER BY poi.id
  `).all(req.params.id);
  res.json(lines);
});

router.post('/', requirePermission('receiving.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { purchaseOrderId, purchaseOrderLineId, productId, quantity, locationId, lotNumber, palletCode, notes } = req.body;

  if (!productId || !quantity || !locationId) {
    res.status(400).json({ error: 'Product ID, quantity, and location are required' });
    return;
  }

  try {
    const qty = assertPositiveQuantity(quantity);

    const location = db.prepare('SELECT id FROM warehouse_locations WHERE id = ? AND is_active = 1').get(locationId);
    if (!location) { res.status(404).json({ error: 'Location not found or inactive' }); return; }

    const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(productId);
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }

    const finalLotNumber = lotNumber || generateId('LOT');
    const finalPalletCode = palletCode || generateId('PLT');

    const receiveTransaction = db.transaction(() => {
      const lotResult = db.prepare(`
        INSERT INTO lots (lot_number, product_id, quantity, qc_status, received_date)
        VALUES (?, ?, ?, 'PENDING', date('now'))
      `).run(finalLotNumber, productId, qty);
      const lotId = Number(lotResult.lastInsertRowid);

      const palletResult = db.prepare(`
        INSERT INTO pallets (pallet_id, lot_id, product_id, quantity, location_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(finalPalletCode, lotId, productId, qty, locationId);
      const palletId = Number(palletResult.lastInsertRowid);

      const recordResult = db.prepare(`
        INSERT INTO receiving_records (purchase_order_id, lot_id, pallet_id, product_id, quantity_received, received_by, location_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(purchaseOrderId || null, lotId, palletId, productId, qty, req.user!.id, locationId, notes || null);

      createInventoryTransaction({
        transactionType: 'RECEIVE',
        productId,
        lotId,
        palletId,
        toLocationId: locationId,
        quantity: qty,
        referenceType: 'receiving_record',
        referenceId: Number(recordResult.lastInsertRowid),
        performedBy: req.user!.id,
        notes: notes || `Received ${qty} units`,
      });

      if (purchaseOrderId) {
        applyPoLineReceipt(Number(purchaseOrderId), productId, qty, purchaseOrderLineId ? Number(purchaseOrderLineId) : undefined);
      }

      return { lotId, palletId, recordId: Number(recordResult.lastInsertRowid), lotNumber: finalLotNumber, palletCode: finalPalletCode };
    });

    const result = receiveTransaction();
    createAuditLog({
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'receiving_record',
      entityId: result.recordId,
      newValue: { productId, quantity: qty, lotNumber: result.lotNumber, palletCode: result.palletCode },
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
