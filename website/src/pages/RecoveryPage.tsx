import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import {
  useWalletConnectors,
  useConnectWallet,
  useDisconnectWallet,
  useWallet,
  useConnectorClient,
} from '@solana/connector/react';
import {
  getTransactionDecoder,
  address,
} from '@solana/kit';
import '../styles/recovery.css';

const API_BASE = window.location.hostname.includes('localhost')
  ? 'http://localhost:3000'
  : window.location.hostname.includes('dev.')
    ? 'https://api-dev.cashflow.fun'
    : 'https://api.cashflow.fun';

interface SignerInfo {
  address: string;
  type: string;
  label?: string;
  email?: string;
  signed: boolean;
}

interface Proposal {
  proposalId: string;
  multisigAddress: string;
  vaultAddress: string;
  threshold: number;
  status: string;
  actions: Array<{ memberAddress: string; permissions: string }>;
  signaturesCollected: number;
  tx1Base64: string;
  requiredSigners: SignerInfo[];
}

function truncate(addr: string) {
  return addr ? addr.slice(0, 4) + '...' + addr.slice(-4) : '';
}

function maskEmail(email: string) {
  if (!email) return '';
  if (email.length <= 12) return email.slice(0, 2) + '...' + email.slice(-4);
  return email.slice(0, 2) + '...' + email.slice(-10);
}

export default function RecoveryPage() {
  const { id: proposalId } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState('');
  const [showWalletPicker, setShowWalletPicker] = useState(false);

  // @solana/connector hooks
  const wallets = useWalletConnectors();
  const { connect } = useConnectWallet();
  const { disconnect: disconnectWallet } = useDisconnectWallet();
  const { account: connectedAddress } = useWallet();
  const connectorClient = useConnectorClient();

  const loadProposal = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/vault-recovery/v1/proposal/${proposalId}`);
      if (!res.ok) throw new Error('Not found');
      const json = await res.json();
      setProposal(json.data);
      setLoading(false);
    } catch {
      setNotFound(true);
      setLoading(false);
    }
  }, [proposalId]);

  const disconnect = useCallback(() => {
    disconnectWallet();
  }, [disconnectWallet]);

  // Disconnect any previously remembered wallet on mount
  useEffect(() => { disconnect(); }, []);

  useEffect(() => { loadProposal(); }, [loadProposal]);

  // After wallet connects, validate and hide picker
  useEffect(() => {
    if (!connectedAddress || !proposal) return;
    setShowWalletPicker(false);

    const addr = connectedAddress.toString();
    const s = proposal.requiredSigners.find(s => s.address === addr);
    if (!s) {
      setError(`Wallet ${truncate(addr)} is not a required signer for this proposal.`);
    } else if (s.signed) {
      setError('This wallet has already signed this proposal.');
    }
  }, [connectedAddress, proposal]);

  const handleConnect = (walletId: string) => {
    setError('');
    setShowWalletPicker(false);
    connect(walletId as any);
  };

  const handleSign = async () => {
    if (!connectedAddress || !proposal || !connectorClient) return;
    const addr = connectedAddress.toString();
    setSigning(true);
    setError('');

    try {
      // 1. Ask backend to build a proposalApprove tx for this member
      const buildRes = await fetch(`${API_BASE}/vault-recovery/v1/proposal/${proposalId}/build-approve-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberAddress: addr }),
      });
      if (!buildRes.ok) {
        const err = await buildRes.json();
        throw new Error(err.error || 'Failed to build approve transaction');
      }
      const { data: { transaction: txBase64 } } = await buildRes.json();

      // 2. Get the wallet standard wallet for signing
      const state = connectorClient.getSnapshot();
      if (state.wallet.status !== 'connected') throw new Error('Wallet not connected');

      const connectorId = state.wallet.session.connectorId;
      const wallet = connectorClient.getConnector(connectorId);
      if (!wallet) throw new Error('Wallet not found');

      const signFeature = wallet.features['solana:signTransaction'] as any;
      if (!signFeature) throw new Error('Wallet does not support transaction signing');

      const account = wallet.accounts.find(a => {
        try {
          const accAddr = typeof a.address === 'string' ? a.address : address(a.address as any);
          return accAddr === addr;
        } catch { return false; }
      });
      if (!account) throw new Error('Account not found in wallet');

      const txBytes = Uint8Array.from(atob(txBase64), c => c.charCodeAt(0));

      // Sign only — we send via our own RPC to avoid wallet relay issues
      const [{ signedTransaction }] = await signFeature.signTransaction({
        transaction: txBytes,
        account,
        chain: 'solana:mainnet',
      });

      // Send via backend's Helius SWQoS endpoint
      const sendRes = await fetch(`${API_BASE}/vault-recovery/v1/send-recovery-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: btoa(String.fromCharCode(...new Uint8Array(signedTransaction))),
        }),
      });
      if (!sendRes.ok) {
        const err = await sendRes.json();
        throw new Error(err.error || 'Failed to send transaction');
      }

      // 3. Notify backend that this signer approved on-chain
      await fetch(`${API_BASE}/vault-recovery/v1/proposal/${proposalId}/submit-signature`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr, signature: 'on-chain' }),
      }).catch(() => {});

      setSigned(true);
      loadProposal();
    } catch (err: any) {
      setError('Signing failed: ' + (err.message || err));
    } finally {
      setSigning(false);
    }
  };

  const connectedAddr = connectedAddress?.toString();
  const isRequiredSigner = proposal?.requiredSigners.some(s => s.address === connectedAddr);
  const alreadySigned = proposal?.requiredSigners.find(s => s.address === connectedAddr)?.signed;
  const canSign = connectedAddr && isRequiredSigner && !alreadySigned && !signed;

  if (loading) {
    return (
      <div className="recovery-page">
        <div className="container">
          <div className="logo">Cashflow</div>
          <div className="subtitle">Vault Recovery - External Wallet Signing</div>
          <div className="status">Loading proposal...</div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="recovery-page">
        <div className="container">
          <div className="logo">Cashflow</div>
          <div className="subtitle">Vault Recovery - External Wallet Signing</div>
          <div className="status error">Proposal not found or has expired.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="recovery-page">
      <div className="container">
        <div className="logo">Cashflow</div>
        <div className="subtitle">Vault Recovery - External Wallet Signing</div>

        <div className="info-card">
          <div className="info-row">
            <span className="info-label">Vault</span>
            <span className="info-value">{truncate(proposal!.vaultAddress)}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Threshold</span>
            <span className="info-value">{proposal!.signaturesCollected}/{proposal!.threshold} signatures</span>
          </div>
        </div>

        <h3 className="section-title">Actions</h3>
        {(proposal!.actions || []).map((a, i) => (
          <div key={i} className="action-card">
            Add member: {truncate(a.memberAddress)} ({a.permissions})
          </div>
        ))}

        <h3 className="section-title" style={{ marginTop: 20 }}>Signers</h3>
        <div className="signer-list">
          {proposal!.requiredSigners.map((s) => (
            <div key={s.address || s.type} className="signer-item">
              <div>
                <div className="signer-addr">{truncate(s.address)}</div>
                <div className="signer-type">
                  {s.type || ''}{s.email ? ' - ' + maskEmail(s.email) : s.label ? ' - ' + s.label : ''}
                </div>
              </div>
              {s.signed ? (
                <span className="badge badge-signed">Signed</span>
              ) : connectedAddr && s.address === connectedAddr ? (
                <span className="badge badge-you">You</span>
              ) : (
                <span className="badge badge-pending">Pending</span>
              )}
            </div>
          ))}
        </div>

        {!connectedAddr && (
          <button className="btn btn-primary" onClick={() => setShowWalletPicker(true)}>
            Connect Wallet
          </button>
        )}

        {showWalletPicker && (
          <div className="wallet-overlay" onClick={(e) => { if (e.target === e.currentTarget) setShowWalletPicker(false); }}>
            <div className="wallet-sheet">
              <div className="wallet-sheet-handle" />
              <div className="wallet-sheet-title">Connect Wallet</div>
              <div className="wallet-list">
                {wallets.length === 0 ? (
                  <div className="wallet-empty">
                    No Solana wallets detected.<br /><br />
                    Install <a href="https://phantom.app" target="_blank" rel="noopener">Phantom</a>,{' '}
                    <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a>, or any
                    Solana wallet extension.
                  </div>
                ) : (
                  wallets.map((w) => (
                    <button
                      key={w.id}
                      className="wallet-item"
                      onClick={() => handleConnect(w.id)}
                    >
                      {w.icon && <img src={w.icon} alt={w.name} />}
                      <span>{w.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {canSign && (
          <button className="btn btn-primary" onClick={handleSign} disabled={signing}>
            {signing ? 'Signing...' : 'Sign Recovery Proposal'}
          </button>
        )}

        {connectedAddr && !signed && (
          <button className="btn-disconnect" onClick={() => { disconnect(); setError(''); }}>
            Disconnect {truncate(connectedAddr)}
          </button>
        )}

        {signed && (
          <div className="status success">Signed successfully! You can close this page.</div>
        )}

        {error && <div className="status error">{error}</div>}
      </div>
    </div>
  );
}
