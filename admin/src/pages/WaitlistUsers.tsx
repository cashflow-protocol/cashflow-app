import { useState, useEffect, useCallback } from 'react';
import { getWaitlistUsers } from '../api';

interface WaitlistUser {
  id: string;
  publicKey: string;
  email: string | null;
  emailVerified: boolean;
  twitterHandle: string | null;
  discordUsername: string | null;
  telegramUsername: string | null;
  walletAddress: string | null;
  xp: number;
  rank: number;
  status: string;
  inviteCode: string | null;
  completedTasks: string[];
  createdAt: string;
}

export default function WaitlistUsersPage() {
  const [users, setUsers] = useState<WaitlistUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWaitlistUsers(page, search);
      setUsers(data.users);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="page-header">
        <h2>Waitlist Users ({total})</h2>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search by email, X handle, wallet..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Public Key</th>
              <th>Email</th>
              <th>X</th>
              <th>Discord</th>
              <th>Telegram</th>
              <th>Wallet</th>
              <th>XP</th>
              <th>Tasks</th>
              <th>Status</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No users found</td></tr>
            ) : users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>#{u.rank}</td>
                <td>
                  <span className="mono truncate" title={u.publicKey}>
                    {u.publicKey.slice(0, 6)}...{u.publicKey.slice(-4)}
                  </span>
                </td>
                <td>{u.email || <span style={{ color: '#ccc' }}>—</span>}</td>
                <td>
                  {u.twitterHandle
                    ? <a href={`https://x.com/${u.twitterHandle}`} target="_blank" rel="noopener">@{u.twitterHandle}</a>
                    : <span style={{ color: '#ccc' }}>—</span>
                  }
                </td>
                <td>{u.discordUsername || <span style={{ color: '#ccc' }}>—</span>}</td>
                <td>
                  {u.telegramUsername
                    ? <a href={`https://t.me/${u.telegramUsername}`} target="_blank" rel="noopener">@{u.telegramUsername}</a>
                    : <span style={{ color: '#ccc' }}>—</span>
                  }
                </td>
                <td>
                  {u.walletAddress
                    ? <a href={`https://solscan.io/account/${u.walletAddress}`} target="_blank" rel="noopener" className="mono truncate" title={u.walletAddress}>{u.walletAddress.slice(0, 6)}...{u.walletAddress.slice(-4)}</a>
                    : <span style={{ color: '#ccc' }}>—</span>
                  }
                </td>
                <td style={{ fontWeight: 600 }}>{u.xp}</td>
                <td>{u.completedTasks.length}/9</td>
                <td>
                  {u.status === 'approved' ? (
                    <span className="badge badge-green" title={`Code: ${u.inviteCode}`}>
                      Approved
                    </span>
                  ) : (
                    <span className="badge badge-yellow">Waiting</span>
                  )}
                </td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="pagination">
            <span>Page {page} of {pages}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <button className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
