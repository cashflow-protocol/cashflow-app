import { useState } from 'react';
import { isLoggedIn, setPassword, clearPassword, getEnv, setEnv, type Env } from './api';
import InviteCodesPage from './pages/InviteCodes';
import WaitlistUsersPage from './pages/WaitlistUsers';
import WaitlistTasksPage from './pages/WaitlistTasks';
import UsersPage from './pages/Users';

type Page = 'invite-codes' | 'waitlist-users' | 'waitlist-tasks' | 'users';

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pw.trim()) return;
    setPassword(pw.trim());
    setError('');
    onLogin();
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
        <button type="submit" className="btn-primary" style={{ marginTop: 16 }}>
          Login
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [page, setPage] = useState<Page>('invite-codes');
  const [env, setEnvState] = useState<Env>(getEnv());

  const handleEnvToggle = () => {
    const next = env === 'dev' ? 'prod' : 'dev';
    setEnv(next);
    setEnvState(next);
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
