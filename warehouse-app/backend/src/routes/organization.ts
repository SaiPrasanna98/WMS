import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import { getOrganizationSettings, saveOrganizationSettings } from '../services/organization';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('users.read'), async (_req: Request, res: Response) => {
  res.json(await getOrganizationSettings());
});

router.put('/', requirePermission('users.write'), blockViewerWrite, async (req: Request, res: Response) => {
  try {
    const before = await getOrganizationSettings();
    const updated = await saveOrganizationSettings({
      orgName: req.body.orgName,
      allowedDomains: req.body.allowedDomains,
      inviteExpiryDays: req.body.inviteExpiryDays,
    });
    await createAuditLog({
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
