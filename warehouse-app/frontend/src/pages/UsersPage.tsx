import { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, SearchBar, Alert, Modal } from '../components/UI';

interface Role {
  id: number;
  name: string;
  description: string;
  user_count: number;
  permissions: string[];
}

interface Permission {
  id: number;
  code: string;
  name: string;
  module: string;
}

interface UserRow {
  id: number;
  email: string;
  full_name: string;
  is_active: number;
  roles: string[];
}

interface Invitation {
  id: number;
  email: string;
  full_name: string;
  roleIds: number[];
  roles: Array<{ id: number; name: string }>;
  invited_by_name: string;
  expires_at: string;
  token: string;
}

interface OrgSettings {
  orgName: string;
  allowedDomains: string[];
  inviteExpiryDays: number;
}

type Tab = 'users' | 'invitations' | 'roles' | 'organization';

function initials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export function UsersPage() {
  const { hasPermission, isViewer } = useAuth();
  const canWrite = hasPermission('users.write') && !isViewer;
  const canManageRoles = hasPermission('roles.write') && !isViewer;
  const [tab, setTab] = useState<Tab>('users');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [inviteForm, setInviteForm] = useState({ email: '', fullName: '', roleIds: [] as number[] });
  const [manageForm, setManageForm] = useState({ fullName: '', isActive: true, roleIds: [] as number[], password: '' });
  const [lastInviteLink, setLastInviteLink] = useState('');
  const [orgForm, setOrgForm] = useState({ orgName: '', allowedDomains: '', inviteExpiryDays: 7 });
  const [roleEditCodes, setRoleEditCodes] = useState<string[]>([]);
  const [roleEditing, setRoleEditing] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [createRoleForm, setCreateRoleForm] = useState({ name: '', description: '', permissionCodes: [] as string[] });

  const PROTECTED_ROLES = new Set(['Admin', 'Viewer']);

  const loadAll = async () => {
    setLoading(true);
    try {
      const usersRes = await api.get('/users');
      setUsers(usersRes.data);

      if (hasPermission('roles.read')) {
        const [rolesRes, permsRes] = await Promise.all([
          api.get('/roles'),
          api.get('/roles/permissions'),
        ]);
        setRoles(rolesRes.data);
        setPermissions(permsRes.data);
        if (!selectedRoleId && rolesRes.data.length) {
          setSelectedRoleId(rolesRes.data[0].id);
        }
      }

      if (canWrite) {
        const [invRes, orgRes] = await Promise.all([
          api.get('/invitations'),
          api.get('/organization'),
        ]);
        setInvitations(invRes.data);
        setOrg(orgRes.data);
        setOrgForm({
          orgName: orgRes.data.orgName,
          allowedDomains: orgRes.data.allowedDomains.join(', '),
          inviteExpiryDays: orgRes.data.inviteExpiryDays,
        });
      }
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [hasPermission, canWrite]);

  const filteredUsers = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const selectedRole = roles.find(r => r.id === selectedRoleId) ?? null;

  useEffect(() => {
    if (selectedRole) setRoleEditCodes([...selectedRole.permissions]);
    setRoleEditing(false);
  }, [selectedRoleId, roles]);

  const saveRolePermissions = async () => {
    if (!selectedRole || selectedRole.name === 'Admin') return;
    setSubmitting(true);
    try {
      await api.put(`/roles/${selectedRole.id}`, { permissionCodes: roleEditCodes });
      setAlert({ type: 'success', message: 'Role updated' });
      setRoleEditing(false);
      loadAll();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createRoleForm.name.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.post('/roles', {
        name: createRoleForm.name.trim(),
        description: createRoleForm.description.trim() || null,
        permissionCodes: createRoleForm.permissionCodes,
      });
      setAlert({ type: 'success', message: `Role "${createRoleForm.name}" created` });
      setCreateRoleOpen(false);
      setCreateRoleForm({ name: '', description: '', permissionCodes: [] });
      setSelectedRoleId(res.data.id);
      loadAll();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRole = async () => {
    if (!selectedRole || PROTECTED_ROLES.has(selectedRole.name)) return;
    if (!window.confirm(`Delete role "${selectedRole.name}"? This cannot be undone.`)) return;
    setSubmitting(true);
    try {
      await api.delete(`/roles/${selectedRole.id}`);
      setAlert({ type: 'success', message: 'Role deleted' });
      setSelectedRoleId(null);
      loadAll();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };
  const permissionsByModule = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    (acc[p.module] ??= []).push(p);
    return acc;
  }, {});

  const toggleRoleId = (roleIds: number[], roleId: number): number[] =>
    roleIds.includes(roleId) ? roleIds.filter(id => id !== roleId) : [...roleIds, roleId];

  const openManage = async (user: UserRow) => {
    try {
      const res = await api.get(`/users/${user.id}`);
      setSelectedUser(user);
      setManageForm({
        fullName: String(res.data.full_name),
        isActive: Boolean(res.data.is_active),
        roleIds: (res.data.roles as Array<{ id: number }>).map(r => r.id),
        password: '',
      });
      setManageOpen(true);
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteForm.roleIds.length) {
      setAlert({ type: 'error', message: 'Select at least one role' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/invitations', inviteForm);
      const link = `${window.location.origin}${res.data.invitePath}`;
      setLastInviteLink(link);
      setAlert({ type: 'success', message: `Invitation sent to ${res.data.email}` });
      setInviteForm({ email: '', fullName: '', roleIds: [] });
      loadAll();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleManageSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setSubmitting(true);
    try {
      await api.put(`/users/${selectedUser.id}`, {
        fullName: manageForm.fullName,
        isActive: manageForm.isActive,
        roleIds: manageForm.roleIds,
        password: manageForm.password || undefined,
      });
      setAlert({ type: 'success', message: 'User updated' });
      setManageOpen(false);
      loadAll();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevokeInvite = async (id: number) => {
    if (!window.confirm('Revoke this invitation?')) return;
    try {
      await api.post(`/invitations/${id}/revoke`);
      setAlert({ type: 'success', message: 'Invitation revoked' });
      loadAll();
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    }
  };

  const handleSaveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.put('/organization', {
        orgName: orgForm.orgName,
        allowedDomains: orgForm.allowedDomains.split(',').map(d => d.trim()).filter(Boolean),
        inviteExpiryDays: Number(orgForm.inviteExpiryDays),
      });
      setOrg(res.data);
      setAlert({ type: 'success', message: 'Organization settings saved' });
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/accept-invite?token=${token}`;
    navigator.clipboard.writeText(link);
    setAlert({ type: 'success', message: 'Invite link copied to clipboard' });
  };

  return (
    <div className="admin-center">
      <PageHeader
        title="Users & roles"
        subtitle={org ? `${org.orgName} · Allowed domains: ${org.allowedDomains.join(', ')}` : 'Manage workforce access like Microsoft 365 admin center'}
        action={canWrite && tab === 'users' && (
          <button className="btn btn-primary" onClick={() => { setLastInviteLink(''); setInviteOpen(true); }}>
            Invite user
          </button>
        )}
      />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="admin-tabs">
        {(['users', 'invitations', 'roles', 'organization'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            className={`admin-tab ${tab === t ? 'admin-tab-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'users' && `Active users (${users.length})`}
            {t === 'invitations' && `Invitations (${invitations.length})`}
            {t === 'roles' && `Roles (${roles.length})`}
            {t === 'organization' && 'Organization'}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <>
          <div className="toolbar">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by name or email..." />
          </div>
          <div className="admin-user-list">
            {loading ? <p className="page-loading">Loading users...</p> : filteredUsers.map(user => (
              <div key={user.id} className="admin-user-card">
                <div className="admin-user-avatar">{initials(user.full_name)}</div>
                <div className="admin-user-main">
                  <div className="admin-user-name">{user.full_name}</div>
                  <div className="admin-user-email">{user.email}</div>
                  <div className="admin-role-pills">
                    {user.roles.map(role => (
                      <span key={role} className="admin-role-pill">{role}</span>
                    ))}
                  </div>
                </div>
                <div className="admin-user-meta">
                  <span className={`status-pill ${user.is_active ? 'status-pill-active' : 'status-pill-inactive'}`}>
                    {user.is_active ? 'Active' : 'Blocked'}
                  </span>
                  {canWrite && (
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => openManage(user)}>
                      Manage
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'invitations' && (
        <div className="settings-card">
          {!canWrite ? (
            <p className="empty-text">You do not have permission to manage invitations.</p>
          ) : invitations.length === 0 ? (
            <p className="empty-text">No pending invitations. Click Invite user to add someone with your organization domain.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>Invited by</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map(inv => (
                  <tr key={inv.id}>
                    <td>{inv.full_name}</td>
                    <td>{inv.email}</td>
                    <td>{inv.roles.map(r => r.name).join(', ')}</td>
                    <td>{inv.invited_by_name}</td>
                    <td>{new Date(inv.expires_at).toLocaleDateString()}</td>
                    <td>
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => copyInviteLink(inv.token)}>Copy link</button>
                      {' '}
                      <button type="button" className="btn btn-sm btn-outline" onClick={() => handleRevokeInvite(inv.id)}>Revoke</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'roles' && hasPermission('roles.read') && (
        <div className="admin-roles-layout">
          <div className="admin-roles-sidebar settings-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 className="settings-card-title" style={{ margin: 0 }}>Role catalog</h3>
              {canManageRoles && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setCreateRoleOpen(true)}>New role</button>
              )}
            </div>
            {roles.map(role => (
              <button
                key={role.id}
                type="button"
                className={`admin-role-item ${selectedRoleId === role.id ? 'admin-role-item-active' : ''}`}
                onClick={() => setSelectedRoleId(role.id)}
              >
                <span className="admin-role-item-name">{role.name}</span>
                <span className="admin-role-item-meta">{role.user_count} users · {role.permissions.length} permissions</span>
              </button>
            ))}
          </div>
          <div className="admin-roles-detail settings-card">
            {selectedRole ? (
              <>
                <h3 className="settings-card-title">{selectedRole.name}</h3>
                <p className="page-subtitle" style={{ marginBottom: 16 }}>{selectedRole.description}</p>
                {canManageRoles && selectedRole.name !== 'Admin' && (
                  <div className="form-actions" style={{ marginBottom: 16, justifyContent: 'flex-start' }}>
                    {!roleEditing ? (
                      <>
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => setRoleEditing(true)}>Edit permissions</button>
                        {!PROTECTED_ROLES.has(selectedRole.name) && selectedRole.user_count === 0 && (
                          <button type="button" className="btn btn-sm btn-outline" disabled={submitting} onClick={handleDeleteRole}>Delete role</button>
                        )}
                      </>
                    ) : (
                      <>
                        <button type="button" className="btn btn-sm btn-primary" disabled={submitting} onClick={saveRolePermissions}>Save</button>
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => { setRoleEditing(false); setRoleEditCodes([...selectedRole.permissions]); }}>Cancel</button>
                      </>
                    )}
                  </div>
                )}
                <h4 className="section-title">Permissions by module</h4>
                {Object.entries(permissionsByModule).map(([module, perms]) => (
                  <div key={module} className="admin-perm-module">
                    <div className="admin-perm-module-title">{module}</div>
                    <div className="admin-perm-grid">
                      {perms.map(p => {
                        const on = (roleEditing ? roleEditCodes : selectedRole.permissions).includes(p.code);
                        return (
                          <label key={p.id} className={`admin-perm-chip ${on ? 'admin-perm-chip-on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              readOnly={!roleEditing}
                              onChange={() => {
                                if (!roleEditing) return;
                                setRoleEditCodes(codes =>
                                  codes.includes(p.code) ? codes.filter(c => c !== p.code) : [...codes, p.code]
                                );
                              }}
                            />
                            <span>{p.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <p className="empty-text">Select a role to view its access.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'organization' && canWrite && (
        <form className="settings-card" onSubmit={handleSaveOrg}>
          <h3 className="settings-card-title">Organization & email domains</h3>
          <p className="page-subtitle" style={{ marginBottom: 16 }}>
            Like Microsoft 365, only users with email addresses on your allowed domains can be invited or created.
          </p>
          <div className="form-group">
            <label>Organization name</label>
            <input value={orgForm.orgName} onChange={e => setOrgForm({ ...orgForm, orgName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Allowed email domains (comma-separated)</label>
            <input
              value={orgForm.allowedDomains}
              onChange={e => setOrgForm({ ...orgForm, allowedDomains: e.target.value })}
              placeholder="yourcompany.com, warehouse.yourcompany.com"
              required
            />
            <p className="form-hint">Example: invite <code>picker@yourcompany.com</code> when domain is <code>yourcompany.com</code></p>
          </div>
          <div className="form-group">
            <label>Invitation expiry (days)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={orgForm.inviteExpiryDays}
              onChange={e => setOrgForm({ ...orgForm, inviteExpiryDays: Number(e.target.value) })}
              required
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save organization settings'}
            </button>
          </div>
        </form>
      )}

      <Modal open={inviteOpen} title="Invite user" onClose={() => setInviteOpen(false)}>
        <p className="page-subtitle" style={{ marginBottom: 16 }}>
          User will receive an invite link to set their password. Email must match an allowed domain
          {org ? `: ${org.allowedDomains.join(', ')}` : ''}.
        </p>
        {lastInviteLink && (
          <div className="alert alert-success" style={{ marginBottom: 16 }}>
            <div style={{ marginBottom: 8 }}>Share this link with the user:</div>
            <code style={{ wordBreak: 'break-all', fontSize: 12 }}>{lastInviteLink}</code>
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-outline" onClick={() => navigator.clipboard.writeText(lastInviteLink)}>
                Copy link
              </button>
            </div>
          </div>
        )}
        <form onSubmit={handleInvite}>
          <div className="form-group">
            <label>Display name</label>
            <input value={inviteForm.fullName} onChange={e => setInviteForm({ ...inviteForm, fullName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Work email</label>
            <input
              type="email"
              value={inviteForm.email}
              onChange={e => setInviteForm({ ...inviteForm, email: e.target.value })}
              placeholder={org ? `name@${org.allowedDomains[0]}` : 'name@yourcompany.com'}
              required
            />
          </div>
          <div className="form-group">
            <label>Assign roles (job function)</label>
            <div className="admin-role-checkboxes">
              {roles.map(role => (
                <label key={role.id} className="admin-role-check">
                  <input
                    type="checkbox"
                    checked={inviteForm.roleIds.includes(role.id)}
                    onChange={() => setInviteForm(f => ({ ...f, roleIds: toggleRoleId(f.roleIds, role.id) }))}
                  />
                  <span>
                    <strong>{role.name}</strong>
                    <span className="admin-role-check-desc">{role.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setInviteOpen(false)}>Close</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Sending...' : 'Send invitation'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={manageOpen} title={`Manage ${selectedUser?.full_name ?? 'user'}`} onClose={() => setManageOpen(false)}>
        <form onSubmit={handleManageSave}>
          <div className="form-group">
            <label>Display name</label>
            <input value={manageForm.fullName} onChange={e => setManageForm({ ...manageForm, fullName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input value={selectedUser?.email ?? ''} disabled />
          </div>
          <div className="form-group">
            <label>Status</label>
            <select value={manageForm.isActive ? 'active' : 'blocked'} onChange={e => setManageForm({ ...manageForm, isActive: e.target.value === 'active' })}>
              <option value="active">Active — can sign in</option>
              <option value="blocked">Blocked — sign-in disabled</option>
            </select>
          </div>
          <div className="form-group">
            <label>Assigned roles</label>
            <div className="admin-role-checkboxes">
              {roles.map(role => (
                <label key={role.id} className="admin-role-check">
                  <input
                    type="checkbox"
                    checked={manageForm.roleIds.includes(role.id)}
                    onChange={() => setManageForm(f => ({ ...f, roleIds: toggleRoleId(f.roleIds, role.id) }))}
                  />
                  <span>
                    <strong>{role.name}</strong>
                    <span className="admin-role-check-desc">{role.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label>Reset password (optional)</label>
            <input
              type="password"
              value={manageForm.password}
              onChange={e => setManageForm({ ...manageForm, password: e.target.value })}
              placeholder="Leave blank to keep current password"
              minLength={8}
            />
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setManageOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={createRoleOpen} title="Create role" onClose={() => setCreateRoleOpen(false)}>
        <form onSubmit={handleCreateRole}>
          <div className="form-group">
            <label>Role name</label>
            <input
              value={createRoleForm.name}
              onChange={e => setCreateRoleForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Regional Manager"
              required
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <input
              value={createRoleForm.description}
              onChange={e => setCreateRoleForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What this job function can do"
            />
          </div>
          <div className="form-group">
            <label>Permissions</label>
            {Object.entries(permissionsByModule).map(([module, perms]) => (
              <div key={module} className="admin-perm-module">
                <div className="admin-perm-module-title">{module}</div>
                <div className="admin-perm-grid">
                  {perms.map(p => {
                    const on = createRoleForm.permissionCodes.includes(p.code);
                    return (
                      <label key={p.id} className={`admin-perm-chip ${on ? 'admin-perm-chip-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setCreateRoleForm(f => ({
                            ...f,
                            permissionCodes: on
                              ? f.permissionCodes.filter(c => c !== p.code)
                              : [...f.permissionCodes, p.code],
                          }))}
                        />
                        <span>{p.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn btn-outline" onClick={() => setCreateRoleOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create role'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
