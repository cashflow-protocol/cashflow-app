import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { getEarnTokens, updateEarnTokenStatus, updateEarnTokenConfig } from '../api';
import MultiSelect from '../components/MultiSelect';

const VAULT_TYPES = ['jupiter', 'kamino', 'drift', 'perena', 'solomon', 'onre', 'huma'];

interface EarnToken {
  id: string;
  type: 'jupiter' | 'kamino' | 'drift' | 'perena' | 'solomon' | 'onre' | 'huma';
  vaultAddress: string;
  vaultTitle: string;
  mint: string;
  symbol: string;
  rewardsRate: number;
  status: 'active' | 'inactive';
  minDepositAmount: string;
  minWithdrawAmount: string;
  categories?: string[];
  poolSizeUi: number | null;
  poolSizeUsd: number | null;
  decimals: number;
  protocolIconUrl?: string;
  createdAt: string;
  updatedAt: string;
}

const TYPE_LOGO_URLS: Record<string, string> = {
  jupiter: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/jupiter.svg',
  kamino: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/kamino.svg',
  drift: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/drift.svg',
  perena: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/perena.jpg',
  solomon: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/solomon.png',
  onre: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/onre.jpg',
  huma: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/huma.png',
};

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  jupiter: { bg: '#e8f5e9', color: '#2e7d32' },
  kamino: { bg: '#e3f2fd', color: '#1565c0' },
  drift: { bg: '#fff3e0', color: '#e65100' },
  perena: { bg: '#f3e5f5', color: '#7b1fa2' },
  solomon: { bg: '#fce4ec', color: '#c62828' },
  onre: { bg: '#e0f2f1', color: '#00695c' },
  huma: { bg: '#ede7f6', color: '#4527a0' },
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

const selectStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #ddd',
  background: '#fff',
  fontSize: 14,
};

function formatCompact(num: number): string {
  if (num >= 1_000_000_000) return (num / 1_000_000_000).toFixed(2) + 'B';
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(2) + 'K';
  return num.toFixed(2);
}

export default function VaultsPage() {
  const [tokens, setTokens] = useState<EarnToken[]>([]);
  const [coins, setCoins] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [coinFilter, setCoinFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [minPoolSize, setMinPoolSize] = useState('');
  const [maxPoolSize, setMaxPoolSize] = useState('');
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Config edit modal
  const [editToken, setEditToken] = useState<EarnToken | null>(null);
  const [editVaultTitle, setEditVaultTitle] = useState('');
  const [editMinDeposit, setEditMinDeposit] = useState('');
  const [editMinWithdraw, setEditMinWithdraw] = useState('');
  const [editCategories, setEditCategories] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEarnTokens(page, search, {
        types: typeFilter,
        coins: coinFilter,
        status: statusFilter,
        minPoolSizeUsd: minPoolSize,
        maxPoolSizeUsd: maxPoolSize,
      });
      const sorted = (data.tokens || []).sort(
        (a: EarnToken, b: EarnToken) => (b.poolSizeUsd ?? 0) - (a.poolSizeUsd ?? 0),
      );
      setTokens(sorted);
      if (Array.isArray(data.coins)) setCoins(data.coins);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, typeFilter, coinFilter, statusFilter, minPoolSize, maxPoolSize]);

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
    setEditVaultTitle(token.vaultTitle);
    setEditMinDeposit(token.minDepositAmount);
    setEditMinWithdraw(token.minWithdrawAmount);
    setEditCategories((token.categories ?? []).join(', '));
  };

  const handleSaveConfig = async () => {
    if (!editToken) return;
    const vaultTitle = editVaultTitle.trim();
    if (vaultTitle.length === 0) {
      alert('Vault title cannot be empty');
      return;
    }
    setSaving(true);
    try {
      const categories = editCategories
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      await updateEarnTokenConfig(editToken.id, {
        vaultTitle,
        minDepositAmount: editMinDeposit,
        minWithdrawAmount: editMinWithdraw,
        categories,
      });
      setTokens((prev) =>
        prev.map((t) =>
          t.id === editToken.id
            ? {
                ...t,
                vaultTitle,
                minDepositAmount: editMinDeposit,
                minWithdrawAmount: editMinWithdraw,
                categories,
              }
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

      <div
        className="search-bar"
        style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
      >
        <input
          placeholder="Search by symbol, vault address, title, or mint..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          style={{ flex: '1 1 240px', minWidth: 220 }}
        />
        <MultiSelect
          label="Types"
          options={VAULT_TYPES}
          selected={typeFilter}
          onChange={(next) => { setTypeFilter(next); setPage(1); }}
          formatOption={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
        />
        <MultiSelect
          label="Coins"
          options={coins}
          selected={coinFilter}
          onChange={(next) => { setCoinFilter(next); setPage(1); }}
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          style={selectStyle}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <input
          type="number"
          inputMode="decimal"
          placeholder="Min pool $"
          value={minPoolSize}
          onChange={(e) => { setMinPoolSize(e.target.value); setPage(1); }}
          style={{ ...selectStyle, width: 120 }}
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Max pool $"
          value={maxPoolSize}
          onChange={(e) => { setMaxPoolSize(e.target.value); setPage(1); }}
          style={{ ...selectStyle, width: 120 }}
        />
        {(typeFilter.length || coinFilter.length || statusFilter || minPoolSize || maxPoolSize || search) ? (
          <button
            className="btn-secondary"
            onClick={() => {
              setSearch('');
              setTypeFilter([]);
              setCoinFilter([]);
              setStatusFilter('');
              setMinPoolSize('');
              setMaxPoolSize('');
              setPage(1);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Vault Address</th>
              <th>Coin</th>
              <th>Name</th>
              <th>Pool Size</th>
              <th>Reward Rate</th>
              <th>Status</th>
              <th>Config</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : tokens.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No vaults found</td></tr>
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
                    <img
                      src={t.protocolIconUrl || TYPE_LOGO_URLS[t.type]}
                      alt={t.type}
                      style={{ width: 16, height: 16, borderRadius: 4, verticalAlign: 'middle', marginRight: 4 }}
                    />
                    {t.type}
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
                <td style={{ fontSize: 13, color: '#555' }}>
                  {t.vaultTitle || '—'}
                </td>
                <td>
                  <span style={{ fontWeight: 500 }}>
                    {t.poolSizeUsd != null && t.poolSizeUsd > 0
                      ? `$${formatCompact(t.poolSizeUsd)} (${formatCompact(t.poolSizeUi ?? 0)} ${t.symbol})`
                      : '—'}
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
                <img
                  src={editToken.protocolIconUrl || TYPE_LOGO_URLS[editToken.type]}
                  alt={editToken.type}
                  style={{ width: 16, height: 16, borderRadius: 4, verticalAlign: 'middle', marginRight: 4 }}
                />
                {editToken.type}
              </span>
              <strong>{editToken.symbol}</strong> &mdash; {editToken.vaultTitle}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Vault Title
                <input
                  value={editVaultTitle}
                  onChange={(e) => setEditVaultTitle(e.target.value)}
                  placeholder="e.g. Huma - Classic (No Lockup)"
                  style={{ marginTop: 4 }}
                />
              </label>
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
              <label style={{ fontSize: 13, fontWeight: 600 }}>
                Categories (comma-separated)
                <input
                  value={editCategories}
                  onChange={(e) => setEditCategories(e.target.value)}
                  placeholder="e.g. yield-stable, lending"
                  style={{ marginTop: 4 }}
                />
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, fontWeight: 400, color: '#666' }}>
                  Drives mobile filters (e.g. <code>yield-stable</code> → Yield Stables tab).
                </span>
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
