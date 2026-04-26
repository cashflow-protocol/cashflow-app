import { useState, useEffect, useCallback } from 'react';
import {
  getAppUsers,
  sendUserNotification,
  broadcastNotification,
  backfillUserVaultAddress,
  rebuildUserCostBasis,
  type BackfillUserVaultReport,
  type RebuildCostBasisReport,
} from '../api';

type MaintenanceReport =
  | { kind: 'backfill'; report: BackfillUserVaultReport }
  | { kind: 'rebuild'; report: RebuildCostBasisReport };

interface SquadMember {
  address: string;
  permissions: { initiate: boolean; vote: boolean; execute: boolean };
}

interface SquadInfo {
  multisigAddress: string;
  threshold: number;
  members: SquadMember[];
}

interface AppUser {
  id: string;
  vaultAddress: string;
  publicKey: string;
  lastSeenAt: string;
  inviteCode: string | null;
  hasPush: boolean;
  createdAt: string;
  squad: SquadInfo | null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Send notification modal
  const [notifyUser, setNotifyUser] = useState<AppUser | null>(null);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyBody, setNotifyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');

  // Squad members modal
  const [squadUser, setSquadUser] = useState<AppUser | null>(null);

  // Maintenance ops
  const [maintenanceRunning, setMaintenanceRunning] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState('');
  const [maintenanceReport, setMaintenanceReport] = useState<MaintenanceReport | null>(null);

  const runMaintenance = async (
    op: 'backfill-dry' | 'backfill-apply' | 'rebuild-dry' | 'rebuild-apply',
  ) => {
    const isApply = op.endsWith('-apply');
    if (isApply && !confirm(
      op === 'backfill-apply'
        ? 'Apply backfill? This will write userVaultAddress on matched deposit/withdraw transactions.'
        : 'Rebuild UserCostBasis? This overwrites cost basis from confirmed transactions. Run during low traffic.',
    )) return;

    setMaintenanceRunning(op);
    setMaintenanceError('');
    setMaintenanceReport(null);
    try {
      if (op.startsWith('backfill')) {
        const res = await backfillUserVaultAddress(!isApply);
        if (!res.success) throw new Error(res.error || 'Backfill failed');
        setMaintenanceReport({ kind: 'backfill', report: res.report });
      } else {
        const res = await rebuildUserCostBasis(!isApply);
        if (!res.success) throw new Error(res.error || 'Rebuild failed');
        setMaintenanceReport({ kind: 'rebuild', report: res.report });
      }
    } catch (err) {
      setMaintenanceError((err as Error).message || 'Operation failed');
    } finally {
      setMaintenanceRunning(null);
    }
  };

  // Broadcast modal
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAppUsers(page, search);
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

  const handleSendNotification = async () => {
    if (!notifyUser || !notifyTitle.trim()) return;
    setSending(true);
    setSendResult('');
    try {
      await sendUserNotification(notifyUser.id, notifyTitle.trim(), notifyBody.trim() || undefined);
      setSendResult('Notification sent!');
      setNotifyTitle('');
      setNotifyBody('');
      setTimeout(() => setNotifyUser(null), 1000);
    } catch (err) {
      setSendResult('Failed to send notification');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const handleBroadcast = async () => {
    if (!broadcastTitle.trim()) return;
    if (!confirm(`Send notification to ALL ${total} users?`)) return;
    setSending(true);
    setSendResult('');
    try {
      const res = await broadcastNotification(broadcastTitle.trim(), broadcastBody.trim() || undefined);
      setSendResult(`Sent to ${res.sent}/${res.total} users`);
      setBroadcastTitle('');
      setBroadcastBody('');
      setTimeout(() => { setShowBroadcast(false); setSendResult(''); }, 2000);
    } catch (err) {
      setSendResult('Failed to broadcast');
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const timeAgo = (d: string) => {
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div>
      <div className="page-header">
        <h2>App Users ({total})</h2>
        <button className="btn-primary" onClick={() => { setShowBroadcast(true); setSendResult(''); }}>
          Broadcast to All
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: '#666', alignSelf: 'center', marginRight: 4 }}>
          Backfill userVaultAddress:
        </span>
        <button
          className="btn-secondary"
          onClick={() => runMaintenance('backfill-dry')}
          disabled={!!maintenanceRunning}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {maintenanceRunning === 'backfill-dry' ? 'Running…' : 'Dry run'}
        </button>
        <button
          className="btn-primary"
          onClick={() => runMaintenance('backfill-apply')}
          disabled={!!maintenanceRunning}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {maintenanceRunning === 'backfill-apply' ? 'Running…' : 'Apply'}
        </button>

        <span style={{ fontSize: 12, color: '#666', alignSelf: 'center', marginLeft: 16, marginRight: 4 }}>
          Rebuild cost basis:
        </span>
        <button
          className="btn-secondary"
          onClick={() => runMaintenance('rebuild-dry')}
          disabled={!!maintenanceRunning}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {maintenanceRunning === 'rebuild-dry' ? 'Running…' : 'Dry run'}
        </button>
        <button
          className="btn-primary"
          onClick={() => runMaintenance('rebuild-apply')}
          disabled={!!maintenanceRunning}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {maintenanceRunning === 'rebuild-apply' ? 'Running…' : 'Apply'}
        </button>
        {maintenanceError && (
          <span style={{ color: '#e53e3e', fontSize: 12, alignSelf: 'center', marginLeft: 8 }}>
            {maintenanceError}
          </span>
        )}
      </div>

      <div className="search-bar">
        <input
          placeholder="Search by vault address or public key..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Vault Address</th>
              <th>Public Key</th>
              <th>Members</th>
              <th>Invite Code</th>
              <th>Push</th>
              <th>Last Seen</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No users found</td></tr>
            ) : users.map((u) => (
              <tr key={u.id}>
                <td>
                  <a
                    href={`https://solscan.io/account/${u.vaultAddress}`}
                    target="_blank"
                    rel="noopener"
                    className="mono truncate"
                    title={u.vaultAddress}
                  >
                    {u.vaultAddress.slice(0, 6)}...{u.vaultAddress.slice(-4)}
                  </a>
                </td>
                <td>
                  <span className="mono truncate" title={u.publicKey}>
                    {u.publicKey.slice(0, 6)}...{u.publicKey.slice(-4)}
                  </span>
                </td>
                <td>
                  {u.squad ? (
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => setSquadUser(u)}
                      title={`Threshold ${u.squad.threshold} of ${u.squad.members.length}`}
                    >
                      {u.squad.members.length} ({u.squad.threshold}/{u.squad.members.length})
                    </button>
                  ) : (
                    <span style={{ color: '#ccc' }}>—</span>
                  )}
                </td>
                <td>
                  {u.inviteCode
                    ? <span className="mono">{u.inviteCode}</span>
                    : <span style={{ color: '#ccc' }}>—</span>
                  }
                </td>
                <td>
                  {u.hasPush
                    ? <span className="badge badge-green">On</span>
                    : <span className="badge" style={{ background: '#e0e0e0', color: '#999' }}>Off</span>
                  }
                </td>
                <td title={formatDate(u.lastSeenAt)}>{timeAgo(u.lastSeenAt)}</td>
                <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    className="btn-primary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => { setNotifyUser(u); setSendResult(''); setNotifyTitle(''); setNotifyBody(''); }}
                  >
                    Send Notification
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

      {/* Maintenance Report Modal */}
      {maintenanceReport && (
        <div className="modal-overlay" onClick={() => setMaintenanceReport(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>
              {maintenanceReport.kind === 'backfill' ? 'Backfill userVaultAddress' : 'Rebuild UserCostBasis'}
              {' '}({maintenanceReport.report.dryRun ? 'dry run' : 'applied'})
            </h3>
            {maintenanceReport.kind === 'backfill' ? (
              <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                <div>Mapping sources: <strong>{maintenanceReport.report.mappingSourceCount}</strong></div>
                <div>Scanned (deposit/withdraw, missing field): <strong>{maintenanceReport.report.scanned}</strong></div>
                <div>
                  Mapped: <strong>{maintenanceReport.report.mapped}</strong>
                  {maintenanceReport.report.dryRun ? ' (would update)' : ' (updated)'}
                </div>
                <div>Unmapped: <strong>{maintenanceReport.report.unmapped}</strong></div>
                {maintenanceReport.report.unmappedSample.length > 0 && (
                  <>
                    <div style={{ marginTop: 12, fontWeight: 600 }}>Top unmapped walletAddress values:</div>
                    <div className="table-container" style={{ maxHeight: 280, overflowY: 'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Address</th>
                            <th style={{ width: 80, textAlign: 'right' }}>Tx count</th>
                          </tr>
                        </thead>
                        <tbody>
                          {maintenanceReport.report.unmappedSample.map((u) => (
                            <tr key={u.address}>
                              <td>
                                <a
                                  href={`https://solscan.io/account/${u.address}`}
                                  target="_blank"
                                  rel="noopener"
                                  className="mono truncate"
                                  title={u.address}
                                >
                                  {u.address.slice(0, 6)}...{u.address.slice(-4)}
                                </a>
                              </td>
                              <td style={{ textAlign: 'right' }}>{u.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 14, lineHeight: 1.7 }}>
                <div>Deposits scanned: <strong>{maintenanceReport.report.totalDepositsScanned}</strong></div>
                <div>Withdrawals scanned: <strong>{maintenanceReport.report.totalWithdrawalsScanned}</strong></div>
                <div>Skipped (still missing userVaultAddress): <strong>{maintenanceReport.report.ignoredMissingVault}</strong></div>
                <div style={{ marginTop: 8 }}>(vault, mint) keys: <strong>{maintenanceReport.report.aggregatedKeys}</strong></div>
                <div>
                  Would create: <strong>{maintenanceReport.report.wouldCreate}</strong>
                  {!maintenanceReport.report.dryRun && ' (created)'}
                </div>
                <div>
                  Would update: <strong>{maintenanceReport.report.wouldUpdate}</strong>
                  {!maintenanceReport.report.dryRun && ' (updated)'}
                </div>
                <div>Unchanged: <strong>{maintenanceReport.report.unchanged}</strong></div>
              </div>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setMaintenanceReport(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Squad Members Modal */}
      {squadUser && squadUser.squad && (
        <div className="modal-overlay" onClick={() => setSquadUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h3>Squad Members</h3>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>
              Vault:{' '}
              <a
                href={`https://solscan.io/account/${squadUser.vaultAddress}`}
                target="_blank"
                rel="noopener"
                className="mono"
              >
                {squadUser.vaultAddress.slice(0, 8)}...{squadUser.vaultAddress.slice(-6)}
              </a>
            </p>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
              Multisig:{' '}
              <a
                href={`https://solscan.io/account/${squadUser.squad.multisigAddress}`}
                target="_blank"
                rel="noopener"
                className="mono"
              >
                {squadUser.squad.multisigAddress.slice(0, 8)}...{squadUser.squad.multisigAddress.slice(-6)}
              </a>
              {' · '}
              Threshold {squadUser.squad.threshold} of {squadUser.squad.members.length}
            </p>
            <div className="table-container" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  {squadUser.squad.members.map((m) => (
                    <tr key={m.address}>
                      <td>
                        <a
                          href={`https://solscan.io/account/${m.address}`}
                          target="_blank"
                          rel="noopener"
                          className="mono truncate"
                          title={m.address}
                        >
                          {m.address.slice(0, 6)}...{m.address.slice(-4)}
                        </a>
                      </td>
                      <td style={{ display: 'flex', gap: 4 }}>
                        {m.permissions.initiate && <span className="badge badge-green">Initiate</span>}
                        {m.permissions.vote && <span className="badge badge-green">Vote</span>}
                        {m.permissions.execute && <span className="badge badge-green">Execute</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setSquadUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Send Notification Modal */}
      {notifyUser && (
        <div className="modal-overlay" onClick={() => setNotifyUser(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3>Send Notification</h3>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
              To: <span className="mono">{notifyUser.vaultAddress.slice(0, 8)}...{notifyUser.vaultAddress.slice(-6)}</span>
              {!notifyUser.hasPush && (
                <span style={{ color: '#e53e3e', marginLeft: 8 }}>(no push token — in-app only)</span>
              )}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                placeholder="Title (required)"
                value={notifyTitle}
                onChange={(e) => setNotifyTitle(e.target.value)}
                autoFocus
              />
              <textarea
                placeholder="Body (optional)"
                value={notifyBody}
                onChange={(e) => setNotifyBody(e.target.value)}
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            {sendResult && (
              <p style={{ marginTop: 12, color: sendResult.includes('Failed') ? '#e53e3e' : '#28a745', fontWeight: 600 }}>
                {sendResult}
              </p>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setNotifyUser(null)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={!notifyTitle.trim() || sending}
                onClick={handleSendNotification}
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Broadcast Modal */}
      {showBroadcast && (
        <div className="modal-overlay" onClick={() => setShowBroadcast(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3>Broadcast Notification</h3>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 16 }}>
              This will send a notification to <strong>all {total} users</strong>.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                placeholder="Title (required)"
                value={broadcastTitle}
                onChange={(e) => setBroadcastTitle(e.target.value)}
                autoFocus
              />
              <textarea
                placeholder="Body (optional)"
                value={broadcastBody}
                onChange={(e) => setBroadcastBody(e.target.value)}
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            {sendResult && (
              <p style={{ marginTop: 12, color: sendResult.includes('Failed') ? '#e53e3e' : '#28a745', fontWeight: 600 }}>
                {sendResult}
              </p>
            )}
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setShowBroadcast(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={!broadcastTitle.trim() || sending}
                onClick={handleBroadcast}
                style={{ background: '#e53e3e' }}
              >
                {sending ? 'Sending...' : 'Broadcast to All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
