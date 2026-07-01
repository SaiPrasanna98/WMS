import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../api/client';
import { getDefaultRoute } from '../utils/routing';

const DEMO_PASSWORD = 'password123';
const DEFAULT_DEMO_EMAIL = 'admin@demo.com';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const signIn = async (loginEmail: string, loginPassword: string) => {
    setError('');
    setLoading(true);
    try {
      const loggedInUser = await login(loginEmail, loginPassword);
      navigate(getDefaultRoute(loggedInUser.permissions));
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signIn(email, password);
  };

  const handleDemoLogin = () => {
    signIn(DEFAULT_DEMO_EMAIL, DEMO_PASSWORD);
  };

  return (
    <div className="login-page">
      <div className="login-container login-container-compact">
        <div className="login-header">
          <div className="brand-mark login-brand-mark">W</div>
          <h1>Warehouse</h1>
          <p>Sign in to continue</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="demo-hint">
          <button
            type="button"
            className="btn btn-outline btn-block"
            disabled={loading}
            onClick={handleDemoLogin}
          >
            Try demo (Admin)
          </button>
          <p className="demo-hint-text">
            Demo password for all roles: <strong>password123</strong>
          </p>
        </div>
      </div>
    </div>
  );
}
