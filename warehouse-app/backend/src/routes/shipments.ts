import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, createInventoryTransaction, ensureNonNegativeInventory, generateId } from '../services/inventory';
import { assertPositiveQuantity, assertValidTransition, SHIPMENT_TRANSITIONS } from '../services/validation';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('shipping.read'), (req: Request, res: Response) => {
  const { status, search } = req.query;
  let query = `
    SELECT s.*, u.full_name as created_by_name,
           (SELECT COUNT(*) FROM shipment_items si WHERE si.shipment_id = s.id) as item_count
    FROM shipments s JOIN users u ON u.id = s.created_by WHERE 1=1
  `;
  const params: string[] = [];

  if (status) {
    query += ' AND s.status = ?';
    params.push(status as string);
  }
  if (search) {
    query += ' AND (s.shipment_number LIKE ? OR s.customer_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY s.created_at DESC';

  res.json(db.prepare(query).all(...params));
});

router.get('/:id', requirePermission('shipping.read'), (req: Request, res: Response) => {
  const shipment = db.prepare(`
    SELECT s.*, u.full_name as created_by_name FROM shipments s
    JOIN users u ON u.id = s.created_by WHERE s.id = ?
  `).get(req.params.id);
  if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

  const items = db.prepare(`
    SELECT si.*, p.sku, p.name as product_name, l.lot_number, l.qc_status, pl.pallet_id as pallet_code
    FROM shipment_items si
    JOIN products p ON p.id = si.product_id
    JOIN lots l ON l.id = si.lot_id
    LEFT JOIN pallets pl ON pl.id = si.pallet_id
    WHERE si.shipment_id = ?
  `).all(req.params.id);

  res.json({ ...shipment, items });
});

function validateShipmentItem(item: { productId: number; lotId: number; palletId?: number; quantity: number }): void {
  const qty = assertPositiveQuantity(item.quantity, 'item quantity');

  const lot = db.prepare(`
    SELECT l.*, p.product_type, p.id as pid FROM lots l
    JOIN products p ON p.id = l.product_id WHERE l.id = ?
  `).get(item.lotId) as { product_id: number; qc_status: string; product_type: string; pid: number } | undefined;

  if (!lot) throw new Error(`Lot ${item.lotId} not found`);
  if (lot.product_id !== item.productId) throw new Error('Product ID does not match lot product');
  if (lot.qc_status === 'FAILED' || lot.qc_status === 'HOLD') {
    throw new Error(`Cannot ship lot with QC status ${lot.qc_status}`);
  }
  if (lot.product_type === 'FINISHED_GOOD' && lot.qc_status !== 'PASSED') {
    throw new Error('Only QC-passed finished goods can be shipped');
  }

  if (!item.palletId) {
    throw new Error('Pallet ID is required for each shipment item');
  }

  const pallet = db.prepare(`
    SELECT * FROM pallets WHERE id = ? AND lot_id = ? AND product_id = ? AND status = 'ACTIVE'
  `).get(item.palletId, item.lotId, item.productId) as { quantity: number } | undefined;

  if (!pallet) throw new Error('Pallet not found or not active for this lot/product');
  if (pallet.quantity < qty) throw new Error('Insufficient pallet quantity for shipment item');
}

router.post('/', requirePermission('shipping.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { customerName, notes, items } = req.body;
  if (!customerName) {
    res.status(400).json({ error: 'Customer name is required' });
    return;
  }
  if (!items?.length) {
    res.status(400).json({ error: 'At least one shipment item is required' });
    return;
  }

  const shipmentNumber = generateId('SHP');

  try {
    const createShipment = db.transaction(() => {
      for (const item of items) {
        validateShipmentItem(item);
      }

      const result = db.prepare(`
        INSERT INTO shipments (shipment_number, customer_name, created_by, notes)
        VALUES (?, ?, ?, ?)
      `).run(shipmentNumber, customerName, req.user!.id, notes || null);
      const shipmentId = Number(result.lastInsertRowid);

      const insertItem = db.prepare(`
        INSERT INTO shipment_items (shipment_id, product_id, lot_id, pallet_id, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        insertItem.run(shipmentId, item.productId, item.lotId, item.palletId, assertPositiveQuantity(item.quantity));
      }

      return shipmentId;
    });

    const shipmentId = createShipment();
    createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'shipment', entityId: shipmentId, newValue: { customerName, itemCount: items.length } });
    res.status(201).json({ id: shipmentId, shipmentNumber });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/:id/status', requirePermission('shipping.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { status, trackingNumber } = req.body;
  const id = Number(req.params.id);
  const validStatuses = ['DRAFT', 'PICKING', 'PACKED', 'SHIPPED'];

  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const shipment = db.prepare('SELECT * FROM shipments WHERE id = ?').get(id) as { status: string } | undefined;
  if (!shipment) { res.status(404).json({ error: 'Shipment not found' }); return; }

  if (shipment.status === status) {
    res.json({ message: 'Status unchanged' });
    return;
  }

  if (shipment.status === 'SHIPPED') {
    res.status(400).json({ error: 'Cannot change status of a shipped shipment' });
    return;
  }

  try {
    assertValidTransition(shipment.status, status, SHIPMENT_TRANSITIONS);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  if (status === 'SHIPPED') {
    const items = db.prepare(`
      SELECT si.*, l.qc_status, p.product_type
      FROM shipment_items si
      JOIN lots l ON l.id = si.lot_id
      JOIN products p ON p.id = si.product_id
      WHERE si.shipment_id = ?
    `).all(id) as { product_id: number; lot_id: number; pallet_id: number | null; quantity: number; qc_status: string; product_type: string }[];

    if (items.length === 0) {
      res.status(400).json({ error: 'Cannot ship empty shipment' });
      return;
    }

    for (const item of items) {
      if (!item.pallet_id) {
        res.status(400).json({ error: 'All shipment items must have a pallet assigned before shipping' });
        return;
      }
      if (item.product_type === 'FINISHED_GOOD' && item.qc_status !== 'PASSED') {
        res.status(400).json({ error: 'Cannot ship: lot has not passed QC' });
        return;
      }
      ensureNonNegativeInventory(item.product_id, -item.quantity);
    }

    try {
      const shipTransaction = db.transaction(() => {
        for (const item of items) {
          const pallet = db.prepare('SELECT * FROM pallets WHERE id = ? AND status = ?').get(item.pallet_id, 'ACTIVE') as {
            quantity: number; product_id: number; lot_id: number;
          } | undefined;

          if (!pallet) throw new Error(`Pallet ${item.pallet_id} is not available`);
          if (pallet.quantity < item.quantity) throw new Error(`Insufficient quantity on pallet ${item.pallet_id}`);

          const newQty = pallet.quantity - item.quantity;
          db.prepare(`UPDATE pallets SET quantity = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(newQty, newQty <= 0 ? 'DEPLETED' : 'ACTIVE', item.pallet_id);

          createInventoryTransaction({
            transactionType: 'SHIP',
            productId: item.product_id,
            lotId: item.lot_id,
            palletId: item.pallet_id,
            quantity: item.quantity,
            referenceType: 'shipment',
            referenceId: id,
            performedBy: req.user!.id,
            notes: `Shipped in shipment ${id}`,
          });
        }

        db.prepare(`
          UPDATE shipments SET status = 'SHIPPED', ship_date = date('now'),
          tracking_number = COALESCE(?, tracking_number), updated_at = datetime('now') WHERE id = ?
        `).run(trackingNumber || null, id);
      });

      shipTransaction();
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
  } else {
    db.prepare(`
      UPDATE shipments SET status = ?, tracking_number = COALESCE(?, tracking_number), updated_at = datetime('now') WHERE id = ?
    `).run(status, trackingNumber || null, id);
  }

  createAuditLog({
    userId: req.user!.id,
    action: 'STATUS_CHANGE',
    entityType: 'shipment',
    entityId: id,
    oldValue: { status: shipment.status },
    newValue: { status, trackingNumber },
  });
  res.json({ message: 'Shipment status updated' });
});

export default router;
