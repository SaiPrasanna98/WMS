import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog, getProductInventory } from '../services/inventory';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('products.read'), (req: Request, res: Response) => {
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

  const products = db.prepare(query).all(...params);
  const enriched = products.map(p => ({
    ...p,
    currentInventory: getProductInventory((p as { id: number }).id),
  }));
  res.json(enriched);
});

router.get('/:id', requirePermission('products.read'), (req: Request, res: Response) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
  res.json({ ...product, currentInventory: getProductInventory(Number(req.params.id)) });
});

router.post('/', requirePermission('products.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { sku, name, description, productType, unitOfMeasure, reorderLevel } = req.body;
  if (!sku || !name || !productType) {
    res.status(400).json({ error: 'SKU, name, and product type are required' });
    return;
  }

  const result = db.prepare(`
    INSERT INTO products (sku, name, description, product_type, unit_of_measure, reorder_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sku, name, description || null, productType, unitOfMeasure || 'EA', reorderLevel || 0);

  const id = Number(result.lastInsertRowid);
  createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'product', entityId: id, newValue: req.body });
  res.status(201).json({ id, sku, name });
});

router.put('/:id', requirePermission('products.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { name, description, productType, unitOfMeasure, reorderLevel, isActive } = req.body;
  const id = Number(req.params.id);

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!existing) { res.status(404).json({ error: 'Product not found' }); return; }

  db.prepare(`
    UPDATE products SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      product_type = COALESCE(?, product_type),
      unit_of_measure = COALESCE(?, unit_of_measure),
      reorder_level = COALESCE(?, reorder_level),
      is_active = COALESCE(?, is_active),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, productType, unitOfMeasure, reorderLevel, isActive, id);

  createAuditLog({ userId: req.user!.id, action: 'UPDATE', entityType: 'product', entityId: id, oldValue: existing, newValue: req.body });
  res.json({ message: 'Product updated' });
});

router.delete('/:id', requirePermission('products.write'), blockViewerWrite, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE products SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
  createAuditLog({ userId: req.user!.id, action: 'DELETE', entityType: 'product', entityId: id });
  res.json({ message: 'Product deactivated' });
});

export default router;
