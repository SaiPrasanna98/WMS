import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { queryAll } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('notifications.read'), async (req: Request, res: Response) => {
  const { customerId, orderId } = req.query;
  let query = `
    SELECT n.*, c.name as customer_name
    FROM customer_notifications n
    JOIN customers c ON c.id = n.customer_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (customerId) {
    query += ' AND n.customer_id = ?';
    params.push(Number(customerId));
  }
  if (orderId) {
    query += ' AND n.order_id = ?';
    params.push(Number(orderId));
  }
  query += ' ORDER BY n.created_at DESC LIMIT 200';

  res.json(await queryAll(query, ...params));
});

export default router;
