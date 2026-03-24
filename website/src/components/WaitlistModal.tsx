import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = 'https://api.cashflow.fun/waitlist/v1';

interface WaitlistModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WaitlistModal({ open, onClose }: WaitlistModalProps) {
  const [step, setStep] = useState<'email' | 'verify' | 'success'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        overlayRef.current?.classList.add('open');
        emailRef.current?.focus();
      }, 10);
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleClose = useCallback(() => {
    overlayRef.current?.classList.remove('open');
    setTimeout(() => {
      onClose();
      setStep('email');
      setEmail('');
      setCode('');
      setError('');
    }, 300);
  }, [onClose]);

  const handleSendCode = async () => {
    setError('');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(API_BASE + '/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return; }
      if (data.message === 'Already on waitlist') { setStep('success'); return; }
      setStep('verify');
      setTimeout(() => codeRef.current?.focus(), 100);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setError('');
    if (!code || code.length !== 6) { setError('Please enter the 6-digit code.'); return; }
    setLoading(true);
    try {
      const res = await fetch(API_BASE + '/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Verification failed.'); return; }
      setStep('success');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="modal-card">
        <button className="modal-close" onClick={handleClose}>&times;</button>
        <h2>Join the waitlist</h2>
        <p>Be the first to know when Cashflow launches.</p>

        {step === 'email' && (
          <div className="waitlist-step">
            <div className="waitlist-form">
              <input
                ref={emailRef}
                type="email"
                placeholder="Enter your email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendCode(); }}
              />
              <button className="btn btn-l btn-gradient" onClick={handleSendCode} disabled={loading}>
                {loading ? '...' : 'Join'}
              </button>
            </div>
            {error && <p className="waitlist-error">{error}</p>}
          </div>
        )}

        {step === 'verify' && (
          <div className="waitlist-step">
            <p className="waitlist-subtitle">Enter the 6-digit code sent to <span>{email}</span></p>
            <div className="waitlist-form">
              <input
                ref={codeRef}
                type="text"
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleVerify(); }}
              />
              <button className="btn btn-l btn-gradient" onClick={handleVerify} disabled={loading}>
                {loading ? '...' : 'Verify'}
              </button>
            </div>
            {error && <p className="waitlist-error">{error}</p>}
          </div>
        )}

        {step === 'success' && (
          <div className="waitlist-step">
            <p className="waitlist-success-msg">You're on the list! We'll be in touch.</p>
          </div>
        )}
      </div>
    </div>
  );
}
