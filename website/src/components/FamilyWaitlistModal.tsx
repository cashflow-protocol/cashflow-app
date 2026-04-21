import { useState, useEffect, useRef, useCallback } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import {
  address,
  createSolanaRpc,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  getTransactionEncoder,
  getBase58Decoder,
  pipe,
} from '@solana/kit';
import {
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  TOKEN_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import { getAddMemoInstruction } from '@solana-program/memo';
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
const RPC_URL = 'https://api.mainnet-beta.solana.com';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

type Step =
  | 'about' | 'family' | 'saving' | 'crypto' | 'goals' | 'challenge'
  | 'email' | 'verify' | 'payment' | 'success';

const SURVEY_STEPS: Step[] = ['about', 'family', 'saving', 'crypto', 'goals', 'challenge'];

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
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'connecting' | 'signing' | 'confirming'>('idle');

  const overlayRef = useRef<HTMLDivElement>(null);

  const { login, authenticated } = usePrivy();
  const { wallets: privyWallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  const closeAndReset = useCallback(() => {
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
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
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

  const goNext = () => {
    setError('');
    const idx = SURVEY_STEPS.indexOf(step);
    if (idx >= 0 && idx < SURVEY_STEPS.length - 1) setStep(SURVEY_STEPS[idx + 1]);
    else if (step === SURVEY_STEPS[SURVEY_STEPS.length - 1]) setStep('email');
  };

  const goBack = () => {
    setError('');
    const idx = SURVEY_STEPS.indexOf(step);
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
      if (data.message === 'Already on waitlist') { setStep('payment'); return; }
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
      setStep('payment');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const payNow = async () => {
    setError('');

    // Ensure Privy wallet is available
    if (!authenticated || privyWallets.length === 0) {
      setPaymentStatus('connecting');
      try {
        await login();
      } catch {
        setPaymentStatus('idle');
        setError('Wallet connection cancelled.');
        return;
      }
    }

    // Wait a tick for wallet to propagate after login
    const wallet = privyWallets[0];
    if (!wallet) {
      setPaymentStatus('idle');
      setError('No Solana wallet found. Try again.');
      return;
    }

    setPaymentStatus('signing');
    setLoading(true);
    try {
      // 1. Create payment intent
      const intentRes = await fetch(API_BASE + '/payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, walletAddress: wallet.address }),
      });
      const intent = await intentRes.json();
      if (!intentRes.ok) throw new Error(intent.error || 'Failed to create payment intent');

      // 2. Build tx
      const rpc = createSolanaRpc(RPC_URL);
      const mint = address(intent.mint);
      const userAddr = address(wallet.address);
      const treasuryAddr = address(intent.treasury);

      const [userAta] = await findAssociatedTokenPda({
        mint, owner: userAddr, tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });
      const [treasuryAta] = await findAssociatedTokenPda({
        mint, owner: treasuryAddr, tokenProgram: TOKEN_PROGRAM_ADDRESS,
      });

      const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
        payer: { address: userAddr } as never,
        ata: treasuryAta,
        owner: treasuryAddr,
        mint,
      });
      const transferIx = getTransferCheckedInstruction({
        source: userAta,
        mint,
        destination: treasuryAta,
        authority: { address: userAddr } as never,
        amount: BigInt(intent.amount),
        decimals: intent.decimals,
      });
      const memoIx = getAddMemoInstruction({ memo: intent.memoNonce });

      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

      const txMessage = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(userAddr, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
        (m) => appendTransactionMessageInstructions([createAtaIx, transferIx, memoIx], m),
      );
      const compiled = compileTransaction(txMessage);
      const txBytes = getTransactionEncoder().encode(compiled);

      // 3. Sign + send via Privy — returns { signature: Uint8Array }
      const sendResult = await signAndSendTransaction({
        transaction: txBytes as Uint8Array,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wallet: wallet as any,
      });
      const sigBytes = (sendResult as { signature: Uint8Array }).signature;
      const signature = getBase58Decoder().decode(sigBytes);

      // 4. Confirm on backend
      setPaymentStatus('confirming');
      const confirmRes = await fetch(API_BASE + '/payment-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, txSignature: signature }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error || 'Payment confirmation failed');

      setPaid(true);
      setStep('success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Payment failed';
      setError(msg);
    } finally {
      setLoading(false);
      setPaymentStatus('idle');
    }
  };

  const skipPayment = () => {
    setPaid(false);
    setStep('success');
  };

  if (!open) return null;

  const showBack = (SURVEY_STEPS.includes(step) && step !== 'about') || step === 'email';
  const showSkip = SURVEY_STEPS.includes(step);

  // Note: `ASSOCIATED_TOKEN_PROGRAM_ADDRESS` is imported only to pin the package — actual address
  // comes from findAssociatedTokenPda internals. Referenced here to avoid unused-import TS error.
  void ASSOCIATED_TOKEN_PROGRAM_ADDRESS;

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

        {step === 'payment' && (
          <StepShell
            title="Get early access"
            subtitle="Pay 5 USDC and join the founding families cohort."
            compact
          >
            <ul className="fwl-perks">
              <li><strong>First to try</strong> the family vault, kids' savings, and joint goals</li>
              <li><strong>Waived launch fees</strong> on your first year</li>
              <li><strong>Better yield terms</strong> on early deposits</li>
              <li><strong>Founding-family badge</strong> in the app</li>
            </ul>
            {error && <p className="waitlist-error">{error}</p>}
          </StepShell>
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
                <button className="fwl-link" onClick={goNext}>Skip</button>
              )}
              {isSurveyStep && (
                <button className="btn btn-m btn-gradient" onClick={goNext}>Next</button>
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
              {step === 'payment' && (
                <>
                  <button className="fwl-link" onClick={skipPayment} disabled={loading}>Skip for now</button>
                  <button className="btn btn-m btn-gradient" onClick={payNow} disabled={loading}>
                    {paymentStatus === 'connecting' && 'Connecting wallet…'}
                    {paymentStatus === 'signing' && 'Preparing tx…'}
                    {paymentStatus === 'confirming' && 'Confirming…'}
                    {paymentStatus === 'idle' && 'Pay 5 USDC'}
                  </button>
                </>
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
