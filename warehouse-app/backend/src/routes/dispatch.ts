import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { getDispatchBoard } from '../services/dispatch';

const router = Router();
router.use(authenticate);

router.get('/board', requirePermission('drivers.read'), async (_req: Request, res: Response) => {
  res.json(await getDispatchBoard());
});

export default router;
