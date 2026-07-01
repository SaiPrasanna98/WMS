import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api, { getErrorMessage } from '../api/client';

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<{
    email: string;
    fullName: string;
    roles: Array<{ name: string }>;
    orgName: string;
  } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link');
      setLoading(false);
      return;
    }
    api.get(`/invitations/verify?token=${encodeURIComponent(token)}`)
      .then(res => setInvite(res.data))
      .catch(err => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.post('/invitations/accept', { token, password });
      navigate('/login', { state: { message: 'Account created. Sign in with your new password.' } });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="login-page"><div className="login-card">Loading invitation...</div></div>;

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 440 }}>
        <h1>Join {invite?.orgName ?? 'Warehouse'}</h1>
        {error && !invite ? (
          <>
            <p className="alert alert-error">{error}</p>
            <Link to="/login" className="btn btn-primary" style={{ display: 'inline-block', marginTop: 16 }}>Back to sign in</Link>
          </>
        ) : invite ? (
          <>
            <p className="page-subtitle" style={{ marginBottom: 20 }}>
              {invite.fullName} · {invite.email}<br />
              Roles: {invite.roles.map(r => r.name).join(', ')}
            </p>
            {error && <p className="alert alert-error">{error}</p>}
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Create password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
              </div>
              <div className="form-group">
                <label>Confirm password</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} minLength={8} required />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
                {submitting ? 'Creating account...' : 'Accept invitation'}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
