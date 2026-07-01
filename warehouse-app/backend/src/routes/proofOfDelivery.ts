import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { completeDelivery } from '../services/fulfillment';
import { queryOne } from '../db/query';

const router = Router();
router.use(authenticate);

router.post('/', requirePermission('deliveries.proof'), blockViewerWrite, async (req: Request, res: Response) => {
  const { deliveryId, recipientName, signatureData, photoData, notes } = req.body;
  if (!deliveryId || !recipientName) {
    res.status(400).json({ error: 'Delivery ID and recipient name are required' });
    return;
  }

  const existing = await queryOne('SELECT id FROM delivery_proofs WHERE delivery_id = ?', deliveryId);
  if (existing) { res.status(400).json({ error: 'Proof of delivery already submitted' }); return; }

  try {
    await completeDelivery(Number(deliveryId), req.user!.id, {
      recipientName,
      signatureData,
      photoData,
      notes,
    });
    res.status(201).json({ message: 'Proof of delivery recorded. Order marked as delivered.' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/:deliveryId', requirePermission('deliveries.read'), async (req: Request, res: Response) => {
  const proof = await queryOne('SELECT * FROM delivery_proofs WHERE delivery_id = ?', req.params.deliveryId);
  if (!proof) { res.status(404).json({ error: 'Proof not found' }); return; }
  res.json(proof);
});

export default router;
