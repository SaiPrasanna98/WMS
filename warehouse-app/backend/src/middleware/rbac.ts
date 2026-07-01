import { Request, Response, NextFunction } from 'express';

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasPermission = permissions.some(p => req.user!.permissions.includes(p));
    if (!hasPermission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasRole = roles.some(r => req.user!.roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: 'Insufficient role access' });
      return;
    }

    next();
  };
}

export function requireAnyPermission(...permissions: string[]) {
  return requirePermission(...permissions);
}

export function blockViewerWrite(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    next();
    return;
  }
  const isReadOnlyViewer = req.user.roles.length === 1 && req.user.roles.includes('Viewer');
  if (isReadOnlyViewer && req.method !== 'GET') {
    res.status(403).json({ error: 'Viewer role has read-only access' });
    return;
  }
  next();
}
