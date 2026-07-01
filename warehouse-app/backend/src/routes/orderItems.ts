import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('orders.read'), (req: Request, res: Response) => {
  const { orderId } = req.query;
  let query = `
    SELECT oi.*, p.sku, p.name as product_name, o.order_number
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE 1=1
  `;
  const params: unknown[] = [];
  if (orderId) { query += ' AND oi.order_id = ?'; params.push(orderId); }
  query += ' ORDER BY oi.id';
  res.json(db.prepare(query).all(...params));
});

export default router;
