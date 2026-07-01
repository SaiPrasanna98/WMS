import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import { assertEmailDomainAllowed } from '../services/organization';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission('users.read'), (_req: Request, res: Response) => {
  const users = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.is_active, u.created_at,
           GROUP_CONCAT(r.name) as roles
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id
    GROUP BY u.id
    ORDER BY u.full_name
  `).all();
  res.json(users.map(u => ({ ...u, roles: (u as { roles: string }).roles?.split(',') || [] })));
});

router.get('/:id', requirePermission('users.read'), (req: Request, res: Response) => {
  const user = db.prepare(`
    SELECT u.id, u.email, u.full_name, u.is_active, u.created_at
    FROM users u WHERE u.id = ?
  `).get(req.params.id);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const roles = db.prepare(`
    SELECT r.id, r.name FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?
  `).all(req.params.id);
  res.json({ ...user, roles });
});

router.post('/', requirePermission('users.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { email, password, fullName, roleIds } = req.body;
  if (!email || !password || !fullName) {
    res.status(400).json({ error: 'Email, password, and full name are required' });
    return;
  }

  try {
    assertEmailDomainAllowed(email);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail);
  if (existing) {
    res.status(400).json({ error: 'A user with this email already exists' });
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)
  `).run(normalizedEmail, hash, fullName);
  const userId = Number(result.lastInsertRowid);

  if (roleIds?.length) {
    const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
    for (const roleId of roleIds) {
      const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
      if (!role) {
        res.status(400).json({ error: `Invalid role ID: ${roleId}` });
        return;
      }
      insertRole.run(userId, roleId);
    }
  }

  createAuditLog({ userId: req.user!.id, action: 'CREATE', entityType: 'user', entityId: userId, newValue: { email: normalizedEmail, fullName, roleIds } });
  res.status(201).json({ id: userId, email: normalizedEmail, fullName });
});

router.put('/:id', requirePermission('users.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { fullName, isActive, roleIds, password } = req.body;
  const userId = Number(req.params.id);

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existing) { res.status(404).json({ error: 'User not found' }); return; }

  if (fullName !== undefined) {
    db.prepare('UPDATE users SET full_name = ?, updated_at = datetime(\'now\') WHERE id = ?').run(fullName, userId);
  }
  if (isActive !== undefined) {
    db.prepare('UPDATE users SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?').run(isActive ? 1 : 0, userId);
  }
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hash, userId);
  }
  if (roleIds) {
    for (const roleId of roleIds) {
      const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
      if (!role) {
        res.status(400).json({ error: `Invalid role ID: ${roleId}` });
        return;
      }
    }
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId);
    const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
    for (const roleId of roleIds) {
      insertRole.run(userId, roleId);
    }
  }

  createAuditLog({
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
