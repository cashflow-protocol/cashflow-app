import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getRewardSettings,
  updateRewardSettings,
  getRewardTasks,
  createRewardTask,
  updateRewardTask,
  uploadRewardImage,
  uploadRewardMetadata,
  createRewardsCollection,
  diagnoseReward,
  backfillUserVault,
  type RewardTask,
  type RewardSettings,
  type RewardVerifierType,
} from '../api';

const VERIFIER_TYPES: RewardVerifierType[] = [
  'onchain_deposit',
  'onchain_swap_volume',
  'onchain_transfer_out',
  'device_seeker',
  'social_twitter_follow',
  'social_twitter_retweet',
  'manual',
];

const VERIFIER_CONFIG_HINT: Record<RewardVerifierType, string> = {
  onchain_deposit: '{"protocol": "jupiter", "minUsd": 1000}',
  onchain_swap_volume: '{"minUsd": 1000}',
  onchain_transfer_out: '{"minCount": 1}',
  device_seeker: '{}',
  social_twitter_follow: '{"handle": "cashflow_fi", "twitterId": "12345"}',
  social_twitter_retweet: '{"tweetId": "1789..."}',
  manual: '{}',
};

export default function RewardsPage() {
  const [settings, setSettings] = useState<RewardSettings | null>(null);
  const [tasks, setTasks] = useState<RewardTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTask, setEditTask] = useState<RewardTask | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([getRewardSettings(), getRewardTasks()]);
      if (s.success) setSettings(s.settings);
      if (t.success) setTasks(t.tasks ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleBackfill = async () => {
    if (backfilling) return;
    if (!confirm('Backfill userVaultAddress on all transactions missing it? This is safe to re-run.')) return;
    setBackfilling(true);
    try {
      const res = await backfillUserVault();
      if (res.success) {
        const unmappedCount = res.unmappedWalletAddresses?.length ?? 0;
        const summary =
          `Updated ${res.transactionsUpdated}/${res.transactionsScanned} transactions.\n` +
          `Mappings: ${res.mappingsFromVaultPayments} from VaultPayments + ${res.mappingsFromUserFallback} from Users.\n` +
          (unmappedCount > 0 ? `Unmapped wallets: ${unmappedCount}` : 'All matched.');
        alert(summary);
        if (unmappedCount > 0) console.warn('Unmapped wallets:', res.unmappedWalletAddresses);
      } else {
        alert(`Failed: ${res.error ?? 'unknown'}`);
      }
    } catch (err: any) {
      alert(`Failed: ${err?.message ?? 'unknown'}`);
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Rewards ({tasks.length})</h2>
        <div className="header-actions" style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ width: 'auto' }} onClick={handleBackfill} disabled={backfilling}>
            {backfilling ? 'Backfilling…' : 'Backfill user vaults'}
          </button>
          <button className="btn-primary" style={{ width: 'auto' }} onClick={() => setShowCreate(true)}>
            Add Reward Task
          </button>
        </div>
      </div>

      <SettingsCard settings={settings} onSaved={load} />

      <DiagnoseCard tasks={tasks} />

      <div className="table-container" style={{ marginTop: 24 }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 50 }}>Order</th>
              <th style={{ width: 80 }}>Image</th>
              <th>Slug / Title</th>
              <th>Verifier</th>
              <th>Fee (SOL)</th>
              <th>Supply</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40 }}>Loading...</td></tr>
            ) : tasks.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No reward tasks yet</td></tr>
            ) : tasks.map((t) => (
              <tr key={t._id} style={{ opacity: t.active ? 1 : 0.5 }}>
                <td style={{ textAlign: 'center' }}>{t.sortOrder}</td>
                <td>
                  {t.imageUrl
                    ? <img src={t.imageUrl} alt={t.slug} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                    : <div style={{ width: 48, height: 48, borderRadius: 8, background: '#eee' }} />
                  }
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div className="mono" style={{ fontSize: 11, color: '#888' }}>{t.slug}</div>
                </td>
                <td><span className="badge badge-yellow">{t.verifierType}</span></td>
                <td>{(Number(t.mintFeeLamports) / 1_000_000_000).toFixed(3)}</td>
                <td>
                  {t.maxSupply != null
                    ? <span style={{ fontSize: 12 }}>{t.mintedCount.toLocaleString()} / {t.maxSupply.toLocaleString()}</span>
                    : <span style={{ fontSize: 12 }}>{t.mintedCount.toLocaleString()} / ∞</span>
                  }
                </td>
                <td>
                  <span
                    className={`badge ${t.active ? 'badge-green' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={async () => {
                      await updateRewardTask(t.slug, { active: !t.active });
                      load();
                    }}
                  >
                    {t.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setEditTask(t)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <TaskFormModal
          existingTasks={tasks}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
      {editTask && (
        <TaskFormModal
          task={editTask}
          existingTasks={tasks}
          onClose={() => setEditTask(null)}
          onSaved={() => { setEditTask(null); load(); }}
        />
      )}
    </div>
  );
}

function DiagnoseCard({ tasks }: { tasks: RewardTask[] }) {
  const [vaultAddress, setVaultAddress] = useState('');
  const [taskSlug, setTaskSlug] = useState(tasks[0]?.slug ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!taskSlug && tasks.length > 0) setTaskSlug(tasks[0].slug);
  }, [tasks, taskSlug]);

  const handleRun = async () => {
    if (!vaultAddress.trim() || !taskSlug) {
      setError('Vault address and task are required');
      return;
    }
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const res = await diagnoseReward(vaultAddress.trim(), taskSlug);
      if (res.success) setResult(res);
      else setError(res.error ?? 'Diagnose failed');
    } catch (err: any) {
      setError(err?.message ?? 'Diagnose failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 20, marginTop: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Diagnose reward progress</h3>
      <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
        Inspect a vault's transactions, what the verifier matches, and the resulting USD progress.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Vault address"
          value={vaultAddress}
          onChange={(e) => setVaultAddress(e.target.value)}
          style={{ flex: '1 1 320px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6 }}
        />
        <select
          value={taskSlug}
          onChange={(e) => setTaskSlug(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6 }}
        >
          {tasks.map((t) => (
            <option key={t.slug} value={t.slug}>{t.slug}</option>
          ))}
        </select>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={handleRun} disabled={running}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
      {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
      {result && <DiagnoseResult result={result} />}
    </div>
  );
}

function DiagnoseResult({ result }: { result: any }) {
  const cellStyle: React.CSSProperties = { padding: '6px 10px', fontSize: 12, borderTop: '1px solid #f0f2f5' };
  const headStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, color: '#666', background: '#fafbfc', borderTop: 'none' };
  return (
    <div style={{ marginTop: 16, fontSize: 13 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Task</div>
          <div style={{ fontWeight: 600 }}>{result.task.title} <span style={{ color: '#888', fontWeight: 400 }}>({result.task.slug})</span></div>
          <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>verifier: {result.task.verifierType}</div>
          <pre style={{ background: '#f5f6f8', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 6, overflow: 'auto' }}>
            {JSON.stringify(result.task.verifierConfig ?? {}, null, 2)}
          </pre>
        </div>
        <div>
          <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Verifier query</div>
          <pre style={{ background: '#f5f6f8', padding: 8, borderRadius: 6, fontSize: 11, marginTop: 0, overflow: 'auto' }}>
            {JSON.stringify(result.txQuery, null, 2)}
          </pre>
          <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 4 }}>Total USD</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>${result.totalUsd.toFixed(2)}</div>
        </div>
      </div>

      <div style={{ marginBottom: 8, fontWeight: 600 }}>Matching transactions ({result.matchingTransactions.length})</div>
      {result.matchingTransactions.length === 0 ? (
        <div style={{ color: '#999', fontStyle: 'italic', padding: '12px 0' }}>No transactions matched the verifier filter.</div>
      ) : (
        <div style={{ overflow: 'auto', border: '1px solid #f0f2f5', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...headStyle, textAlign: 'left' }}>When</th>
                <th style={{ ...headStyle, textAlign: 'left' }}>Action</th>
                <th style={{ ...headStyle, textAlign: 'left' }}>Type</th>
                <th style={{ ...headStyle, textAlign: 'left' }}>Symbol</th>
                <th style={{ ...headStyle, textAlign: 'right' }}>Amount</th>
                <th style={{ ...headStyle, textAlign: 'right' }}>Price</th>
                <th style={{ ...headStyle, textAlign: 'right' }}>USD</th>
              </tr>
            </thead>
            <tbody>
              {result.matchingTransactions.map((tx: any) => (
                <tr key={tx.id}>
                  <td style={cellStyle}>{tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '—'}</td>
                  <td style={cellStyle}>{tx.action}</td>
                  <td style={cellStyle}>{tx.type ?? '—'}</td>
                  <td style={cellStyle}>{tx.symbol}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>{tx.uiAmount.toFixed(6)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right' }}>${tx.priceUsd.toFixed(2)}</td>
                  <td style={{ ...cellStyle, textAlign: 'right', fontWeight: 600 }}>${tx.usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>All recent vault transactions ({result.allRecentTransactions.length})</div>
      <div style={{ overflow: 'auto', border: '1px solid #f0f2f5', borderRadius: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...headStyle, textAlign: 'left' }}>When</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Action</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Type</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Status</th>
              <th style={{ ...headStyle, textAlign: 'left' }}>Mint</th>
            </tr>
          </thead>
          <tbody>
            {result.allRecentTransactions.map((tx: any) => (
              <tr key={tx.id}>
                <td style={cellStyle}>{tx.createdAt ? new Date(tx.createdAt).toLocaleString() : '—'}</td>
                <td style={cellStyle}>{tx.action}</td>
                <td style={cellStyle}>{tx.type ?? '—'}</td>
                <td style={cellStyle}>
                  <span style={{
                    fontSize: 11,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: tx.status === 'confirmed' ? '#d4edda' : tx.status === 'failed' ? '#f8d7da' : '#fff3cd',
                    color: tx.status === 'confirmed' ? '#155724' : tx.status === 'failed' ? '#721c24' : '#856404',
                  }}>
                    {tx.status}
                  </span>
                </td>
                <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 11 }}>{tx.mint.slice(0, 8)}…{tx.mint.slice(-4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SettingsCard({ settings, onSaved }: { settings: RewardSettings | null; onSaved: () => void }) {
  const [collectionAddress, setCollectionAddress] = useState(settings?.rewardsCollectionAddress ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [showCreateCollection, setShowCreateCollection] = useState(false);

  useEffect(() => {
    setCollectionAddress(settings?.rewardsCollectionAddress ?? '');
  }, [settings?.rewardsCollectionAddress]);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await updateRewardSettings({ rewardsCollectionAddress: collectionAddress.trim() });
      if (res.success) {
        setMsg({ kind: 'ok', text: 'Saved.' });
        onSaved();
      } else {
        setMsg({ kind: 'err', text: res.error ?? 'Failed' });
      }
    } catch (err: any) {
      setMsg({ kind: 'err', text: err?.message ?? 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="table-container" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Settings</h3>
        <button
          className="btn-secondary"
          style={{ width: 'auto' }}
          onClick={() => setShowCreateCollection(true)}
        >
          Create Collection
        </button>
      </div>

      {settings && !settings.storageConfigured && (
        <p className="error-text" style={{ marginBottom: 12 }}>
          DigitalOcean Spaces is not configured. Image and metadata uploads will fail until DO_SPACES_KEY/SECRET/ENDPOINT are set in the backend env.
        </p>
      )}

      <div className="form-group">
        <label>REWARDS_COLLECTION_ADDRESS</label>
        <input
          value={collectionAddress}
          onChange={(e) => setCollectionAddress(e.target.value)}
          placeholder="Paste address — or click Create Collection above"
          className="mono"
          style={{ fontSize: 13 }}
        />
        {settings?.envDefaultCollectionAddress && settings.envDefaultCollectionAddress !== settings.rewardsCollectionAddress && (
          <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
            Env default: <span className="mono">{settings.envDefaultCollectionAddress}</span> (DB value overrides this)
          </p>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn-primary" style={{ width: 'auto' }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        {msg && (
          <span style={{ fontSize: 13, color: msg.kind === 'ok' ? '#19C394' : '#F95357' }}>{msg.text}</span>
        )}
      </div>

      {showCreateCollection && (
        <CreateCollectionModal
          onClose={() => setShowCreateCollection(false)}
          onCreated={() => { setShowCreateCollection(false); onSaved(); }}
        />
      )}
    </div>
  );
}

function CreateCollectionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('Cashflow Rewards');
  const [description, setDescription] = useState('Soulbound badges earned for using Cashflow.');
  const [externalUrl, setExternalUrl] = useState('https://cashflow.fun');
  const [imageUrl, setImageUrl] = useState('');
  const [metadataStr, setMetadataStr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ address: string; metadataUri: string; signature: string } | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);

  const buildDefaultMetadata = (img: string) => ({
    name,
    description,
    image: img,
    ...(externalUrl ? { external_url: externalUrl } : {}),
  });

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const res = await uploadRewardImage(file, 'collection');
      if (res.success) {
        setImageUrl(res.url);
        // If user hasn't customized metadata yet, refresh the JSON preview
        if (!metadataStr.trim()) {
          setMetadataStr(JSON.stringify(buildDefaultMetadata(res.url), null, 2));
        }
      } else {
        setError(res.error ?? 'Upload failed');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreate = async () => {
    setError('');

    if (!name.trim()) { setError('Name is required'); return; }
    if (!imageUrl.trim()) { setError('Upload an image (or paste an image URL into the JSON)'); return; }

    // If user typed custom JSON, validate it; otherwise use the field-built object.
    let metadata: Record<string, any> | undefined;
    if (metadataStr.trim()) {
      try {
        metadata = JSON.parse(metadataStr);
      } catch {
        setError('Invalid JSON in metadata');
        return;
      }
    }

    setCreating(true);
    try {
      const res = await createRewardsCollection({
        name: name.trim(),
        description: description.trim(),
        imageUrl: imageUrl.trim(),
        externalUrl: externalUrl.trim() || undefined,
        metadata,
      });
      if (res.success && res.address && res.metadataUri && res.signature) {
        setResult({ address: res.address, metadataUri: res.metadataUri, signature: res.signature });
      } else {
        setError(res.error ?? 'Failed to create collection');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create collection');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={result ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3>Create Rewards Collection</h3>

        {result ? (
          <>
            <p style={{ fontSize: 13, color: '#19C394', marginBottom: 16 }}>
              Collection created on-chain and saved to settings.
            </p>
            <div className="form-group">
              <label>Collection address</label>
              <input value={result.address} readOnly className="mono" style={{ fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>Metadata URI</label>
              <input value={result.metadataUri} readOnly className="mono" style={{ fontSize: 12 }} />
            </div>
            <div className="form-group">
              <label>Signature (base64)</label>
              <input value={result.signature} readOnly className="mono" style={{ fontSize: 12 }} />
            </div>
            <div className="modal-actions">
              <button className="btn-primary" style={{ width: 'auto' }} onClick={onCreated}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              Uploads metadata to DO Spaces, runs Metaplex Core <span className="mono">createCollection</span> on-chain (signed by the admin keypair), and saves the resulting address to settings.
            </p>

            <div className="form-group">
              <label>Image</label>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {imageUrl ? (
                  <img src={imageUrl} alt="" style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover', border: '1px solid #ddd' }} />
                ) : (
                  <div style={{ width: 96, height: 96, borderRadius: 12, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>
                    no image
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://...png — or upload below"
                    className="mono"
                    style={{ fontSize: 12 }}
                  />
                  <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ marginTop: 8, width: 'auto' }}
                    disabled={uploading}
                    onClick={() => imageInputRef.current?.click()}
                  >
                    {uploading ? 'Uploading...' : 'Upload to DO Spaces'}
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-group">
                <label>External URL</label>
                <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://cashflow.fun" />
              </div>
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>

            <div className="form-group">
              <label>Metadata JSON (optional override)</label>
              <textarea
                value={metadataStr}
                onChange={(e) => setMetadataStr(e.target.value)}
                placeholder={`Leave blank to auto-build from fields above. Or paste full JSON, e.g.:\n${JSON.stringify({ name: 'Cashflow Rewards', description: '...', image: 'https://.../collection.png', external_url: 'https://cashflow.fun' }, null, 2)}`}
                rows={8}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
              <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                Uploaded to <span className="mono">/rewards/metadata/collection.json</span>.
              </p>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose} disabled={creating}>Cancel</button>
              <button className="btn-primary" style={{ width: 'auto' }} onClick={handleCreate} disabled={creating || uploading}>
                {creating ? 'Creating on-chain…' : 'Upload & Create Collection'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TaskFormModal({
  task,
  existingTasks,
  onClose,
  onSaved,
}: {
  task?: RewardTask;
  existingTasks: RewardTask[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!task;
  const [slug, setSlug] = useState(task?.slug ?? '');
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [imageUrl, setImageUrl] = useState(task?.imageUrl ?? '');
  const [metadataUri, setMetadataUri] = useState(task?.metadataUri ?? '');
  const [active, setActive] = useState(task?.active !== false);
  const [sortOrder, setSortOrder] = useState(task?.sortOrder ?? 0);
  const [requiresTaskSlug, setRequiresTaskSlug] = useState(task?.requiresTaskSlug ?? '');
  const [mintFeeSol, setMintFeeSol] = useState(task ? Number(task.mintFeeLamports) / 1_000_000_000 : 0.02);
  const [maxSupply, setMaxSupply] = useState<string>(task?.maxSupply != null ? String(task.maxSupply) : '');
  const [verifierType, setVerifierType] = useState<RewardVerifierType>(task?.verifierType ?? 'onchain_deposit');
  const [verifierConfigStr, setVerifierConfigStr] = useState(
    task?.verifierConfig && Object.keys(task.verifierConfig).length > 0
      ? JSON.stringify(task.verifierConfig, null, 2)
      : '',
  );

  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const imageInputRef = useRef<HTMLInputElement>(null);

  const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!safeSlug) {
      setError('Set a slug before uploading an image (e.g. "jupiter-lender-1k")');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const res = await uploadRewardImage(file, safeSlug);
      if (res.success) {
        setImageUrl(res.url);
      } else {
        setError(res.error ?? 'Upload failed');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleGenerateMetadata = async () => {
    if (!safeSlug) { setError('Set a slug first'); return; }
    if (!title.trim()) { setError('Set a title first'); return; }
    if (!imageUrl) { setError('Upload an image first (or paste an image URL)'); return; }
    setGenerating(true);
    setError('');
    try {
      const metadata = {
        name: title,
        description,
        image: imageUrl,
        attributes: [
          { trait_type: 'Type', value: verifierType.startsWith('social_') ? 'Social' : verifierType === 'device_seeker' ? 'Device' : 'Onchain' },
          { trait_type: 'Soulbound', value: 'true' },
        ],
      };
      const res = await uploadRewardMetadata(safeSlug, metadata);
      if (res.success) {
        setMetadataUri(res.url);
      } else {
        setError(res.error ?? 'Upload failed');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to upload metadata');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setError('');

    if (!safeSlug) { setError('Slug is required'); return; }
    if (!title.trim()) { setError('Title is required'); return; }
    if (!description.trim()) { setError('Description is required'); return; }
    if (!imageUrl.trim()) { setError('Image URL is required (upload or paste)'); return; }
    if (!metadataUri.trim()) { setError('Metadata URI is required (generate or paste)'); return; }

    let verifierConfig: Record<string, any> = {};
    if (verifierConfigStr.trim()) {
      try {
        verifierConfig = JSON.parse(verifierConfigStr);
      } catch {
        setError('Invalid JSON in verifier config');
        return;
      }
    }

    const mintFeeLamports = Math.floor(Number(mintFeeSol) * 1_000_000_000);
    if (!Number.isFinite(mintFeeLamports) || mintFeeLamports < 0) {
      setError('Invalid mint fee');
      return;
    }

    const payload: Record<string, any> = {
      slug: safeSlug,
      title: title.trim(),
      description: description.trim(),
      imageUrl: imageUrl.trim(),
      metadataUri: metadataUri.trim(),
      active,
      sortOrder: Number(sortOrder) || 0,
      requiresTaskSlug: requiresTaskSlug || undefined,
      mintFeeLamports: String(mintFeeLamports),
      maxSupply: maxSupply.trim() === '' ? undefined : Number(maxSupply),
      verifierType,
      verifierConfig,
    };

    setSaving(true);
    try {
      const res = isEdit
        ? await updateRewardTask(task!.slug, payload)
        : await createRewardTask(payload);
      if (res.success) {
        onSaved();
      } else {
        setError(res.error ?? 'Failed to save');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3>{isEdit ? `Edit "${task!.slug}"` : 'Create Reward Task'}</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Slug (unique, lowercase)</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. jupiter-lender-1k"
              disabled={isEdit}
              className="mono"
            />
          </div>

          <div className="form-group">
            <label>Sort order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className="form-group">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Jupiter Lender" />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Deposit a cumulative $1,000 into Jupiter Lend."
            rows={2}
          />
        </div>

        <div className="form-group">
          <label>Image</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {imageUrl ? (
              <img src={imageUrl} alt="" style={{ width: 96, height: 96, borderRadius: 12, objectFit: 'cover', border: '1px solid #ddd' }} />
            ) : (
              <div style={{ width: 96, height: 96, borderRadius: 12, background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>
                no image
              </div>
            )}
            <div style={{ flex: 1 }}>
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://...png — or upload below"
                className="mono"
                style={{ fontSize: 12 }}
              />
              <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 8, width: 'auto' }}
                disabled={uploading}
                onClick={() => imageInputRef.current?.click()}
              >
                {uploading ? 'Uploading...' : 'Upload to DO Spaces'}
              </button>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Metadata URI</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={metadataUri}
              onChange={(e) => setMetadataUri(e.target.value)}
              placeholder="https://...json — or generate below"
              className="mono"
              style={{ fontSize: 12, flex: 1 }}
            />
            <button
              type="button"
              className="btn-secondary"
              style={{ width: 'auto', whiteSpace: 'nowrap' }}
              disabled={generating}
              onClick={handleGenerateMetadata}
            >
              {generating ? 'Generating...' : 'Generate & Upload'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
            Generates a Metaplex JSON {`{ name, description, image, attributes }`} and uploads it to <span className="mono">/rewards/metadata/{safeSlug || '<slug>'}.json</span>.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div className="form-group">
            <label>Mint fee (SOL)</label>
            <input
              type="number"
              step="0.001"
              min={0}
              value={mintFeeSol}
              onChange={(e) => setMintFeeSol(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-group">
            <label>Max supply (blank = ∞)</label>
            <input
              type="number"
              min={1}
              value={maxSupply}
              onChange={(e) => setMaxSupply(e.target.value)}
              placeholder="e.g. 10000"
            />
          </div>
          <div className="form-group">
            <label>Requires task</label>
            <select value={requiresTaskSlug} onChange={(e) => setRequiresTaskSlug(e.target.value)}>
              <option value="">None</option>
              {existingTasks
                .filter((t) => t.slug !== task?.slug)
                .map((t) => <option key={t.slug} value={t.slug}>{t.slug}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Verifier type</label>
          <select value={verifierType} onChange={(e) => setVerifierType(e.target.value as RewardVerifierType)}>
            {VERIFIER_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Verifier config (JSON)</label>
          <textarea
            value={verifierConfigStr}
            onChange={(e) => setVerifierConfigStr(e.target.value)}
            placeholder={VERIFIER_CONFIG_HINT[verifierType]}
            rows={4}
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
          <p style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
            Example for <span className="mono">{verifierType}</span>: <span className="mono">{VERIFIER_CONFIG_HINT[verifierType]}</span>
          </p>
        </div>

        <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, display: 'flex' }}>
          <input
            type="checkbox"
            id="reward-active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <label htmlFor="reward-active" style={{ marginBottom: 0 }}>Active</label>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ width: 'auto' }} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}
