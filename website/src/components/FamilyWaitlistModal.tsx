import { useState, useEffect, useRef, useCallback } from 'react';
import {
  useWalletConnectors,
  useConnectWallet,
  useDisconnectWallet,
  useWallet,
  useConnectorClient,
} from '@solana/connector/react';
import {
  Sparkles, BadgePercent, TrendingUp, Rocket, Award, MessageCircle, Lock, ArrowRight,
} from 'lucide-react';
import type { SurveyData, Option } from './FamilyWaitlistModal.types';
import {
  GENDER_OPTIONS,
  AGE_OPTIONS,
  FAMILY_STATUS_OPTIONS,
  SAVINGS_METHODS_OPTIONS,
  MONTHLY_SAVINGS_OPTIONS,
  CRYPTO_COMFORT_OPTIONS,
  DEFI_PROTOCOLS_OPTIONS,
  GOAL_OPTIONS,
  CHALLENGE_OPTIONS,
} from './FamilyWaitlistModal.types';

const API_BASE = 'https://api.cashflow.fun/waitlist/v1';

type Step =
  | 'about' | 'family' | 'saving' | 'crypto' | 'goals' | 'challenge'
  | 'email' | 'verify' | 'payment' | 'success';

const SURVEY_STEPS: Step[] = ['about', 'family', 'saving', 'crypto', 'goals', 'challenge'];

// GA4 analytics helper. Gracefully no-ops if gtag isn't loaded (ad blockers, etc.)
// gtag is injected globally by the <script> tag in website/index.html.
declare global {
  interface Window {
    gtag?: (command: 'event', event: string, params?: Record<string, unknown>) => void;
  }
}
function track(event: string, params?: Record<string, unknown>) {
  try { window.gtag?.('event', event, params); } catch { /* ignore */ }
}

interface FamilyWaitlistModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FamilyWaitlistModal({ open, onClose }: FamilyWaitlistModalProps) {
  const [step, setStep] = useState<Step>('about');
  const [survey, setSurvey] = useState<SurveyData>({});
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'connecting' | 'signing' | 'sending'>('idle');
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);

  // @solana/connector hooks
  const connectors = useWalletConnectors();
  const { connect } = useConnectWallet();
  const { disconnect } = useDisconnectWallet();
  useWallet(); // keep subscription alive even though we read via connectorClient
  const connectorClient = useConnectorClient();

  const closeAndReset = useCallback(() => {
    // Record where users abandon (anything other than the success screen)
    if (step !== 'success') track('family_waitlist_closed', { at_step: step });
    overlayRef.current?.classList.remove('open');
    setTimeout(() => {
      onClose();
      setStep('about');
      setSurvey({});
      setEmail('');
      setCode('');
      setError('');
      setLoading(false);
      setPaid(false);
      setPaymentStatus('idle');
    }, 300);
  }, [onClose, step]);

  useEffect(() => {
    if (!open) return;
    track('family_waitlist_opened');
    document.body.style.overflow = 'hidden';
    setTimeout(() => overlayRef.current?.classList.add('open'), 10);
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAndReset(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, closeAndReset]);

  const stepIndex = SURVEY_STEPS.indexOf(step);
  const isSurveyStep = stepIndex >= 0;
  const progress = isSurveyStep
    ? (stepIndex + 1) / (SURVEY_STEPS.length + 1)
    : step === 'email' || step === 'verify'
      ? 1
      : 1;

  const advance = (action: 'next' | 'skip' = 'next') => {
    setError('');
    const idx = SURVEY_STEPS.indexOf(step);
    if (idx < 0) return;
    track('family_waitlist_step_advanced', { step, action });
    if (idx < SURVEY_STEPS.length - 1) setStep(SURVEY_STEPS[idx + 1]);
    else setStep('email');
  };

  const goBack = () => {
    setError('');
    const idx = SURVEY_STEPS.indexOf(step);
    track('family_waitlist_back', { step });
    if (idx > 0) setStep(SURVEY_STEPS[idx - 1]);
    else if (step === 'email') setStep(SURVEY_STEPS[SURVEY_STEPS.length - 1]);
  };

  const update = <K extends keyof SurveyData>(key: K, value: SurveyData[K]) => {
    setSurvey((s) => ({ ...s, [key]: value }));
  };

  const submitEmail = async () => {
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
        body: JSON.stringify({ email, flow: 'family', survey }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return; }
      track('family_waitlist_email_sent');
      setStep('verify');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitVerify = async () => {
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
      track('family_waitlist_email_verified', { already_paid: Boolean(data.paid) });
      if (data.paid) {
        setPaid(true);
        setStep('success');
      } else {
        setStep('payment');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const runPaymentFlow = useCallback(async (walletId: string, walletAddress: string) => {
    setError('');
    setLoading(true);
    try {
      // 1. Backend builds unsigned tx (transfer + ATA + memo + Helius tip + priority fee)
      setPaymentStatus('sending');
      const intentRes = await fetch(API_BASE + '/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, walletAddress }),
      });
      const intent = await intentRes.json();
      if (!intentRes.ok) throw new Error(intent.error || 'Failed to create payment intent');

      // 2. Sign via @solana/connector's wallet-standard signTransaction feature
      setPaymentStatus('signing');
      if (!connectorClient) throw new Error('Wallet client not available');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wallet = connectorClient.getConnector(walletId as any);
      if (!wallet) throw new Error('Wallet not found');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signFeature = wallet.features['solana:signTransaction'] as any;
      if (!signFeature) throw new Error("Your wallet doesn't support transaction signing.");

      const account = wallet.accounts.find((a) => {
        const accAddr = typeof a.address === 'string' ? a.address : String(a.address);
        return accAddr === walletAddress;
      }) || wallet.accounts[0];
      if (!account) throw new Error('No account found in wallet');

      const txBytes = Uint8Array.from(atob(intent.transaction), (c) => c.charCodeAt(0));

      const [{ signedTransaction }] = await signFeature.signTransaction({
        transaction: txBytes,
        account,
        chain: 'solana:mainnet',
      });

      const signedBase64 = btoa(String.fromCharCode(...new Uint8Array(signedTransaction)));

      // 3. Backend relays via HeliusSender.sendAndConfirm + verifies + marks paid
      setPaymentStatus('sending');
      const submitRes = await fetch(API_BASE + '/payment-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, transaction: signedBase64 }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error || 'Payment submission failed');

      track('family_waitlist_paid', { wallet: walletId });
      setPaid(true);
      setStep('success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Payment failed';
      track('family_waitlist_payment_failed', { reason: msg.slice(0, 120) });
      // User-rejected signing comes through as a generic error — soften the wording.
      setError(/reject|cancel|deny|User/i.test(msg) ? 'Signing cancelled.' : msg);
    } finally {
      setLoading(false);
      setPaymentStatus('idle');
    }
  }, [email, connectorClient]);

  const payNow = () => {
    setError('');
    track('family_waitlist_payment_started');
    // Always present the picker. Disconnect any session @solana/connector auto-restored,
    // so picking a wallet surfaces a fresh approval prompt.
    try { disconnect(); } catch { /* nothing to disconnect */ }
    setWalletPickerOpen(true);
  };

  const onPickWallet = async (walletId: string) => {
    setWalletPickerOpen(false);
    setPaymentStatus('connecting');
    setError('');
    track('family_waitlist_wallet_picked', { wallet: walletId });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      connect(walletId as any);

      // Poll the connector client for the *specific* wallet the user just picked.
      // We deliberately key off the picked walletId (not a generic connectedAddress)
      // so that any leftover/auto-reconnected session from a different wallet
      // doesn't spuriously trigger the payment flow.
      const deadline = Date.now() + 45_000;
      let pickedAddr: string | null = null;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 150));
        if (!connectorClient) continue;
        const snap = connectorClient.getSnapshot();
        if (snap.wallet.status !== 'connected') continue;
        if (snap.wallet.session?.connectorId !== walletId) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = connectorClient.getConnector(walletId as any);
        const acc = w?.accounts[0];
        if (!acc) continue;
        pickedAddr = typeof acc.address === 'string' ? acc.address : String(acc.address);
        break;
      }

      if (!pickedAddr) {
        throw new Error('Wallet connection timed out');
      }

      await runPaymentFlow(walletId, pickedAddr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Wallet connection failed';
      setError(/reject|cancel|deny|User|timed out/i.test(msg) ? 'Wallet connection cancelled.' : msg);
      setPaymentStatus('idle');
    }
  };

  const skipPayment = () => {
    track('family_waitlist_payment_skipped');
    setPaid(false);
    setStep('success');
  };

  if (!open) return null;

  const showBack = (SURVEY_STEPS.includes(step) && step !== 'about') || step === 'email';
  const showSkip = SURVEY_STEPS.includes(step);

  return (
    <div
      ref={overlayRef}
      className="modal-overlay fwl-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) closeAndReset(); }}
    >
      <div className="modal-card fwl-card">
        <button className="modal-close" onClick={closeAndReset} aria-label="Close">&times;</button>

        {step !== 'success' && step !== 'payment' && (
          <div className="fwl-progress" aria-hidden="true">
            <div className="fwl-progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}

        {step === 'about' && (
          <StepShell title="About you" subtitle="Two quick questions — then we get into the fun stuff.">
            <Field label="How do you identify?">
              <ChipRadio options={GENDER_OPTIONS} value={survey.gender} onChange={(v) => update('gender', v)} />
            </Field>
            <Field label="Your age range">
              <ChipRadio options={AGE_OPTIONS} value={survey.ageRange} onChange={(v) => update('ageRange', v)} />
            </Field>
          </StepShell>
        )}

        {step === 'family' && (
          <StepShell title="Your family" subtitle="So we can tailor the vaults to your household.">
            <Field label="Family status">
              <ChipRadio options={FAMILY_STATUS_OPTIONS} value={survey.familyStatus} onChange={(v) => update('familyStatus', v)} />
            </Field>
            <Field label="How many kids?">
              <Stepper value={survey.numberOfKids ?? 0} onChange={(v) => update('numberOfKids', v)} min={0} max={10} />
            </Field>
            {survey.familyStatus === 'married' && (
              <Field label="Do you share a savings account with your spouse?">
                <ChipRadio
                  options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                  value={survey.jointSavingsAccount === true ? 'yes' : survey.jointSavingsAccount === false ? 'no' : undefined}
                  onChange={(v) => update('jointSavingsAccount', v === 'yes')}
                />
              </Field>
            )}
          </StepShell>
        )}

        {step === 'saving' && (
          <StepShell title="How you save today" subtitle="No judgment — everyone starts somewhere.">
            <Field label="Where do you keep your savings? (pick all that apply)">
              <ChipMulti options={SAVINGS_METHODS_OPTIONS} value={survey.savingsMethods ?? []} onChange={(v) => update('savingsMethods', v)} />
            </Field>
            <Field label="About how much do you save each month?">
              <ChipRadio options={MONTHLY_SAVINGS_OPTIONS} value={survey.monthlySavingsAmount} onChange={(v) => update('monthlySavingsAmount', v)} />
            </Field>
          </StepShell>
        )}

        {step === 'crypto' && (
          <StepShell title="Crypto habits" subtitle="This helps us figure out how much hand-holding you want.">
            <Field label="Your crypto comfort level">
              <ChipRadio options={CRYPTO_COMFORT_OPTIONS} value={survey.cryptoComfort} onChange={(v) => update('cryptoComfort', v)} />
            </Field>
            {survey.cryptoComfort && survey.cryptoComfort !== 'never-used' && (
              <Field label="Which DeFi protocols do you use? (optional)">
                <ChipMulti options={DEFI_PROTOCOLS_OPTIONS} value={survey.defiProtocols ?? []} onChange={(v) => update('defiProtocols', v)} />
              </Field>
            )}
          </StepShell>
        )}

        {step === 'goals' && (
          <StepShell title="Dreams & goals" subtitle="What are you saving for — now and later?">
            <Field label="Saving for now">
              <ChipMulti options={GOAL_OPTIONS} value={survey.currentGoals ?? []} onChange={(v) => update('currentGoals', v)} />
            </Field>
            <Field label="Would like to start">
              <ChipMulti options={GOAL_OPTIONS} value={survey.futureGoals ?? []} onChange={(v) => update('futureGoals', v)} />
            </Field>
          </StepShell>
        )}

        {step === 'challenge' && (
          <StepShell title="What's in the way?" subtitle="Honest answers help us build the right product.">
            <Field label="Biggest savings challenge">
              <ChipRadio options={CHALLENGE_OPTIONS} value={survey.savingsChallenge} onChange={(v) => update('savingsChallenge', v)} />
            </Field>
          </StepShell>
        )}

        {step === 'email' && (
          <StepShell title="Almost there" subtitle="Drop your email and we'll save your spot.">
            <div className="fwl-email-row">
              <input
                type="email"
                autoFocus
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitEmail(); }}
                className="fwl-input"
              />
            </div>
            {error && <p className="waitlist-error">{error}</p>}
          </StepShell>
        )}

        {step === 'verify' && (
          <StepShell title="Check your inbox" subtitle={`We sent a 6-digit code to ${email}.`}>
            <div className="fwl-email-row fwl-verify-row">
              <input
                type="text"
                autoFocus
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitVerify(); }}
                className="fwl-input fwl-code"
              />
            </div>
            {error && <p className="waitlist-error">{error}</p>}
          </StepShell>
        )}

        {step === 'payment' && !walletPickerOpen && (
          <div className="fwl-step fwl-step-pay">
            <div className="fwl-pass">
              <div className="fwl-pass-shine" aria-hidden="true" />

              <div className="fwl-pass-ribbon">
                <Sparkles size={14} strokeWidth={2.4} />
                Founding Family Pass
              </div>

              <h2 className="fwl-pass-title">
                Be a founding family.
              </h2>
              <p className="fwl-pass-pitch">
                Your family's spot in the first 100. Every perk locked in forever — for a single 5 USDC.
              </p>

              <div className="fwl-price">
                <div className="fwl-price-row">
                  <span className="fwl-price-num">5</span>
                  <div className="fwl-price-unit">
                    <span>USDC</span>
                    <small>one-time</small>
                  </div>
                </div>
                <span className="fwl-price-note">locked in — forever</span>
              </div>

              <div className="fwl-pass-divider" aria-hidden="true" />

              <ul className="fwl-pass-perks">
                <li>
                  <span className="fwl-perk-icon"><BadgePercent size={18} strokeWidth={2} /></span>
                  <div>
                    <strong>Waive all launch fees</strong>
                    <span>up to $180 a year, skipped</span>
                  </div>
                </li>
                <li>
                  <span className="fwl-perk-icon"><TrendingUp size={18} strokeWidth={2} /></span>
                  <div>
                    <strong>Yield boost</strong>
                    <span>first 6 months after launch</span>
                  </div>
                </li>
                <li>
                  <span className="fwl-perk-icon"><Rocket size={18} strokeWidth={2} /></span>
                  <div>
                    <strong>Early access</strong>
                    <span>skip the general waitlist</span>
                  </div>
                </li>
                <li>
                  <span className="fwl-perk-icon"><Award size={18} strokeWidth={2} /></span>
                  <div>
                    <strong>Founding-family badge</strong>
                    <span>in the app — visible forever</span>
                  </div>
                </li>
              </ul>

              <div className="fwl-pass-assurance">
                <Lock size={12} strokeWidth={2.2} />
                Solana · one-time · only 100 founding spots
              </div>
            </div>

            {error && <p className="waitlist-error fwl-pay-error">{error}</p>}
          </div>
        )}

        {step === 'payment' && walletPickerOpen && (
          <div className="fwl-step fwl-step-pay fwl-step-picker">
            <h2 className="fwl-picker-title">Connect your wallet</h2>
            <p className="fwl-picker-sub">Pick any Solana wallet to pay the 5 USDC.</p>

            <div className="fwl-wallet-list">
              {connectors.length === 0 ? (
                <div className="fwl-wallet-empty">
                  No Solana wallets detected.<br />
                  Install{' '}
                  <a href="https://phantom.app" target="_blank" rel="noopener">Phantom</a>
                  , <a href="https://solflare.com" target="_blank" rel="noopener">Solflare</a>
                  , or any Solana wallet extension and refresh the page.
                </div>
              ) : (
                connectors.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="fwl-wallet-item"
                    onClick={() => onPickWallet(w.id)}
                  >
                    {w.icon && <img src={w.icon} alt="" />}
                    <span>{w.name}</span>
                    <ArrowRight size={16} strokeWidth={2} />
                  </button>
                ))
              )}
            </div>

            {error && <p className="waitlist-error fwl-pay-error">{error}</p>}
          </div>
        )}

        {step === 'success' && (
          <div className="fwl-success">
            <div className="fwl-success-icon" aria-hidden="true">
              <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="30" fill="#E8B558" />
                <path d="M20 34l8 8 16-18" stroke="#3E2F22" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
            </div>
            <h2>{paid ? "You're a founding family!" : "You're on the list!"}</h2>
            <p>
              {paid
                ? "We'll email you the moment Family Savings opens up — and your perks are locked in."
                : "We'll let you know the moment Family Savings launches. Thanks for sharing your story with us."}
            </p>
            <button className="btn btn-l btn-gradient" onClick={closeAndReset}>Close</button>
          </div>
        )}

        {step !== 'success' && (
          <div className="fwl-footer">
            {showBack ? (
              <button className="fwl-link" onClick={goBack}>← Back</button>
            ) : <span />}

            <div className="fwl-footer-right">
              {showSkip && (
                <button className="fwl-link" onClick={() => advance('skip')}>Skip</button>
              )}
              {isSurveyStep && (
                <button className="btn btn-m btn-gradient" onClick={() => advance('next')}>Next</button>
              )}
              {step === 'email' && (
                <button className="btn btn-m btn-gradient" onClick={submitEmail} disabled={loading}>
                  {loading ? 'Sending…' : 'Send code'}
                </button>
              )}
              {step === 'verify' && (
                <button className="btn btn-m btn-gradient" onClick={submitVerify} disabled={loading}>
                  {loading ? 'Verifying…' : 'Verify'}
                </button>
              )}
              {step === 'payment' && !walletPickerOpen && (
                <>
                  <button className="fwl-link fwl-link-subtle" onClick={skipPayment} disabled={loading}>
                    No thanks, I'll wait
                  </button>
                  <button className="btn btn-l btn-gradient fwl-pay-btn" onClick={payNow} disabled={loading}>
                    {paymentStatus === 'connecting' && 'Connecting…'}
                    {paymentStatus === 'signing' && 'Sign in your wallet…'}
                    {paymentStatus === 'sending' && 'Sending…'}
                    {paymentStatus === 'idle' && (
                      <>
                        Pay 5 USDC
                        <ArrowRight size={18} strokeWidth={2.4} />
                      </>
                    )}
                  </button>
                </>
              )}
              {step === 'payment' && walletPickerOpen && (
                <button
                  className="fwl-link fwl-link-subtle"
                  onClick={() => setWalletPickerOpen(false)}
                >
                  ← Back
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── sub-components ──

function StepShell({ title, subtitle, children, compact }: {
  title: string; subtitle?: string; children?: React.ReactNode; compact?: boolean;
}) {
  return (
    <div className={`fwl-step ${compact ? 'fwl-step-compact' : ''}`}>
      <h2>{title}</h2>
      {subtitle && <p className="fwl-subtitle">{subtitle}</p>}
      <div className="fwl-fields">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fwl-field">
      <span className="fwl-field-label">{label}</span>
      {children}
    </div>
  );
}

function ChipRadio({ options, value, onChange }: {
  options: Option[]; value?: string; onChange: (v: string) => void;
}) {
  return (
    <div className="fwl-chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`fwl-chip ${value === o.value ? 'fwl-chip-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ChipMulti({ options, value, onChange }: {
  options: Option[]; value: string[]; onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };
  return (
    <div className="fwl-chips">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`fwl-chip ${value.includes(o.value) ? 'fwl-chip-active' : ''}`}
          onClick={() => toggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stepper({ value, onChange, min, max }: {
  value: number; onChange: (v: number) => void; min: number; max: number;
}) {
  return (
    <div className="fwl-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Decrease">−</button>
      <span className="fwl-stepper-value">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Increase">+</button>
    </div>
  );
}
