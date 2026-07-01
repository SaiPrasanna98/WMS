import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import {
  enrichPurchaseOrder,
  generatePoNumber,
  recalculatePoStatus,
} from '../services/purchaseOrders';
import { queryOne, queryAll, queryRun, transaction, sqlNow } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('purchase_orders.read'), async (req: Request, res: Response) => {
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

  const rows = await queryAll(query, ...params) as Record<string, unknown>[];
  res.json(await Promise.all(rows.map((row) => enrichPurchaseOrder(row))));
});

router.get('/:id', requirePermission('purchase_orders.read'), async (req: Request, res: Response) => {
  const po = await queryOne('SELECT * FROM purchase_orders WHERE id = ?', req.params.id) as
    Record<string, unknown> | undefined;
  if (!po) {
    res.status(404).json({ error: 'Purchase order not found' });
    return;
  }
  res.json(await enrichPurchaseOrder(po));
});

router.post('/', requirePermission('purchase_orders.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { supplierName, expectedDate, notes, items } = req.body;
  if (!supplierName || !items?.length) {
    res.status(400).json({ error: 'Supplier and line items are required' });
    return;
  }

  try {
    const created = await transaction(async () => {
      const poNumber = await generatePoNumber();
      const result = await queryRun(`
        INSERT INTO purchase_orders (po_number, supplier_name, status, expected_date, notes, created_by)
        VALUES (?, ?, 'OPEN', ?, ?, ?)
      `, poNumber, supplierName, expectedDate ?? null, notes ?? null, req.user!.id);
      const poId = Number(result.lastInsertRowid);


      for (const item of items) {
        if (!item.productId || !item.quantity) {
          throw new Error('Each line needs productId and quantity');
        }
        await queryRun(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, unit_cost)
          VALUES (?, ?, ?, ?)
        `, poId, item.productId, item.quantity, item.unitCost ?? 0);
      }

      return { poId, poNumber };
    });

    await createAuditLog({
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'purchase_order',
      entityId: created.poId,
      newValue: { poNumber: created.poNumber, supplierName },
    });

    const po = await queryOne('SELECT * FROM purchase_orders WHERE id = ?', created.poId) as Record<string, unknown>;
    res.status(201).json(await enrichPurchaseOrder(po));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.put('/:id', requirePermission('purchase_orders.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const poId = Number(req.params.id);
  const po = await queryOne('SELECT * FROM purchase_orders WHERE id = ?', poId) as
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
    await transaction(async () => {
      await queryRun(`
        UPDATE purchase_orders SET
          supplier_name = COALESCE(?, supplier_name),
          expected_date = COALESCE(?, expected_date),
          notes = COALESCE(?, notes),
          updated_at = ${sqlNow()}
        WHERE id = ?
      `, supplierName ?? null, expectedDate ?? null, notes ?? null, poId);

      if (items) {
        const received = await queryOne(`
          SELECT COUNT(*) as c FROM purchase_order_items WHERE purchase_order_id = ? AND quantity_received > 0
        `, poId) as { c: number };
        if (received.c > 0) throw new Error('Cannot replace lines after receiving has started');

        await queryRun('DELETE FROM purchase_order_items WHERE purchase_order_id = ?', poId);

        for (const item of items) {
          await queryRun(`
          INSERT INTO purchase_order_items (purchase_order_id, product_id, quantity_ordered, unit_cost)
          VALUES (?, ?, ?, ?)
        `, poId, item.productId, item.quantity, item.unitCost ?? 0);
        }
      }
    });

    await createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'purchase_order', entityId: poId });
    const updated = await queryOne('SELECT * FROM purchase_orders WHERE id = ?', poId) as Record<string, unknown>;
    res.json(await enrichPurchaseOrder(updated));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/:id/cancel', requirePermission('purchase_orders.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const poId = Number(req.params.id);
  const po = await queryOne('SELECT status FROM purchase_orders WHERE id = ?', poId) as
    { status: string } | undefined;
  if (!po) {
    res.status(404).json({ error: 'Purchase order not found' });
    return;
  }
  if (po.status === 'RECEIVED') {
    res.status(400).json({ error: 'Received purchase orders cannot be cancelled' });
    return;
  }

  await queryRun(`UPDATE purchase_orders SET status = 'CANCELLED', updated_at = ${sqlNow()} WHERE id = ?`, poId);
  await createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'purchase_order', entityId: poId, newValue: { status: 'CANCELLED' } });
  res.json({ message: 'Purchase order cancelled' });
});

export default router;
