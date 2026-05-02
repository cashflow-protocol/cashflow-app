import { useState, useEffect, useCallback } from 'react';
import { getErrorLogs, type ErrorLogEntry, type ErrorSeverity, type ErrorSourceValue } from '../api';

const SEVERITY_OPTIONS: Array<'' | ErrorSeverity> = ['', 'expected', 'unexpected', 'critical'];
const SOURCE_OPTIONS: Array<'' | ErrorSourceValue> = ['', 'backend', 'mobile'];

const SEVERITY_BADGE_STYLE: Record<ErrorSeverity, React.CSSProperties> = {
  expected: { background: '#e0e7ff', color: '#3730a3' },
  unexpected: { background: '#fed7aa', color: '#9a3412' },
  critical: { background: '#fecaca', color: '#991b1b' },
};

const SOURCE_BADGE_STYLE: Record<ErrorSourceValue, React.CSSProperties> = {
  backend: { background: '#e5e7eb', color: '#374151' },
  mobile: { background: '#dcfce7', color: '#166534' },
};

interface Filters {
  severity: '' | ErrorSeverity;
  source: '' | ErrorSourceValue;
  route: string;
  errorName: string;
  statusCode: string;
  userId: string;
  vaultAddress: string;
  publicKey: string;
  since: string;
}

const EMPTY_FILTERS: Filters = {
  severity: '',
  source: '',
  route: '',
  errorName: '',
  statusCode: '',
  userId: '',
  vaultAddress: '',
  publicKey: '',
  since: '',
};

function formatDate(d: string): string {
  const date = new Date(d);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function timeAgo(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncateMiddle(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

export default function ErrorsPage() {
  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [activeFilters, setActiveFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<ErrorLogEntry | null>(null);

  const load = useCallback(async (filters: Filters) => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await getErrorLogs({
        severity: filters.severity || undefined,
        source: filters.source || undefined,
        route: filters.route || undefined,
        errorName: filters.errorName || undefined,
        statusCode: filters.statusCode || undefined,
        userId: filters.userId || undefined,
        vaultAddress: filters.vaultAddress || undefined,
        publicKey: filters.publicKey || undefined,
        since: filters.since || undefined,
        limit: 50,
      });
      if (!res.success) throw new Error(res.error || 'Failed to load errors');
      setErrors(res.errors);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setLoadError((err as Error).message || 'Failed to load errors');
      setErrors([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(activeFilters); }, [load, activeFilters]);

  const applyFilters = () => setActiveFilters(draftFilters);
  const clearFilters = () => {
    setDraftFilters(EMPTY_FILTERS);
    setActiveFilters(EMPTY_FILTERS);
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await getErrorLogs({
        severity: activeFilters.severity || undefined,
        source: activeFilters.source || undefined,
        route: activeFilters.route || undefined,
        errorName: activeFilters.errorName || undefined,
        statusCode: activeFilters.statusCode || undefined,
        userId: activeFilters.userId || undefined,
        vaultAddress: activeFilters.vaultAddress || undefined,
        publicKey: activeFilters.publicKey || undefined,
        since: activeFilters.since || undefined,
        cursor: nextCursor,
        limit: 50,
      });
      if (res.success) {
        setErrors((prev) => [...prev, ...res.errors]);
        setNextCursor(res.nextCursor);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Errors</h2>
        <button className="btn-secondary" onClick={() => load(activeFilters)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <select
          value={draftFilters.severity}
          onChange={(e) => setDraftFilters({ ...draftFilters, severity: e.target.value as '' | ErrorSeverity })}
        >
          {SEVERITY_OPTIONS.map((s) => (
            <option key={s || 'all-severity'} value={s}>
              {s ? s : 'All severities'}
            </option>
          ))}
        </select>
        <select
          value={draftFilters.source}
          onChange={(e) => setDraftFilters({ ...draftFilters, source: e.target.value as '' | ErrorSourceValue })}
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s || 'all-source'} value={s}>
              {s ? s : 'All sources'}
            </option>
          ))}
        </select>
        <input
          placeholder="Route (e.g. /solana/v2)"
          value={draftFilters.route}
          onChange={(e) => setDraftFilters({ ...draftFilters, route: e.target.value })}
        />
        <input
          placeholder="Error name (e.g. TypeError)"
          value={draftFilters.errorName}
          onChange={(e) => setDraftFilters({ ...draftFilters, errorName: e.target.value })}
        />
        <input
          placeholder="Status code (e.g. 500)"
          value={draftFilters.statusCode}
          onChange={(e) => setDraftFilters({ ...draftFilters, statusCode: e.target.value })}
        />
        <input
          placeholder="User ID"
          value={draftFilters.userId}
          onChange={(e) => setDraftFilters({ ...draftFilters, userId: e.target.value })}
        />
        <input
          placeholder="Vault address"
          value={draftFilters.vaultAddress}
          onChange={(e) => setDraftFilters({ ...draftFilters, vaultAddress: e.target.value })}
        />
        <input
          placeholder="Public key"
          value={draftFilters.publicKey}
          onChange={(e) => setDraftFilters({ ...draftFilters, publicKey: e.target.value })}
        />
        <input
          type="datetime-local"
          value={draftFilters.since}
          onChange={(e) => setDraftFilters({ ...draftFilters, since: e.target.value ? new Date(e.target.value).toISOString() : '' })}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn-primary" onClick={applyFilters}>Apply filters</button>
        <button className="btn-secondary" onClick={clearFilters}>Clear</button>
      </div>

      {loadError && (
        <p className="error-text" style={{ marginBottom: 12 }}>{loadError}</p>
      )}

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>Source</th>
              <th style={{ width: 110 }}>Severity</th>
              <th style={{ width: 80 }}>Status</th>
              <th>Route</th>
              <th>Error</th>
              <th>User</th>
              <th style={{ width: 110 }}>When</th>
              <th style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>Loading…</td></tr>
            ) : errors.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No errors found</td></tr>
            ) : errors.map((e) => (
              <tr key={e._id}>
                <td>
                  <span className="badge" style={SOURCE_BADGE_STYLE[e.source]}>{e.source}</span>
                </td>
                <td>
                  <span className="badge" style={SEVERITY_BADGE_STYLE[e.severity]}>{e.severity}</span>
                </td>
                <td><span className="mono">{e.statusCode}</span></td>
                <td>
                  <span className="mono" style={{ fontSize: 12 }}>
                    <strong>{e.method}</strong> {e.route}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13 }} className="truncate" title={e.errorMessage}>
                      {e.errorMessage}
                    </span>
                    {(e.errorName || e.errorCode) && (
                      <span style={{ fontSize: 11, color: '#666' }}>
                        {e.errorName}{e.errorName && e.errorCode ? ' · ' : ''}{e.errorCode}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {e.vaultAddress ? (
                    <span className="mono" title={e.vaultAddress} style={{ fontSize: 12 }}>
                      {truncateMiddle(e.vaultAddress)}
                    </span>
                  ) : e.publicKey ? (
                    <span className="mono" title={e.publicKey} style={{ fontSize: 12 }}>
                      {truncateMiddle(e.publicKey)}
                    </span>
                  ) : (
                    <span style={{ color: '#ccc' }}>—</span>
                  )}
                </td>
                <td title={formatDate(e.createdAt)}>{timeAgo(e.createdAt)}</td>
                <td>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => setSelected(e)}
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {nextCursor && !loading && (
          <div className="pagination">
            <span>{errors.length} loaded</span>
            <button className="btn-secondary" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {selected && <ErrorDetailModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ErrorDetailModal({ entry, onClose }: { entry: ErrorLogEntry; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(ev) => ev.stopPropagation()}
        style={{ maxWidth: 820, maxHeight: '85vh', overflowY: 'auto' }}
      >
        <h3 style={{ marginBottom: 4 }}>
          <span className="badge" style={{ ...SOURCE_BADGE_STYLE[entry.source], marginRight: 6 }}>
            {entry.source}
          </span>
          <span className="badge" style={{ ...SEVERITY_BADGE_STYLE[entry.severity], marginRight: 8 }}>
            {entry.severity}
          </span>
          <span className="mono">{entry.method} {entry.route}</span>
          {' · '}
          <span className="mono">{entry.statusCode}</span>
        </h3>
        <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>{formatDate(entry.createdAt)}</p>

        <DetailSection title="Message">
          <p style={{ fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {entry.errorMessage}
          </p>
          {(entry.errorName || entry.errorCode) && (
            <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {entry.errorName && <>name: <span className="mono">{entry.errorName}</span></>}
              {entry.errorName && entry.errorCode && ' · '}
              {entry.errorCode && <>code: <span className="mono">{entry.errorCode}</span></>}
            </p>
          )}
        </DetailSection>

        {entry.sentryEventId && (
          <DetailSection title="Sentry">
            <p style={{ fontSize: 13 }}>
              Event ID: <span className="mono">{entry.sentryEventId}</span>
            </p>
          </DetailSection>
        )}

        <DetailSection title="User">
          <KeyValueGrid
            rows={[
              ['userId', entry.userId],
              ['publicKey', entry.publicKey],
              ['vaultAddress', entry.vaultAddress],
            ]}
          />
        </DetailSection>

        <DetailSection title="Client">
          <KeyValueGrid
            rows={[
              ['platform', entry.platform],
              ['appVersion', entry.appVersion],
              ['buildNumber', entry.buildNumber],
              ['osVersion', entry.osVersion],
              ['device', entry.device],
              ['screen', entry.screen],
              ['action', entry.action],
              ['userAgent', entry.userAgent],
              ['ipAddress', entry.ipAddress],
            ]}
          />
        </DetailSection>

        <DetailSection title="Request">
          <KeyValueGrid
            rows={[
              ['fullPath', entry.fullPath],
            ]}
          />
          {entry.requestParams && Object.keys(entry.requestParams).length > 0 && (
            <CodeBlock label="params" data={entry.requestParams} />
          )}
          {entry.requestQuery && Object.keys(entry.requestQuery).length > 0 && (
            <CodeBlock label="query" data={entry.requestQuery} />
          )}
          {entry.requestBody && Object.keys(entry.requestBody).length > 0 && (
            <CodeBlock label="body (sanitized)" data={entry.requestBody} />
          )}
        </DetailSection>

        {entry.responseBody && Object.keys(entry.responseBody).length > 0 && (
          <DetailSection title="Response (debug fields)">
            <CodeBlock label="responseBody" data={entry.responseBody} />
          </DetailSection>
        )}

        {entry.stack && (
          <DetailSection title="Stack">
            <pre
              style={{
                fontFamily: 'monospace',
                fontSize: 11,
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 4,
                overflowX: 'auto',
                maxHeight: 320,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {entry.stack}
            </pre>
          </DetailSection>
        )}

        <div className="modal-actions" style={{ marginTop: 16 }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: '#666', marginBottom: 6, letterSpacing: 0.5 }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function KeyValueGrid({ rows }: { rows: Array<[string, string | undefined]> }) {
  const visible = rows.filter(([, v]) => v != null && v !== '');
  if (visible.length === 0) {
    return <p style={{ fontSize: 13, color: '#999' }}>—</p>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '4px 12px', fontSize: 13 }}>
      {visible.flatMap(([k, v]) => [
        <span key={`${k}-k`} style={{ color: '#666' }}>{k}</span>,
        <span key={`${k}-v`} className="mono" style={{ wordBreak: 'break-all' }}>{v}</span>,
      ])}
    </div>
  );
}

function CodeBlock({ label, data }: { label: string; data: unknown }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      <pre
        style={{
          fontFamily: 'monospace',
          fontSize: 11,
          background: '#f5f5f5',
          padding: 12,
          borderRadius: 4,
          overflowX: 'auto',
          maxHeight: 220,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
