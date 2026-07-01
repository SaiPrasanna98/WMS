import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createPackage } from '../services/fulfillment';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
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
  res.json(await queryAll(query, ...params));
});

router.get('/:id', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
  const pkg = await queryOne(`
    SELECT pkg.*, o.order_number FROM packages pkg JOIN orders o ON o.id = pkg.order_id WHERE pkg.id = ?
  `, req.params.id);
  if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
  const items = await queryAll(`
    SELECT pi.*, p.sku, p.name as product_name FROM package_items pi
    JOIN products p ON p.id = pi.product_id WHERE pi.package_id = ?
  `, req.params.id);
  res.json({ ...pkg, items });
});

router.post('/', requirePermission('fulfillment.pack'), blockViewerWrite, async (req: Request, res: Response) => {
  const { orderId, items } = req.body;
  if (!orderId || !items?.length) {
    res.status(400).json({ error: 'Order ID and items are required' });
    return;
  }

  const pickList = await queryOne(`
    SELECT id, status FROM pick_lists WHERE order_id = ? ORDER BY id DESC LIMIT 1
  `, orderId) as { id: number; status: string } | undefined;

  if (pickList) {
    const pending = await queryOne(`
      SELECT COUNT(*) as c FROM pick_list_items WHERE pick_list_id = ? AND status = 'PENDING'
    `, pickList.id) as { c: number };

    if (pending.c > 0) {
      const next = await queryOne(`
        SELECT pl.pallet_id FROM pick_list_items pli
        JOIN pallets pl ON pl.id = pli.pallet_id
        WHERE pli.pick_list_id = ? AND pli.status = 'PENDING' LIMIT 1
      `, pickList.id) as { pallet_id: string } | undefined;
      res.status(400).json({
        error: `Picking not finished. Scan pallet ${next?.pallet_id ?? 'from pick list'} exactly (including leading zeros), then confirm pick.`,
      });
      return;
    }

    if (pickList.status !== 'COMPLETED') {
      await queryRun(`UPDATE pick_lists SET status = 'COMPLETED', updated_at = ${sqlNow()} WHERE id = ?`, pickList.id);
      await queryRun(`UPDATE orders SET status = 'PACKING', updated_at = ${sqlNow()} WHERE id = ? AND status = 'PICKING'`, orderId);
    }
  }

  try {
    const result = await createPackage(Number(orderId), req.user!.id, items.map((i: { orderItemId: number; quantity: number }) => ({
      orderItemId: i.orderItemId,
      quantity: i.quantity,
    })));
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/scan/:barcode', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
  const pkg = await queryOne(`
    SELECT pkg.*, o.order_number, o.status as order_status
    FROM packages pkg JOIN orders o ON o.id = pkg.order_id
    WHERE pkg.package_barcode = ?
  `, req.params.barcode);
  if (!pkg) { res.status(404).json({ error: 'Package not found' }); return; }
  res.json(pkg);
});

export default router;
