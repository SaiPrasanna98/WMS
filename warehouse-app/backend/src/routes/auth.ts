import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth';
import { createAuditLog } from '../services/inventory';
import { queryOne, queryAll, queryRun } from '../db/query';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  const user = await queryOne(`
    SELECT id, email, password_hash, full_name, is_active FROM users WHERE email = ?
  `, email) as { id: number; email: string; password_hash: string; full_name: string; is_active: number } | undefined;

  if (!user || !user.is_active) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const roles = await queryAll(`
    SELECT r.name, r.description FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?
  `, user.id) as { name: string; description: string }[];

  const permissions = await queryAll(`
    SELECT DISTINCT p.code, p.name, p.module FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?
  `, user.id) as { code: string; name: string; module: string }[];

  const secret = process.env.JWT_SECRET || 'warehouse-jwt-secret-change-in-production';
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    secret,
    { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] }
  );

  await createAuditLog({
    userId: user.id,
    action: 'LOGIN',
    entityType: 'user',
    entityId: user.id,
    ipAddress: req.ip,
  });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: roles.map(r => r.name),
      permissions: permissions.map(p => p.code),
    },
  });
});

router.get('/me', authenticate, async (req: Request, res: Response) => {
  res.json({ user: req.user });
});

router.put('/change-password', authenticate, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current password and new password are required' });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters' });
    return;
  }

  const user = await queryOne('SELECT id, password_hash FROM users WHERE id = ?', req.user!.id) as
    | { id: number; password_hash: string }
    | undefined;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await queryRun('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?', hash, user.id);

  await createAuditLog({
    userId: user.id,
    action: 'UPDATE',
    entityType: 'user',
    entityId: user.id,
    newValue: { field: 'password' },
    ipAddress: req.ip,
  });

  res.json({ message: 'Password updated' });
});

export default router;
