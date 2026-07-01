import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db';
import { authenticate } from '../middleware/auth';
import { requirePermission, blockViewerWrite } from '../middleware/rbac';
import { createAuditLog } from '../services/inventory';
import {
  assertEmailDomainAllowed,
  generateInviteToken,
  getOrganizationSettings,
  parseRoleIds,
} from '../services/organization';

const router = Router();

function enrichInvitation(row: Record<string, unknown>) {
  const roleIds = parseRoleIds(String(row.role_ids));
  const roles = roleIds.length
    ? db.prepare(`SELECT id, name FROM roles WHERE id IN (${roleIds.map(() => '?').join(',')})`).all(...roleIds)
    : [];
  const inviter = db.prepare('SELECT full_name, email FROM users WHERE id = ?').get(row.invited_by) as
    { full_name: string; email: string } | undefined;
  return {
    ...row,
    roleIds,
    roles,
    invitedByName: inviter?.full_name,
    invitedByEmail: inviter?.email,
  };
}

router.get('/verify', (req: Request, res: Response) => {
  const token = String(req.query.token ?? '');
  if (!token) {
    res.status(400).json({ error: 'Invitation token is required' });
    return;
  }

  const invite = db.prepare(`
    SELECT email, full_name, role_ids, status, expires_at FROM user_invitations WHERE token = ?
  `).get(token) as Record<string, unknown> | undefined;

  if (!invite || invite.status !== 'PENDING') {
    res.status(404).json({ error: 'Invitation not found or no longer valid' });
    return;
  }
  if (new Date(String(invite.expires_at)) < new Date()) {
    db.prepare(`UPDATE user_invitations SET status = 'EXPIRED' WHERE token = ?`).run(token);
    res.status(410).json({ error: 'Invitation has expired' });
    return;
  }

  const roleIds = parseRoleIds(String(invite.role_ids));
  const roles = roleIds.length
    ? db.prepare(`SELECT id, name FROM roles WHERE id IN (${roleIds.map(() => '?').join(',')})`).all(...roleIds)
    : [];

  res.json({
    email: invite.email,
    fullName: invite.full_name,
    roles,
    orgName: getOrganizationSettings().orgName,
    expiresAt: invite.expires_at,
  });
});

router.post('/accept', (req: Request, res: Response) => {
  const { token, password, fullName } = req.body;
  if (!token || !password) {
    res.status(400).json({ error: 'Token and password are required' });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  const invite = db.prepare('SELECT * FROM user_invitations WHERE token = ?').get(token) as
    Record<string, unknown> | undefined;
  if (!invite || invite.status !== 'PENDING') {
    res.status(404).json({ error: 'Invitation not found or no longer valid' });
    return;
  }
  if (new Date(String(invite.expires_at)) < new Date()) {
    db.prepare(`UPDATE user_invitations SET status = 'EXPIRED' WHERE id = ?`).run(invite.id);
    res.status(410).json({ error: 'Invitation has expired' });
    return;
  }

  const email = String(invite.email);
  const displayName = fullName?.trim() || String(invite.full_name);
  const roleIds = parseRoleIds(String(invite.role_ids));

  try {
    const userId = db.transaction(() => {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(`
        INSERT INTO users (email, password_hash, full_name) VALUES (?, ?, ?)
      `).run(email, hash, displayName);
      const newUserId = Number(result.lastInsertRowid);

      const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
      for (const roleId of roleIds) {
        insertRole.run(newUserId, roleId);
      }

      db.prepare(`
        UPDATE user_invitations SET status = 'ACCEPTED', accepted_at = datetime('now') WHERE id = ?
      `).run(invite.id);

      return newUserId;
    })();

    createAuditLog({
      userId,
      action: 'CREATE',
      entityType: 'user',
      entityId: userId,
      newValue: { email, fullName: displayName, roleIds, source: 'invitation' },
    });

    res.json({ message: 'Account created. You can sign in now.', email });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message || 'Failed to accept invitation' });
  }
});

router.use(authenticate);

router.get('/', requirePermission('users.read'), (_req: Request, res: Response) => {
  const rows = db.prepare(`
    SELECT i.*, u.full_name as invited_by_name
    FROM user_invitations i
    JOIN users u ON u.id = i.invited_by
    WHERE i.status = 'PENDING' AND datetime(i.expires_at) > datetime('now')
    ORDER BY i.created_at DESC
  `).all() as Record<string, unknown>[];
  res.json(rows.map(enrichInvitation));
});

router.post('/', requirePermission('users.write'), blockViewerWrite, (req: Request, res: Response) => {
  const { email, fullName, roleIds } = req.body;
  if (!email || !fullName || !roleIds?.length) {
    res.status(400).json({ error: 'Email, full name, and at least one role are required' });
    return;
  }

  try {
    assertEmailDomainAllowed(email);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail);
  if (existingUser) {
    res.status(400).json({ error: 'A user with this email already exists' });
    return;
  }

  const pending = db.prepare(`
    SELECT id FROM user_invitations WHERE lower(email) = ? AND status = 'PENDING' AND datetime(expires_at) > datetime('now')
  `).get(normalizedEmail);
  if (pending) {
    res.status(400).json({ error: 'A pending invitation already exists for this email' });
    return;
  }

  for (const roleId of roleIds) {
    const role = db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
    if (!role) {
      res.status(400).json({ error: `Invalid role ID: ${roleId}` });
      return;
    }
  }

  const { inviteExpiryDays } = getOrganizationSettings();
  const token = generateInviteToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + inviteExpiryDays);

  const result = db.prepare(`
    INSERT INTO user_invitations (email, full_name, role_ids, invited_by, token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(normalizedEmail, fullName, JSON.stringify(roleIds), req.user!.id, token, expiresAt.toISOString());

  createAuditLog({
    userId: req.user!.id,
    action: 'CREATE',
    entityType: 'user_invitation',
    entityId: Number(result.lastInsertRowid),
    newValue: { email: normalizedEmail, fullName, roleIds },
  });

  const invitePath = `/accept-invite?token=${token}`;
  res.status(201).json({
    id: Number(result.lastInsertRowid),
    email: normalizedEmail,
    fullName,
    roleIds,
    token,
    invitePath,
    expiresAt: expiresAt.toISOString(),
    message: 'Invitation created. Share the invite link with the user to complete setup.',
  });
});

router.post('/:id/revoke', requirePermission('users.write'), blockViewerWrite, (req: Request, res: Response) => {
  const inviteId = Number(req.params.id);
  const invite = db.prepare('SELECT * FROM user_invitations WHERE id = ?').get(inviteId) as
    { status: string; email: string } | undefined;
  if (!invite) {
    res.status(404).json({ error: 'Invitation not found' });
    return;
  }
  if (invite.status !== 'PENDING') {
    res.status(400).json({ error: 'Only pending invitations can be revoked' });
    return;
  }

  db.prepare(`UPDATE user_invitations SET status = 'REVOKED' WHERE id = ?`).run(inviteId);
  createAuditLog({
    userId: req.user!.id,
    action: 'UPDATE',
    entityType: 'user_invitation',
    entityId: inviteId,
    newValue: { status: 'REVOKED', email: invite.email },
  });
  res.json({ message: 'Invitation revoked' });
});

export default router;
