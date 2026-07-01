import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { enrichInvoice, markInvoicePaid, sendInvoice } from '../services/billing';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('invoices.read'), (req: Request, res: Response) => {
  const { status, search } = req.query;
  let query = `
    SELECT i.*, o.order_number, c.name as customer_name
    FROM invoices i
    JOIN orders o ON o.id = i.order_id
    JOIN customers c ON c.id = i.customer_id
    WHERE 1=1
  `;
  const params: string[] = [];
  if (status) { query += ' AND i.status = ?'; params.push(status as string); }
  if (search) {
    query += ' AND (i.invoice_number LIKE ? OR o.order_number LIKE ? OR c.name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY i.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

router.get('/order/:orderId', requirePermission('invoices.read'), (req: Request, res: Response) => {
  const invoice = db.prepare(`
    SELECT id FROM invoices WHERE order_id = ?
  `).get(req.params.orderId) as { id: number } | undefined;
  if (!invoice) { res.status(404).json({ error: 'No invoice for this order' }); return; }
  res.json(enrichInvoice(invoice.id));
});

router.get('/:id', requirePermission('invoices.read'), (req: Request, res: Response) => {
  const invoice = enrichInvoice(Number(req.params.id));
  if (!invoice) { res.status(404).json({ error: 'Invoice not found' }); return; }
  res.json(invoice);
});

router.post('/:id/send', requirePermission('invoices.write'), blockViewerWrite, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM invoices WHERE id = ?').get(id);
  if (!exists) { res.status(404).json({ error: 'Invoice not found' }); return; }
  sendInvoice(id, req.user!.id);
  res.json({ message: 'Invoice sent to customer' });
});

router.post('/:id/mark-paid', requirePermission('invoices.write'), blockViewerWrite, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT id FROM invoices WHERE id = ?').get(id);
  if (!exists) { res.status(404).json({ error: 'Invoice not found' }); return; }
  markInvoicePaid(id, req.user!.id);
  res.json({ message: 'Invoice marked as paid' });
});

export default router;
