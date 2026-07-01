import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createPackage } from '../services/fulfillment';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('fulfillment.read'), (req: Request, res: Response) => {
  const { orderId } = req.query;
  let query = `
    SELECT pkg.*, o.order_number, u.full_name as packed_by_name
    FROM packages pkg
    JOIN orders o ON o.id = pkg.order_id
    LEFT JOIN users u ON u.id = pkg.packed_by
    WHERE 1=1
  `;
  const params: string[] = [];
  if (orderId) { query += ' AND pkg.order_id = ?'; params.push(orderId as string); }
  query += ' ORDER BY pkg.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/:id', requirePermission('fulfillment.read'), (req: Request, res: Response) => {
  const pkg = db.prepare(`
    SELECT pkg.*, o.order_number FROM packages pkg JOIN orders o ON o.id = pkg.order_id WHERE pkg.id = ?
  `).get(req.params.id);
  if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
  const items = db.prepare(`
    SELECT pi.*, p.sku, p.name as product_name FROM package_items pi
    JOIN products p ON p.id = pi.product_id WHERE pi.package_id = ?
  `).all(req.params.id);
  res.json({ ...pkg, items });
});

router.post('/', requirePermission('fulfillment.pack'), blockViewerWrite, (req: Request, res: Response) => {
  const { orderId, items } = req.body;
  if (!orderId || !items?.length) {
    res.status(400).json({ error: 'Order ID and items are required' });
    return;
  }

  const pickList = db.prepare(`
    SELECT id, status FROM pick_lists WHERE order_id = ? ORDER BY id DESC LIMIT 1
  `).get(orderId) as { id: number; status: string } | undefined;

  if (pickList) {
    const pending = db.prepare(`
      SELECT COUNT(*) as c FROM pick_list_items WHERE pick_list_id = ? AND status = 'PENDING'
    `).get(pickList.id) as { c: number };

    if (pending.c > 0) {
      const next = db.prepare(`
        SELECT pl.pallet_id FROM pick_list_items pli
        JOIN pallets pl ON pl.id = pli.pallet_id
        WHERE pli.pick_list_id = ? AND pli.status = 'PENDING' LIMIT 1
      `).get(pickList.id) as { pallet_id: string } | undefined;
      res.status(400).json({
        error: `Picking not finished. Scan pallet ${next?.pallet_id ?? 'from pick list'} exactly (including leading zeros), then confirm pick.`,
      });
      return;
    }

    if (pickList.status !== 'COMPLETED') {
      db.prepare(`UPDATE pick_lists SET status = 'COMPLETED', updated_at = datetime('now') WHERE id = ?`).run(pickList.id);
      db.prepare(`UPDATE orders SET status = 'PACKING', updated_at = datetime('now') WHERE id = ? AND status = 'PICKING'`).run(orderId);
    }
  }

  try {
    const result = createPackage(Number(orderId), req.user!.id, items.map((i: { orderItemId: number; quantity: number }) => ({
      orderItemId: i.orderItemId,
      quantity: i.quantity,
    })));
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/scan/:barcode', requirePermission('fulfillment.read'), (req: Request, res: Response) => {
  const pkg = db.prepare(`
    SELECT pkg.*, o.order_number, o.status as order_status
    FROM packages pkg JOIN orders o ON o.id = pkg.order_id
    WHERE pkg.package_barcode = ?
  `).get(req.params.barcode);
  if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
  res.json(pkg);
});

export default router;
