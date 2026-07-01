import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { queryAll } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('inventory.read'), async (req: Request, res: Response) => {
  const { type, productId, search } = req.query;
  let query = `
    SELECT it.*, p.sku, p.name as product_name,
           l.lot_number, pl.pallet_id as pallet_code,
           fl.code as from_location, tl.code as to_location,
           u.full_name as performed_by_name
    FROM inventory_transactions it
    JOIN products p ON p.id = it.product_id
    LEFT JOIN lots l ON l.id = it.lot_id
    LEFT JOIN pallets pl ON pl.id = it.pallet_id
    LEFT JOIN warehouse_locations fl ON fl.id = it.from_location_id
    LEFT JOIN warehouse_locations tl ON tl.id = it.to_location_id
    JOIN users u ON u.id = it.performed_by
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (type) {
    query += ' AND it.transaction_type = ?';
    params.push(type as string);
  }
  if (productId) {
    query += ' AND it.product_id = ?';
    params.push(Number(productId));
  }
  if (search) {
    query += ' AND (p.sku LIKE ? OR l.lot_number LIKE ? OR pl.pallet_id LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY it.created_at DESC LIMIT 500';

  res.json(await queryAll(query, ...params));
});

export default router;
