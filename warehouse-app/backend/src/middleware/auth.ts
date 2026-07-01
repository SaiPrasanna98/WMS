import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { queryAll, queryOne } from '../db/query';
import { AuthUser, JwtPayload } from '../types';

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const secret = process.env.JWT_SECRET || 'warehouse-jwt-secret-change-in-production';
    const payload = jwt.verify(token, secret) as JwtPayload;

    const user = await queryOne<{ id: number; email: string; full_name: string; is_active: number }>(`
      SELECT id, email, full_name, is_active FROM users WHERE id = ?
    `, payload.userId);

    if (!user || !user.is_active) {
      res.status(401).json({ error: 'Invalid or inactive user' });
      return;
    }

    const roles = await queryAll<{ name: string }>(`
      SELECT r.name FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id
      WHERE ur.user_id = ?
    `, user.id);

    const permissions = await queryAll<{ code: string }>(`
      SELECT DISTINCT p.code FROM permissions p
      JOIN role_permissions rp ON rp.permission_id = p.id
      JOIN user_roles ur ON ur.role_id = rp.role_id
      WHERE ur.user_id = ?
    `, user.id);

    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      roles: roles.map(r => r.name),
      permissions: permissions.map(p => p.code),
    };

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }
  void authenticate(req, _res, next);
}
