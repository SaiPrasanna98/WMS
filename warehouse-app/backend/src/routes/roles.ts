import { Router, Request, Response } from 'express';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('roles.read'), (_req: Request, res: Response) => {
  const roles = db.prepare(`
    SELECT r.*, COUNT(DISTINCT ur.user_id) as user_count,
           GROUP_CONCAT(DISTINCT p.code) as permissions
    FROM roles r
    LEFT JOIN user_roles ur ON ur.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id
    ORDER BY r.name
  `).all();
  res.json(roles.map(r => ({
    ...r,
    permissions: (r as { permissions: string }).permissions?.split(',') || [],
  })));
});

router.get('/permissions', requirePermission('roles.read'), (_req: Request, res: Response) => {
  const permissions = db.prepare('SELECT * FROM permissions ORDER BY module, name').all();
  res.json(permissions);
});

router.get('/:id', requirePermission('roles.read'), (req: Request, res: Response) => {
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const permissions = db.prepare(`
    SELECT p.* FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = ?
    ORDER BY p.module, p.name
  `).all(req.params.id);

  const users = db.prepare(`
    SELECT u.id, u.full_name, u.email, u.is_active
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.role_id = ?
    ORDER BY u.full_name
  `).all(req.params.id);

  res.json({ ...role, permissions, users });
});

const PROTECTED_ROLES = new Set(['Admin', 'Viewer']);

router.post('/', requirePermission('roles.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { name, description, permissionCodes } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Role name is required' });
    return;
  }
  const existing = db.prepare('SELECT id FROM roles WHERE name = ?').get(name.trim());
  if (existing) {
    res.status(400).json({ error: 'Role name already exists' });
    return;
  }

  const result = db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)').run(name.trim(), description ?? null);
  const roleId = Number(result.lastInsertRowid);

  if (permissionCodes?.length) {
    const insert = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
    for (const code of permissionCodes) {
      const perm = db.prepare('SELECT id FROM permissions WHERE code = ?').get(code) as { id: number } | undefined;
      if (perm) insert.run(roleId, perm.id);
    }
  }

  res.status(201).json({ id: roleId, name: name.trim() });
});

router.put('/:id', requirePermission('roles.write'), blockViewerWrite, (req: Request, res: Response) => {
  const roleId = Number(req.params.id);
  const role = db.prepare('SELECT * FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const { description, permissionCodes } = req.body;
  if (description !== undefined) {
    db.prepare('UPDATE roles SET description = ? WHERE id = ?').run(description, roleId);
  }

  if (permissionCodes) {
    if (PROTECTED_ROLES.has(role.name) && role.name === 'Admin') {
      res.status(400).json({ error: 'Admin role permissions cannot be modified' });
      return;
    }
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
    const insert = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
    for (const code of permissionCodes) {
      const perm = db.prepare('SELECT id FROM permissions WHERE code = ?').get(code) as { id: number } | undefined;
      if (perm) insert.run(roleId, perm.id);
    }
  }

  res.json({ message: 'Role updated' });
});

router.delete('/:id', requirePermission('roles.write'), blockViewerWrite, (req: Request, res: Response) => {
  const roleId = Number(req.params.id);
  const role = db.prepare('SELECT name FROM roles WHERE id = ?').get(roleId) as { name: string } | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }
  if (PROTECTED_ROLES.has(role.name)) {
    res.status(400).json({ error: 'System roles cannot be deleted' });
    return;
  }

  const users = db.prepare('SELECT COUNT(*) as c FROM user_roles WHERE role_id = ?').get(roleId) as { c: number };
  if (users.c > 0) {
    res.status(400).json({ error: 'Remove all users from this role before deleting' });
    return;
  }

  db.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(roleId);
  db.prepare('DELETE FROM roles WHERE id = ?').run(roleId);
  res.json({ message: 'Role deleted' });
});

export default router;
