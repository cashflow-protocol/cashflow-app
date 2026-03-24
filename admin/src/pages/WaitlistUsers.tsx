import { useState, useEffect, useCallback } from 'react';
import { getWaitlistUsers, getUserScreenshots, revokeUserTask } from '../api';

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

interface Screenshot {
  taskId: string; // stores task _id
  imageUrl: string;
  uploadedAt: string;
}

export default function WaitlistUsersPage() {
  const [users, setUsers] = useState<WaitlistUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailUser, setDetailUser] = useState<WaitlistUser | null>(null);
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [screenshotsLoading, setScreenshotsLoading] = useState(false);

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

  const handleViewDetails = async (user: WaitlistUser) => {
    setDetailUser(user);
    setScreenshotsLoading(true);
    try {
      const data = await getUserScreenshots(user.id);
      setScreenshots(data.screenshots || []);
    } catch {
      setScreenshots([]);
    } finally {
      setScreenshotsLoading(false);
    }
  };

  const handleRevokeTask = async (userId: string, taskId: string) => {
    if (!confirm(`Revoke task "${taskId}"? This will deduct XP.`)) return;
    try {
      await revokeUserTask(userId, taskId);
      load();
      // Refresh detail view
      if (detailUser?.id === userId) {
        const data = await getWaitlistUsers(page, search);
        const updated = data.users.find((u: WaitlistUser) => u.id === userId);
        if (updated) setDetailUser(updated);
      }
    } catch (err) {
      console.error(err);
    }
  };

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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No users found</td></tr>
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
                <td>{u.completedTasks.length}</td>
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
                <td>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    onClick={() => handleViewDetails(u)}
                  >
                    Details
                  </button>
                </td>
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

      {/* User Detail Modal */}
      {detailUser && (
        <div className="modal-overlay" onClick={() => setDetailUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h3>User Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 14, marginBottom: 16 }}>
              <div><strong>Wallet:</strong> <span className="mono">{detailUser.publicKey.slice(0, 8)}...{detailUser.publicKey.slice(-6)}</span></div>
              <div><strong>XP:</strong> {detailUser.xp}</div>
              <div><strong>Email:</strong> {detailUser.email || '—'}</div>
              <div><strong>X:</strong> {detailUser.twitterHandle ? `@${detailUser.twitterHandle}` : '—'}</div>
              <div><strong>Discord:</strong> {detailUser.discordUsername || '—'}</div>
              <div><strong>Telegram:</strong> {detailUser.telegramUsername ? `@${detailUser.telegramUsername}` : '—'}</div>
              <div><strong>Solana Wallet:</strong> {detailUser.walletAddress ? <a href={`https://solscan.io/account/${detailUser.walletAddress}`} target="_blank" rel="noopener" className="mono">{detailUser.walletAddress.slice(0, 8)}...</a> : '—'}</div>
              <div><strong>Status:</strong> {detailUser.status} {detailUser.inviteCode ? `(${detailUser.inviteCode})` : ''}</div>
            </div>

            {/* Completed Tasks with Revoke */}
            <h4 style={{ marginBottom: 8 }}>Completed Tasks ({detailUser.completedTasks.length})</h4>
            {detailUser.completedTasks.length === 0 ? (
              <p style={{ color: '#999', fontSize: 14 }}>No completed tasks</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
                {detailUser.completedTasks.map((taskId) => (
                  <div key={taskId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', backgroundColor: '#f9f9f9', borderRadius: 6 }}>
                    <span className="mono" style={{ fontSize: 13 }}>{taskId}</span>
                    <button
                      className="btn-danger"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => handleRevokeTask(detailUser.id, taskId)}
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Screenshots */}
            <h4 style={{ marginBottom: 8 }}>Screenshots</h4>
            {screenshotsLoading ? (
              <p style={{ color: '#999', fontSize: 14 }}>Loading...</p>
            ) : screenshots.length === 0 ? (
              <p style={{ color: '#999', fontSize: 14 }}>No screenshots uploaded</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {screenshots.map((s, i) => (
                  <div key={i} style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}>
                    <a href={s.imageUrl} target="_blank" rel="noopener">
                      <img
                        src={s.imageUrl}
                        alt={s.taskId}
                        style={{ width: '100%', height: 150, objectFit: 'cover' }}
                      />
                    </a>
                    <div style={{ padding: '6px 8px', fontSize: 12 }}>
                      <div className="mono">{s.taskId}</div>
                      <div style={{ color: '#999' }}>{new Date(s.uploadedAt).toLocaleString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setDetailUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
