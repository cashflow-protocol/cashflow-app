import { useState, useEffect, useCallback } from 'react';
import { getInviteCodes, generateCodes, createCustomCode, deleteInviteCode } from '../api';

interface InviteCode {
  id: string;
  code: string;
  maxUses: number;
  useCount: number;
  usedBy: { publicKey: string; usedAt: string }[];
  source: string;
  createdAt: string;
}

export default function InviteCodesPage() {
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modals
  const [showGenerate, setShowGenerate] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getInviteCodes(page, search);
      setCodes(data.codes || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this invite code?')) return;
    await deleteInviteCode(id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Invite Codes ({total})</h2>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => setShowGenerate(true)}>
            Generate Bulk
          </button>
          <button className="btn-primary" style={{ width: 'auto' }} onClick={() => setShowCustom(true)}>
            Create Custom
          </button>
        </div>
      </div>

      <div className="search-bar">
        <input
          placeholder="Search codes..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Uses</th>
              <th>Source</th>
              <th>Created</th>
              <th>Used By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : codes.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No invite codes found</td></tr>
            ) : codes.map((c) => (
              <tr key={c.id}>
                <td className="mono" style={{ fontWeight: 600 }}>{c.code}</td>
                <td>
                  <span className={`badge ${(c.useCount ?? 0) >= (c.maxUses ?? 1) ? 'badge-green' : 'badge-yellow'}`}>
                    {c.useCount ?? 0}/{c.maxUses ?? 1}
                  </span>
                </td>
                <td><span className="badge badge-blue">{c.source}</span></td>
                <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                <td>
                  {(c.usedBy ?? []).length > 0
                    ? (c.usedBy ?? []).map((u, i) => (
                        <span key={i} className="truncate mono" title={u.publicKey} style={{ display: 'block' }}>
                          {u.publicKey.slice(0, 6)}...{u.publicKey.slice(-4)}
                        </span>
                      ))
                    : <span style={{ color: '#999' }}>—</span>
                  }
                </td>
                <td>
                  <button className="btn-danger" onClick={() => handleDelete(c.id)}>Delete</button>
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

      {/* Generate Bulk Modal */}
      {showGenerate && (
        <GenerateModal
          onClose={() => { setShowGenerate(false); setGeneratedCodes([]); }}
          onGenerated={(codes) => { setGeneratedCodes(codes); load(); }}
          generatedCodes={generatedCodes}
        />
      )}

      {/* Custom Code Modal */}
      {showCustom && (
        <CustomModal
          onClose={() => setShowCustom(false)}
          onCreated={() => { setShowCustom(false); load(); }}
        />
      )}
    </div>
  );
}

function GenerateModal({
  onClose,
  onGenerated,
  generatedCodes,
}: {
  onClose: () => void;
  onGenerated: (codes: string[]) => void;
  generatedCodes: string[];
}) {
  const [count, setCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const data = await generateCodes(count);
      onGenerated(data.codes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Generate Invite Codes</h3>
        <div className="form-group">
          <label>Number of codes</label>
          <input
            type="number"
            min={1}
            max={100}
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value) || 1)}
          />
        </div>
        {generatedCodes.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p className="success-text">Generated {generatedCodes.length} codes:</p>
              <button
                className="btn-secondary"
                style={{ fontSize: 12, padding: '4px 10px' }}
                onClick={() => {
                  navigator.clipboard.writeText(generatedCodes.join('\n'));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="codes-list">{generatedCodes.join('\n')}</div>
          </>
        )}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Close</button>
          <button
            className="btn-primary"
            style={{ width: 'auto' }}
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? 'Generating...' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CustomModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState('');
  const [maxUses, setMaxUses] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    try {
      const data = await createCustomCode(code.trim(), maxUses);
      if (!data.success) {
        setError(data.error || 'Failed to create code');
        return;
      }
      onCreated();
    } catch (err) {
      setError('Failed to create code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Create Custom Code</h3>
        <div className="form-group">
          <label>Code</label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. KUMEKATEAM"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Max uses</label>
          <input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(parseInt(e.target.value) || 1)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            style={{ width: 'auto' }}
            onClick={handleCreate}
            disabled={loading || !code.trim()}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
