import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();
router.use(authenticate);

router.get('/', requirePermission('customers.read'), async (req: Request, res: Response) => {
  const { search } = req.query;
  let query = 'SELECT * FROM customers WHERE is_active = 1';
  const params: string[] = [];
  if (search) {
    query += ' AND (name LIKE ? OR email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY name';
  res.json(await queryAll(query, ...params));
});

router.get('/:id', requirePermission('customers.read'), async (req: Request, res: Response) => {
  const customer = await queryOne('SELECT * FROM customers WHERE id = ?', req.params.id);
  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
  const addresses = await queryAll('SELECT * FROM customer_addresses WHERE customer_id = ?', req.params.id);
  res.json({ ...customer, addresses });
});

router.post('/', requirePermission('customers.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { name, email, phone, address } = req.body;
  if (!name) { res.status(400).json({ error: 'Customer name is required' }); return; }

  const result = await queryRun(`
    INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)
  `, name, email ?? null, phone ?? null);
  const customerId = Number(result.lastInsertRowid);

  if (address?.line1 && address?.city) {
    await queryRun(`
      INSERT INTO customer_addresses (customer_id, label, line1, line2, city, state, postal_code, country, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `, customerId, address.label ?? 'Primary', address.line1, address.line2 ?? null,
      address.city, address.state ?? null, address.postalCode ?? null, address.country ?? 'US');
  }

  await createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'customer', entityId: customerId, newValue: { name } });
  res.status(201).json({ id: customerId, name });
});

router.put('/:id', requirePermission('customers.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { name, email, phone } = req.body;
  const id = Number(req.params.id);
  const existing = await queryOne('SELECT * FROM customers WHERE id = ?', id);
  if (!existing) { res.status(404).json({ error: 'Customer not found' }); return; }
  if (!name?.trim()) { res.status(400).json({ error: 'Customer name is required' }); return; }

  await queryRun(`
    UPDATE customers SET name = ?, email = ?, phone = ?, updated_at = ${sqlNow()} WHERE id = ?
  `, name.trim(), email ?? null, phone ?? null, id);

  await createAuditLog({
    userId: req.user!.id, action: 'UPDATE', entityType: 'customer', entityId: id,
    oldValue: existing, newValue: { name, email, phone },
  });
  res.json({ message: 'Customer updated' });
});

router.post('/:id/addresses', requirePermission('customers.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { label, line1, line2, city, state, postalCode, country, isDefault } = req.body;
  if (!line1 || !city) { res.status(400).json({ error: 'Address line and city are required' }); return; }

  const customerId = Number(req.params.id);
  if (isDefault) {
    await queryRun('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', customerId);
  }

  const result = await queryRun(`
    INSERT INTO customer_addresses (customer_id, label, line1, line2, city, state, postal_code, country, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, customerId, label ?? 'Delivery', line1, line2 ?? null, city, state ?? null, postalCode ?? null, country ?? 'US', isDefault ? 1 : 0);

  res.status(201).json({ id: Number(result.lastInsertRowid) });
});

export default router;
