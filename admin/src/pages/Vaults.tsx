import { useState, useEffect, useCallback } from 'react';
import { getEarnTokens, updateEarnTokenStatus, updateEarnTokenConfig } from '../api';

interface EarnToken {
  id: string;
  type: 'jupiter' | 'kamino' | 'drift';
  vaultAddress: string;
  vaultTitle: string;
  mint: string;
  symbol: string;
  rewardsRate: number;
  status: 'active' | 'inactive';
  minDepositAmount: string;
  minWithdrawAmount: string;
  poolSize: string | null;
  decimals: number;
  createdAt: string;
  updatedAt: string;
}

const TYPE_ICONS: Record<string, string> = {
  jupiter: '\u2643',   // ♃
  kamino: '\u25C6',    // ◆
  drift: '\u2248',     // ≈
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  jupiter: { bg: '#e8f5e9', color: '#2e7d32' },
  kamino: { bg: '#e3f2fd', color: '#1565c0' },
  drift: { bg: '#fff3e0', color: '#e65100' },
};

function shortenAddress(addr: string) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function solscanAccount(addr: string) {
  return `https://solscan.io/account/${addr}`;
}

function solscanToken(mint: string) {
  return `https://solscan.io/token/${mint}`;
}

function formatPoolSize(raw: string | null, decimals: number): string {
  if (!raw || raw === '0') return '—';
  const num = Number(raw) / 10 ** decimals;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

export default function VaultsPage() {
  const [tokens, setTokens] = useState<EarnToken[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Config edit modal
  const [editToken, setEditToken] = useState<EarnToken | null>(null);
  const [editMinDeposit, setEditMinDeposit] = useState('');
  const [editMinWithdraw, setEditMinWithdraw] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEarnTokens(page, search, typeFilter);
      setTokens(data.tokens);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleToggleStatus = async (token: EarnToken) => {
    const newStatus = token.status === 'active' ? 'inactive' : 'active';
    if (!confirm(`Set "${token.vaultTitle}" (${token.symbol}) to ${newStatus}?`)) return;
    setTogglingId(token.id);
    try {
      await updateEarnTokenStatus(token.id, newStatus);
      setTokens((prev) => prev.map((t) => t.id === token.id ? { ...t, status: newStatus } : t));
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingId(null);
    }
  };

  const openConfigModal = (token: EarnToken) => {
    setEditToken(token);
    setEditMinDeposit(token.minDepositAmount);
    setEditMinWithdraw(token.minWithdrawAmount);
  };

  const handleSaveConfig = async () => {
    if (!editToken) return;
    setSaving(true);
    try {
      await updateEarnTokenConfig(editToken.id, {
        minDepositAmount: editMinDeposit,
        minWithdrawAmount: editMinWithdraw,
      });
      setTokens((prev) =>
        prev.map((t) =>
          t.id === editToken.id
            ? { ...t, minDepositAmount: editMinDeposit, minWithdrawAmount: editMinWithdraw }
            : t,
        ),
      );
      setEditToken(null);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Vaults ({total})</h2>
      </div>

      <div className="search-bar" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          placeholder="Search by symbol, vault address, title, or mint..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #ddd',
            background: '#fff',
            fontSize: 14,
          }}
        >
          <option value="">All Types</option>
          <option value="jupiter">Jupiter</option>
          <option value="kamino">Kamino</option>
          <option value="drift">Drift</option>
        </select>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Vault Address</th>
              <th>Coin</th>
              <th>Pool Size</th>
              <th>Reward Rate</th>
              <th>Status</th>
              <th>Config</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : tokens.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No vaults found</td></tr>
            ) : tokens.map((t) => (
              <tr key={t.id}>
                <td>
                  <span
                    className="badge"
                    style={{
                      background: TYPE_COLORS[t.type]?.bg || '#f5f5f5',
                      color: TYPE_COLORS[t.type]?.color || '#333',
                      fontWeight: 600,
                    }}
                  >
                    {TYPE_ICONS[t.type] || '?'} {t.type}
                  </span>
                </td>
                <td>
                  <a
                    href={solscanAccount(t.vaultAddress)}
                    target="_blank"
                    rel="noopener"
                    className="mono truncate"
                    title={t.vaultAddress}
                  >
                    {shortenAddress(t.vaultAddress)}
                  </a>
                </td>
                <td>
                  <a
                    href={solscanToken(t.mint)}
                    target="_blank"
                    rel="noopener"
                    title={t.mint}
                    style={{ textDecoration: 'none' }}
                  >
                    <strong>{t.symbol}</strong>
                  </a>
                </td>
                <td>
                  <span style={{ fontWeight: 500 }}>
                    {formatPoolSize(t.poolSize, t.decimals)} {t.symbol}
                  </span>
                </td>
                <td>
                  <span style={{ fontWeight: 600, color: '#2e7d32' }}>
                    {(t.rewardsRate / 10000 * 100).toFixed(2)}%
                  </span>
                </td>
                <td>
                  <button
                    onClick={() => handleToggleStatus(t)}
                    disabled={togglingId === t.id}
                    className="badge"
                    style={{
                      cursor: 'pointer',
                      border: 'none',
                      fontWeight: 600,
                      background: t.status === 'active' ? '#e8f5e9' : '#ffebee',
                      color: t.status === 'active' ? '#2e7d32' : '#c62828',
                    }}
                    title={`Click to ${t.status === 'active' ? 'deactivate' : 'activate'}`}
                  >
                    {togglingId === t.id ? '...' : t.status === 'active' ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td style={{ fontSize: 13 }}>
                  <span style={{ color: '#666' }}>
                    Min Dep: {t.minDepositAmount || '0'} &middot; Min Wdw: {t.minWithdrawAmount || '0'}
                  </span>
                </td>
                <td>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => openConfigModal(t)}
                  >
                    Edit
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

      {/* Edit Config Modal */}
      {editToken && (
        <div className="modal-overlay" onClick={() => setEditToken(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3>Edit Config</h3>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
              <span
                className="badge"
                style={{
                  background: TYPE_COLORS[editToken.type]?.bg,
                  color: TYPE_COLORS[editToken.type]?.color,
                  marginRight: 8,
                }}
              >
                {TYPE_ICONS[editToken.type]} {editToken.type}
              </span>
              <strong>{editToken.symbol}</strong> &mdash; {editToken.vaultTitle}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Min Deposit Amount (raw)
                <input
                  value={editMinDeposit}
                  onChange={(e) => setEditMinDeposit(e.target.value)}
                  placeholder="0"
                  style={{ marginTop: 4 }}
                />
              </label>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Min Withdraw Amount (raw)
                <input
                  value={editMinWithdraw}
                  onChange={(e) => setEditMinWithdraw(e.target.value)}
                  placeholder="0"
                  style={{ marginTop: 4 }}
                />
              </label>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setEditToken(null)}>Cancel</button>
              <button className="btn-primary" disabled={saving} onClick={handleSaveConfig}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
