import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, getProductInventory } from '../services/inventory';
import { queryOne, queryAll, queryRun, sqlNow } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('products.read'), async (req: Request, res: Response) => {
  const { search, type } = req.query;
  let query = 'SELECT * FROM products WHERE is_active = 1';
  const params: string[] = [];

  if (search) {
    query += ' AND (sku LIKE ? OR name LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (type) {
    query += ' AND product_type = ?';
    params.push(type as string);
  }
  query += ' ORDER BY sku';

  const products = await queryAll(query, ...params);
  const enriched = await Promise.all(products.map(async (p) => ({
    ...(p as Record<string, unknown>),
    currentInventory: await getProductInventory((p as { id: number }).id),
  })));
  res.json(enriched);
});

router.get('/:id', requirePermission('products.read'), async (req: Request, res: Response) => {
  const product = await queryOne('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json({ ...product, currentInventory: await getProductInventory(Number(req.params.id)) });
});

router.post('/', requirePermission('products.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { sku, name, description, productType, unitOfMeasure, reorderLevel } = req.body;
  if (!sku || !name || !productType) {
    res.status(400).json({ error: 'SKU, name, and product type are required' });
    return;
  }

  const result = await queryRun(`
    INSERT INTO products (sku, name, description, product_type, unit_of_measure, reorder_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `, sku, name, description || null, productType, unitOfMeasure || 'EA', reorderLevel || 0);

  const id = Number(result.lastInsertRowid);
  await createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'product', entityId: id, newValue: req.body });
  res.status(201).json({ id, sku, name });
});

router.put('/:id', requirePermission('products.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { name, description, productType, unitOfMeasure, reorderLevel, isActive } = req.body;
  const id = Number(req.params.id);

  const existing = await queryOne('SELECT * FROM products WHERE id = ?', id);
  if (!existing) { res.status(404).json({ error: 'Product not found' }); return; }

  await queryRun(`
    UPDATE products SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      product_type = COALESCE(?, product_type),
      unit_of_measure = COALESCE(?, unit_of_measure),
      reorder_level = COALESCE(?, reorder_level),
      is_active = COALESCE(?, is_active),
      updated_at = ${sqlNow()}
    WHERE id = ?
  `, name, description, productType, unitOfMeasure, reorderLevel, isActive, id);

  await createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'product', entityId: id, oldValue: existing, newValue: req.body });
  res.json({ message: 'Product updated' });
});

router.delete('/:id', requirePermission('products.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await queryRun('UPDATE products SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?', id);
  await createAuditLog({ userId: req.user!.id, action: 'DELETE', entityType: 'product', entityId: id });
  res.json({ message: 'Product deactivated' });
});

export default router;
