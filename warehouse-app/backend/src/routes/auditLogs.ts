import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('audit.read'), (req: Request, res: Response) => {
  const { action, entityType, search } = req.query;
  let query = `
    SELECT al.*, u.full_name as user_name, u.email as user_email
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE 1=1
  `;
  const params: string[] = [];

  if (action) {
    query += ' AND al.action = ?';
    params.push(action as string);
  }
  if (entityType) {
    query += ' AND al.entity_type = ?';
    params.push(entityType as string);
  }
  if (search) {
    query += ' AND (u.full_name LIKE ? OR al.entity_type LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY al.created_at DESC LIMIT 500';

  res.json(db.prepare(query).all(...params));
});

router.get('/entity-types', requirePermission('audit.read'), (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type
  `).all() as Array<{ entity_type: string }>;
  res.json(rows.map(r => r.entity_type));
});

export default router;
