import crypto from 'crypto';
import { queryOne, queryRun, sqlNow } from '../db/query';

export interface OrganizationSettings {
  orgName: string;
  allowedDomains: string[];
  inviteExpiryDays: number;
}

export async function getOrganizationSettings(): Promise<OrganizationSettings> {
  const row = await queryOne<{ org_name: string; allowed_domains: string; invite_expiry_days: number }>(`
    SELECT org_name, allowed_domains, invite_expiry_days FROM organization_settings WHERE id = 1
  `);

  if (!row) {
    return { orgName: 'Warehouse Operations', allowedDomains: ['demo.com'], inviteExpiryDays: 7 };
  }

  return {
    orgName: row.org_name,
    allowedDomains: row.allowed_domains.split(',').map(d => d.trim().toLowerCase()).filter(Boolean),
    inviteExpiryDays: row.invite_expiry_days,
  };
}

export async function saveOrganizationSettings(settings: Partial<OrganizationSettings>): Promise<OrganizationSettings> {
  const current = await getOrganizationSettings();
  const next: OrganizationSettings = {
    orgName: settings.orgName?.trim() || current.orgName,
    allowedDomains: settings.allowedDomains?.map(d => d.trim().toLowerCase()).filter(Boolean) ?? current.allowedDomains,
    inviteExpiryDays: settings.inviteExpiryDays ?? current.inviteExpiryDays,
  };

  if (!next.allowedDomains.length) {
    throw new Error('At least one allowed email domain is required');
  }

  await queryRun(`
    INSERT INTO organization_settings (id, org_name, allowed_domains, invite_expiry_days, updated_at)
    VALUES (1, ?, ?, ?, ${sqlNow()})
    ON CONFLICT(id) DO UPDATE SET
      org_name = excluded.org_name,
      allowed_domains = excluded.allowed_domains,
      invite_expiry_days = excluded.invite_expiry_days,
      updated_at = ${sqlNow()}
  `, next.orgName, next.allowedDomains.join(','), next.inviteExpiryDays);

  return next;
}

export function getEmailDomain(email: string): string {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 ? parts[1] : '';
}

export async function isEmailDomainAllowed(email: string): Promise<boolean> {
  const domain = getEmailDomain(email);
  if (!domain) return false;
  const { allowedDomains } = await getOrganizationSettings();
  return allowedDomains.includes(domain);
}

export async function assertEmailDomainAllowed(email: string): Promise<void> {
  if (!(await isEmailDomainAllowed(email))) {
    const { allowedDomains } = await getOrganizationSettings();
    throw new Error(`Email must use an allowed domain: ${allowedDomains.join(', ')}`);
  }
}

export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function parseRoleIds(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number).filter(n => Number.isFinite(n)) : [];
  } catch {
    return [];
  }
}
