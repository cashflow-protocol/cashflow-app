import { useState, useEffect, useCallback } from 'react';
import { isLoggedIn, login, clearPassword, getEnv, setEnv, type Env } from './api';
import InviteCodesPage from './pages/InviteCodes';
import WaitlistUsersPage from './pages/WaitlistUsers';
import WaitlistTasksPage from './pages/WaitlistTasks';
import UsersPage from './pages/Users';

type Page = 'invite-codes' | 'waitlist-users' | 'waitlist-tasks' | 'users';

const PAGES: Page[] = ['invite-codes', 'waitlist-users', 'waitlist-tasks', 'users'];

function getPageFromPath(): Page {
  const path = window.location.pathname.replace(/^\//, '');
  return PAGES.includes(path as Page) ? (path as Page) : 'invite-codes';
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.trim()) return;
    setLoading(true);
    setError('');
    const result = await login(pw.trim());
    setLoading(false);
    if (result.success) {
      onLogin();
    } else {
      setError(result.error || 'Login failed');
    }
  };

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Cashflow Admin</h1>
        <p>Enter admin password to continue.</p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
        />
        {error && <p className="error-text">{error}</p>}
        <button type="submit" className="btn-primary" style={{ marginTop: 16 }} disabled={loading}>
          {loading ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [page, setPageState] = useState<Page>(getPageFromPath());
  const [env] = useState<Env>(getEnv());

  const setPage = useCallback((p: Page) => {
    window.history.pushState(null, '', `/${p}`);
    setPageState(p);
  }, []);

  useEffect(() => {
    const onPopState = () => setPageState(getPageFromPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleEnvToggle = () => {
    const next = env === 'dev' ? 'prod' : 'dev';
    setEnv(next);
    window.location.reload();
  };

  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Cashflow</h1>
          <span className="sidebar-subtitle">Admin</span>
        </div>

        <nav className="sidebar-nav">
          <button
            className={page === 'invite-codes' ? 'active' : ''}
            onClick={() => setPage('invite-codes')}
          >
            Invite Codes
          </button>
          <button
            className={page === 'waitlist-users' ? 'active' : ''}
            onClick={() => setPage('waitlist-users')}
          >
            Waitlist Users
          </button>
          <button
            className={page === 'waitlist-tasks' ? 'active' : ''}
            onClick={() => setPage('waitlist-tasks')}
          >
            Tasks
          </button>
          <button
            className={page === 'users' ? 'active' : ''}
            onClick={() => setPage('users')}
          >
            Users
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            className="env-badge"
            onClick={handleEnvToggle}
            data-env={env}
          >
            {env.toUpperCase()}
          </button>
          <button
            className="logout-btn"
            onClick={() => { clearPassword(); setLoggedIn(false); }}
          >
            Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        {page === 'invite-codes' && <InviteCodesPage />}
        {page === 'waitlist-users' && <WaitlistUsersPage />}
        {page === 'waitlist-tasks' && <WaitlistTasksPage />}
        {page === 'users' && <UsersPage />}
      </main>
    </div>
  );
}
