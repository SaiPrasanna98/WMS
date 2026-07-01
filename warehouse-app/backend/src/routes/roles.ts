import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { queryOne, queryAll, queryRun } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('roles.read'), async (_req: Request, res: Response) => {
  const roles = await queryAll(`
    SELECT r.*, COUNT(DISTINCT ur.user_id) as user_count,
           GROUP_CONCAT(DISTINCT p.code) as permissions
    FROM roles r
    LEFT JOIN user_roles ur ON ur.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id
    ORDER BY r.name
  `);
  res.json(roles.map((r) => ({
    ...(r as Record<string, unknown>),
    permissions: (r as { permissions: string }).permissions?.split(',') || [],
  })));
});

router.get('/permissions', requirePermission('roles.read'), async (_req: Request, res: Response) => {
  const permissions = await queryAll('SELECT * FROM permissions ORDER BY module, name');
  res.json(permissions);
});

router.get('/:id', requirePermission('roles.read'), async (req: Request, res: Response) => {
  const role = await queryOne('SELECT * FROM roles WHERE id = ?', req.params.id) as Record<string, unknown> | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const permissions = await queryAll(`
    SELECT p.* FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    WHERE rp.role_id = ?
    ORDER BY p.module, p.name
  `, req.params.id);

  const users = await queryAll(`
    SELECT u.id, u.full_name, u.email, u.is_active
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    WHERE ur.role_id = ?
    ORDER BY u.full_name
  `, req.params.id);

  res.json({ ...role, permissions, users });
});

const PROTECTED_ROLES = new Set(['Admin', 'Viewer']);

router.post('/', requirePermission('roles.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { name, description, permissionCodes } = req.body;
  if (!name?.trim()) {
    res.status(400).json({ error: 'Role name is required' });
    return;
  }
  const existing = await queryOne('SELECT id FROM roles WHERE name = ?', name.trim());
  if (existing) {
    res.status(400).json({ error: 'Role name already exists' });
    return;
  }

  const result = await queryRun('INSERT INTO roles (name, description) VALUES (?, ?)', name.trim(), description ?? null);
  const roleId = Number(result.lastInsertRowid);

  if (permissionCodes?.length) {

    for (const code of permissionCodes) {
      const perm = await queryOne('SELECT id FROM permissions WHERE code = ?', code) as { id: number } | undefined;
      if (perm) await queryRun('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', roleId, perm.id);
    }
  }

  res.status(201).json({ id: roleId, name: name.trim() });
});

router.put('/:id', requirePermission('roles.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const roleId = Number(req.params.id);
  const role = await queryOne('SELECT * FROM roles WHERE id = ?', roleId) as { name: string } | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }

  const { description, permissionCodes } = req.body;
  if (description !== undefined) {
    await queryRun('UPDATE roles SET description = ? WHERE id = ?', description, roleId);
  }

  if (permissionCodes) {
    if (PROTECTED_ROLES.has(role.name) && role.name === 'Admin') {
      res.status(400).json({ error: 'Admin role permissions cannot be modified' });
      return;
    }
    await queryRun('DELETE FROM role_permissions WHERE role_id = ?', roleId);

    for (const code of permissionCodes) {
      const perm = await queryOne('SELECT id FROM permissions WHERE code = ?', code) as { id: number } | undefined;
      if (perm) await queryRun('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', roleId, perm.id);
    }
  }

  res.json({ message: 'Role updated' });
});

router.delete('/:id', requirePermission('roles.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const roleId = Number(req.params.id);
  const role = await queryOne('SELECT name FROM roles WHERE id = ?', roleId) as { name: string } | undefined;
  if (!role) {
    res.status(404).json({ error: 'Role not found' });
    return;
  }
  if (PROTECTED_ROLES.has(role.name)) {
    res.status(400).json({ error: 'System roles cannot be deleted' });
    return;
  }

  const users = await queryOne('SELECT COUNT(*) as c FROM user_roles WHERE role_id = ?', roleId) as { c: number };
  if (users.c > 0) {
    res.status(400).json({ error: 'Remove all users from this role before deleting' });
    return;
  }

  await queryRun('DELETE FROM role_permissions WHERE role_id = ?', roleId);
  await queryRun('DELETE FROM roles WHERE id = ?', roleId);
  res.json({ message: 'Role deleted' });
});

export default router;
