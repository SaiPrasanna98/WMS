import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import {
  enrichPurchaseOrder,
  generatePoNumber,
  recalculatePoStatus,
} from '../services/purchaseOrders';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('purchase_orders.read'), (req: Request, res: Response) => {
  const { status, search } = req.query;
  let query = `SELECT * FROM purchase_orders WHERE 1=1`;
  const params: string[] = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status as string);
  }
  if (search) {
    query += ' AND (po_number LIKE ? OR supplier_name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY created_at DESC';

  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  res.json(rows.map(enrichPurchaseOrder));
});

router.get('/:id', requirePermission('purchase_orders.read'), (req: Request, res: Response) => {
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(req.params.id) as
    Record<string, unknown> | undefined;
  if (!po) {
    res.status(404).json({ error: 'Purchase order not found' });
    return;
  }
  res.json(enrichPurchaseOrder(po));
});

router.post('/', requirePermission('purchase_orders.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { supplierName, expectedDate, notes, items } = req.body;
  if (!supplierName || !items?.length) {
    res.status(400).json({ error: 'Supplier and line items are required' });
    return;
  }

  try {
    const created = db.transaction(() => {
      const poNumber = generatePoNumber();
      const result = db.prepare(`
        INSERT INTO purchase_orders (po_number, supplier_name, status, expected_date, notes, created_by)
        VALUES (?, ?, 'OPEN', ?, ?, ?)
      `).run(poNumber, supplierName, expectedDate ?? null, notes ?? null, req.user!.id);
      const poId = Number(result.lastInsertRowid);

      const insertLine = db.prepare(`
        INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, unit_cost)
        VALUES (?, ?, ?, ?)
      `);
      for (const item of items) {
        if (!item.productId || !item.quantity) {
          throw new Error('Each line needs productId and quantity');
        }
        insertLine.run(poId, item.productId, item.quantity, item.unitCost ?? 0);
      }

      return { poId, poNumber };
    })();

    createAuditLog({
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'purchase_order',
      entityId: created.poId,
      newValue: { poNumber: created.poNumber, supplierName },
    });

    const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(created.poId) as Record<string, unknown>;
    res.status(201).json(enrichPurchaseOrder(po));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/:id', requirePermission('purchase_orders.write'), blockViewerWrite, (req: Request, res: Response) => {
  const poId = Number(req.params.id);
  const po = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as
    { status: string } | undefined;
  if (!po) {
    res.status(404).json({ error: 'Purchase order not found' });
    return;
  }
  if (!['OPEN', 'PARTIAL'].includes(po.status)) {
    res.status(400).json({ error: 'Only open purchase orders can be edited' });
    return;
  }

  const { supplierName, expectedDate, notes, items } = req.body;

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE purchase_orders SET
          supplier_name = COALESCE(?, supplier_name),
          expected_date = COALESCE(?, expected_date),
          notes = COALESCE(?, notes),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(supplierName ?? null, expectedDate ?? null, notes ?? null, poId);

      if (items) {
        const received = db.prepare(`
          SELECT COUNT(*) as c FROM purchase_order_items WHERE purchase_order_id = ? AND quantity_received > 0
        `).get(poId) as { c: number };
        if (received.c > 0) throw new Error('Cannot replace lines after receiving has started');

        db.prepare('DELETE FROM purchase_order_items WHERE purchase_order_id = ?').run(poId);
        const insertLine = db.prepare(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, unit_cost)
          VALUES (?, ?, ?, ?)
        `);
        for (const item of items) {
          insertLine.run(poId, item.productId, item.quantity, item.unitCost ?? 0);
        }
      }
    })();

    createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'purchase_order', entityId: poId });
    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as Record<string, unknown>;
    res.json(enrichPurchaseOrder(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/cancel', requirePermission('purchase_orders.write'), blockViewerWrite, (req: Request, res: Response) => {
  const poId = Number(req.params.id);
  const po = db.prepare('SELECT status FROM purchase_orders WHERE id = ?').get(poId) as
    { status: string } | undefined;
  if (!po) {
    res.status(404).json({ error: 'Purchase order not found' });
    return;
  }
  if (po.status === 'RECEIVED') {
    res.status(400).json({ error: 'Received purchase orders cannot be cancelled' });
    return;
  }

  db.prepare(`UPDATE purchase_orders SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`).run(poId);
  createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'purchase_order', entityId: poId, newValue: { status: 'CANCELLED' } });
  res.json({ message: 'Purchase order cancelled' });
});

export default router;
