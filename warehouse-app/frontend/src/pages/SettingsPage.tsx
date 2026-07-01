import { useState, FormEvent } from 'react';
import api, { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Alert } from '../components/UI';

export function SettingsPage() {
  const { user } = useAuth();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAlert(null);

    if (newPassword.length < 8) {
      setAlert({ type: 'error', message: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setAlert({ type: 'error', message: 'New passwords do not match.' });
      return;
    }

    setSaving(true);
    try {
      await api.put('/auth/change-password', { currentPassword, newPassword });
      setAlert({ type: 'success', message: 'Password updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setAlert({ type: 'error', message: getErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" subtitle="Manage your account and preferences" />
      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="settings-grid">
        <section className="settings-card">
          <h2 className="settings-card-title">Profile</h2>
          <dl className="settings-dl">
            <div className="settings-row">
              <dt>Name</dt>
              <dd>{user?.fullName}</dd>
            </div>
            <div className="settings-row">
              <dt>Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div className="settings-row">
              <dt>Role</dt>
              <dd>{user?.roles.join(', ') || '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="settings-card">
          <h2 className="settings-card-title">Security</h2>
          <p className="settings-card-desc">Update your password. You will stay signed in after changing it.</p>
          <form onSubmit={handlePasswordSubmit}>
            <div className="form-group">
              <label htmlFor="current-password">Current password</label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Update password'}
              </button>
            </div>
          </form>
        </section>

        <section className="settings-card">
          <h2 className="settings-card-title">About</h2>
          <dl className="settings-dl">
            <div className="settings-row">
              <dt>Application</dt>
              <dd>Warehouse Operations</dd>
            </div>
            <div className="settings-row">
              <dt>Version</dt>
              <dd>1.0.0</dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
