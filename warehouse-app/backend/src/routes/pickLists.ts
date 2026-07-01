import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { queryOne, queryAll } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
  const { orderId, status } = req.query;
  let query = `
    SELECT pl.*, o.order_number, o.status as order_status, c.name as customer_name
    FROM pick_lists pl
    JOIN orders o ON o.id = pl.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE 1=1
  `;
  const params: string[] = [];
  if (orderId) { query += ' AND pl.order_id = ?'; params.push(orderId as string); }
  if (status) { query += ' AND pl.status = ?'; params.push(status as string); }
  query += ' ORDER BY pl.created_at DESC';
  res.json(await queryAll(query, ...params));
});

router.get('/:id', requirePermission('fulfillment.read'), async (req: Request, res: Response) => {
  const pickList = await queryOne(`
    SELECT pl.*, o.order_number, o.status as order_status
    FROM pick_lists pl JOIN orders o ON o.id = pl.order_id WHERE pl.id = ?
  `, req.params.id);
  if (!pickList) { res.status(404).json({ error: 'Pick list not found' }); return; }

  const items = await queryAll(`
    SELECT pli.*, p.sku, p.name as product_name, pl.pallet_id as pallet_code,
           l.lot_number, wl.code as location_code, wl.zone, wl.aisle, wl.rack, wl.shelf
    FROM pick_list_items pli
    JOIN products p ON p.id = pli.product_id
    JOIN pallets pl ON pl.id = pli.pallet_id
    JOIN lots l ON l.id = pli.lot_id
    LEFT JOIN warehouse_locations wl ON wl.id = pli.location_id
    WHERE pli.pick_list_id = ?
    ORDER BY wl.code
  `, req.params.id);

  res.json({ ...pickList, items });
});

export default router;
