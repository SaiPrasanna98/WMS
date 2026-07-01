import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import { assertEmailDomainAllowed } from '../services/organization';
import { queryOne, queryAll, queryRun } from '../db/query';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('users.read'), async (_req: Request, res: Response) => {
  const users = await queryAll(`
    SELECT u.id, u.email, u.full_name, u.is_active, u.created_at,
           GROUP_CONCAT(r.name) as roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id
    ORDER BY u.full_name
  `);
  res.json(users.map((u) => ({ ...(u as Record<string, unknown>), roles: (u as { roles: string }).roles?.split(',') || [] })));
});

router.get('/:id', requirePermission('users.read'), async (req: Request, res: Response) => {
  const user = await queryOne(`
    SELECT u.id, u.email, u.full_name, u.is_active, u.created_at
    FROM users u WHERE u.id = ?
  `, req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const roles = await queryAll(`
    SELECT r.id, r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?
  `, req.params.id);
  res.json({ ...user, roles });
});

router.post('/', requirePermission('users.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { email, password, fullName, roleIds } = req.body;
  if (!email || !password || !fullName) {
    res.status(400).json({ error: 'Email, password, and full name are required' });
    return;
  }

  try {
    await assertEmailDomainAllowed(email);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await queryOne('SELECT id FROM users WHERE lower(email) = ?', normalizedEmail);
  if (existing) {
    res.status(400).json({ error: 'A user with this email already exists' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = await queryRun(`
    INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)
  `, normalizedEmail, hash, fullName);
  const userId = Number(result.lastInsertRowid);

  if (roleIds?.length) {

    for (const roleId of roleIds) {
      const role = await queryOne('SELECT id FROM roles WHERE id = ?', roleId);
      if (!role) {
        res.status(400).json({ error: `Invalid role ID: ${roleId}` });
        return;
      }
      await queryRun('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', userId, roleId);
    }
  }

  await createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'user', entityId: userId, newValue: { email: normalizedEmail, fullName, roleIds } });
  res.status(201).json({ id: userId, email: normalizedEmail, fullName });
});

router.put('/:id', requirePermission('users.write'), blockViewerWrite, async (req: Request, res: Response) => {
  const { fullName, isActive, roleIds, password } = req.body;
  const userId = Number(req.params.id);

  const existing = await queryOne('SELECT * FROM users WHERE id = ?', userId);
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }

  if (fullName !== undefined) {
    await queryRun('UPDATE users SET full_name = ?, updated_at = datetime(\'now\') WHERE id = ?', fullName, userId);
  }
  if (isActive !== undefined) {
    await queryRun('UPDATE users SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?', isActive ? 1 : 0, userId);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await queryRun('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', hash, userId);
  }
  if (roleIds) {
    for (const roleId of roleIds) {
      const role = await queryOne('SELECT id FROM roles WHERE id = ?', roleId);
      if (!role) {
        res.status(400).json({ error: `Invalid role ID: ${roleId}` });
        return;
      }
    }
    await queryRun('DELETE FROM user_roles WHERE user_id = ?', userId);

    for (const roleId of roleIds) {
      await queryRun('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', userId, roleId);
    }
  }

  await createAuditLog({
    userId: req.user!.id,
    action: 'UPDATE',
    entityType: 'user',
    entityId: userId,
    oldValue: { full_name: (existing as { full_name: string }).full_name },
    newValue: { fullName, isActive, roleIds },
  });
  res.json({ message: 'User updated' });
});

export default router;
