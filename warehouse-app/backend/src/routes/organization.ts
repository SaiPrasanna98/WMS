import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import { getOrganizationSettings, saveOrganizationSettings } from '../services/organization';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('users.read'), (_req: Request, res: Response) => {
  res.json(getOrganizationSettings());
});

router.put('/', requirePermission('users.write'), blockViewerWrite, (req: Request, res: Response) => {
  try {
    const before = getOrganizationSettings();
    const updated = saveOrganizationSettings({
      orgName: req.body.orgName,
      allowedDomains: req.body.allowedDomains,
      inviteExpiryDays: req.body.inviteExpiryDays,
    });
    createAuditLog({
      userId: req.user!.id,
      action: 'UPDATE',
      entityType: 'organization',
      entityId: 1,
      oldValue: before,
      newValue: updated,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
