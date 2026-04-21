import { Router, Request, Response } from 'express';
import { BrevoClient } from '@getbrevo/brevo';
import { randomBytes } from 'crypto';
import { createSolanaRpc, type Rpc, type SolanaRpcApi, type Signature } from '@solana/kit';
import { WaitlistEntryModel, FamilyWaitlistEntryModel } from '../models';

const router = Router();

const BREVO_LIST_ID = 14;
const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDC_DECIMALS = 6;
const WAITLIST_PAYMENT_AMOUNT = 5_000_000n; // 5 USDC

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

// In-memory store for verification codes (email -> { code, expiresAt, isFamily })
// `isFamily` tells /verify which model to mark verified.
const pendingCodes = new Map<string, { code: string; expiresAt: number; isFamily: boolean }>();

function getBrevoClient() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY is required');
  return new BrevoClient({ apiKey });
}

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── Survey whitelist ──
const SINGLE_SELECT_FIELDS = [
  'gender', 'ageRange', 'familyStatus', 'monthlySavingsAmount',
  'cryptoComfort', 'savingsChallenge',
] as const;
const MULTI_SELECT_FIELDS = [
  'savingsMethods', 'defiProtocols', 'currentGoals', 'futureGoals',
] as const;

function sanitizeSurvey(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const s = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of SINGLE_SELECT_FIELDS) {
    const v = s[key];
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) out[key] = v;
  }
  for (const key of MULTI_SELECT_FIELDS) {
    const v = s[key];
    if (Array.isArray(v)) {
      const filtered = v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64).slice(0, 20);
      if (filtered.length > 0) out[key] = filtered;
    }
  }
  if (typeof s.numberOfKids === 'number' && Number.isFinite(s.numberOfKids)) {
    out.numberOfKids = Math.max(0, Math.min(20, Math.floor(s.numberOfKids)));
  }
  if (typeof s.jointSavingsAccount === 'boolean') {
    out.jointSavingsAccount = s.jointSavingsAccount;
  }
  return out;
}

// POST /waitlist/v1/send-code
// Body: { email, flow?: 'family', survey?: {...} }
// - flow === 'family' → FamilyWaitlistEntry (with survey data)
// - otherwise         → WaitlistEntry (minimal, existing behavior for main landing)
router.post('/send-code', async (req: Request, res: Response) => {
  try {
    const { email, flow, survey } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const isFamily = flow === 'family';

    if (isFamily) {
      const cleanSurvey = sanitizeSurvey(survey);
      const hasSurvey = Object.keys(cleanSurvey).length > 0;

      const existing = await FamilyWaitlistEntryModel.findOne({ email: normalizedEmail, verified: true });
      if (existing) {
        if (hasSurvey) {
          await FamilyWaitlistEntryModel.updateOne(
            { email: normalizedEmail },
            { $set: { ...cleanSurvey, surveyCompletedAt: new Date() } },
          );
        }
        res.json({ success: true, message: 'Already on waitlist' });
        return;
      }

      // Persist partial entry with survey data (unverified) so we don't lose it if they bail
      if (hasSurvey) {
        await FamilyWaitlistEntryModel.findOneAndUpdate(
          { email: normalizedEmail },
          {
            $set: { email: normalizedEmail, ...cleanSurvey, surveyCompletedAt: new Date() },
            $setOnInsert: { verified: false },
          },
          { upsert: true },
        );
      }
    } else {
      const existing = await WaitlistEntryModel.findOne({ email: normalizedEmail, verified: true });
      if (existing) {
        res.json({ success: true, message: 'Already on waitlist' });
        return;
      }
    }

    const code = generateCode();
    pendingCodes.set(normalizedEmail, { code, expiresAt: Date.now() + CODE_EXPIRY_MS, isFamily });

    const brevo = getBrevoClient();
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: 'Cashflow', email: 'hello@cashflow.fun' },
      to: [{ email: normalizedEmail }],
      subject: 'Your Cashflow verification code',
      htmlContent: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #000; margin-bottom: 8px;">Verify your email</h2>
          <p style="color: #666; margin-bottom: 32px;">Use this code to join the Cashflow waitlist:</p>
          <div style="background: #f4f6fc; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #175DA3;">${code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    res.json({ success: true, message: 'Verification code sent' });
  } catch (error) {
    console.error('[waitlist] send-code error:', error);
    res.status(500).json({ success: false, error: 'Failed to send verification code' });
  }
});

// POST /waitlist/v1/verify
router.post('/verify', async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ success: false, error: 'Email and code are required' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const pending = pendingCodes.get(normalizedEmail);

    if (!pending) {
      res.status(400).json({ success: false, error: 'No verification code found. Please request a new one.' });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      pendingCodes.delete(normalizedEmail);
      res.status(400).json({ success: false, error: 'Code expired. Please request a new one.' });
      return;
    }

    if (pending.code !== code.trim()) {
      res.status(400).json({ success: false, error: 'Invalid code' });
      return;
    }

    const { isFamily } = pending;
    pendingCodes.delete(normalizedEmail);

    const Model = isFamily ? FamilyWaitlistEntryModel : WaitlistEntryModel;
    await Model.findOneAndUpdate(
      { email: normalizedEmail },
      { $set: { email: normalizedEmail, verified: true } },
      { upsert: true },
    );

    try {
      const brevo = getBrevoClient();
      await brevo.contacts.createContact({
        email: normalizedEmail,
        listIds: [BREVO_LIST_ID],
        updateEnabled: true,
      });
    } catch (brevoError) {
      console.error('[waitlist] Brevo contact creation error:', brevoError);
    }

    res.json({ success: true, message: 'Email verified! You\'re on the waitlist.' });
  } catch (error) {
    console.error('[waitlist] verify error:', error);
    res.status(500).json({ success: false, error: 'Verification failed' });
  }
});

// POST /waitlist/v1/payment-intent
// Builds an unsigned VersionedTransaction: tip + (optional) create-ATA + transferChecked + memo,
// with the user's wallet as fee payer. Returns base64 for the client to sign.
router.post('/payment-intent', async (req: Request, res: Response) => {
  try {
    const { email, walletAddress } = req.body;
    if (!email || typeof email !== 'string') {
      res.status(400).json({ success: false, error: 'Email is required' });
      return;
    }
    if (!walletAddress || typeof walletAddress !== 'string') {
      res.status(400).json({ success: false, error: 'walletAddress is required' });
      return;
    }

    const treasury = process.env.TREASURY_WALLET_ADDRESS;
    if (!treasury) {
      res.status(503).json({ success: false, error: 'Payment not configured' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const entry = await FamilyWaitlistEntryModel.findOne({ email: normalizedEmail, verified: true });
    if (!entry) {
      res.status(404).json({ success: false, error: 'Please verify your email first' });
      return;
    }

    if (entry.paid) {
      res.status(409).json({ success: false, error: 'Payment already received' });
      return;
    }

    const memoNonce = 'cfwl-' + randomBytes(6).toString('hex');

    // Lazy-import web3.js + spl-token + HeliusSender (all backend-only deps)
    const {
      Connection, PublicKey, TransactionMessage, VersionedTransaction,
      TransactionInstruction, ComputeBudgetProgram,
    } = await import('@solana/web3.js');
    const {
      createAssociatedTokenAccountIdempotentInstruction,
      createTransferCheckedInstruction,
      getAssociatedTokenAddressSync,
    } = await import('@solana/spl-token');
    const { HeliusSender } = await import('../managers/HeliusSender');

    const connection = new Connection(rpcUrl, 'confirmed');
    const userPubkey = new PublicKey(walletAddress);
    const treasuryPubkey = new PublicKey(treasury);
    const mintPubkey = new PublicKey(USDC_MINT);

    const userAta = getAssociatedTokenAddressSync(mintPubkey, userPubkey);
    const treasuryAta = getAssociatedTokenAddressSync(mintPubkey, treasuryPubkey);

    const memoIx = new TransactionInstruction({
      keys: [],
      programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
      data: Buffer.from(memoNonce, 'utf8'),
    });

    const instructions = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 80_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      createAssociatedTokenAccountIdempotentInstruction(
        userPubkey, treasuryAta, treasuryPubkey, mintPubkey,
      ),
      createTransferCheckedInstruction(
        userAta, mintPubkey, treasuryAta, userPubkey,
        WAITLIST_PAYMENT_AMOUNT, USDC_DECIMALS,
      ),
      memoIx,
      HeliusSender.createTipIx(userPubkey),
    ];

    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    const messageV0 = new TransactionMessage({
      payerKey: userPubkey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(messageV0);
    const base64Tx = Buffer.from(tx.serialize()).toString('base64');

    await FamilyWaitlistEntryModel.updateOne(
      { email: normalizedEmail },
      { $set: { paidNonce: memoNonce, paidWalletAddress: walletAddress } },
    );

    res.json({
      success: true,
      transaction: base64Tx,
      treasury,
      mint: USDC_MINT,
      decimals: USDC_DECIMALS,
      amount: WAITLIST_PAYMENT_AMOUNT.toString(),
      memoNonce,
    });
  } catch (error) {
    console.error('[waitlist] payment-intent error:', error);
    res.status(500).json({ success: false, error: 'Failed to create payment intent' });
  }
});

// POST /waitlist/v1/payment-submit
// Accepts a signed base64 tx, relays it via HeliusSender (with tip for SWQoS), waits for
// confirmation, then verifies treasury USDC delta + memo matches the stored nonce. Marks paid.
router.post('/payment-submit', async (req: Request, res: Response) => {
  try {
    const { email, transaction } = req.body;
    if (!email || !transaction || typeof transaction !== 'string') {
      res.status(400).json({ success: false, error: 'Email and transaction are required' });
      return;
    }

    const treasury = process.env.TREASURY_WALLET_ADDRESS;
    if (!treasury) {
      res.status(503).json({ success: false, error: 'Payment not configured' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const entry = await FamilyWaitlistEntryModel.findOne({ email: normalizedEmail, verified: true });
    if (!entry) {
      res.status(404).json({ success: false, error: 'Email not on waitlist' });
      return;
    }

    if (entry.paid) {
      res.json({ success: true, message: 'Already paid', txSignature: entry.paidTxSignature });
      return;
    }

    const expectedNonce = entry.paidNonce;
    if (!expectedNonce) {
      res.status(400).json({ success: false, error: 'No payment intent. Call /payment-intent first.' });
      return;
    }

    // Send via HeliusSender with Jito tip (already included as an ix in the tx)
    const { HeliusSender } = await import('../managers/HeliusSender');
    let signature: string;
    try {
      signature = await HeliusSender.sendAndConfirm(transaction);
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : 'Transaction failed';
      console.error('[waitlist] HeliusSender error:', sendErr);
      res.status(400).json({ success: false, error: msg });
      return;
    }

    // Verify the confirmed tx: treasury USDC delta + memo nonce
    type TokenBalance = { owner?: string; mint?: string; uiTokenAmount?: { amount?: string } };
    type ParsedIx = { program?: string; programId?: string; parsed?: unknown };
    type ParsedTx = {
      meta?: { err?: unknown; preTokenBalances?: readonly TokenBalance[]; postTokenBalances?: readonly TokenBalance[] } | null;
      transaction?: { message?: { instructions?: readonly ParsedIx[] } };
    };

    const raw = await rpc
      .getTransaction(signature as Signature, {
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
      .send();
    const txRes = raw as unknown as ParsedTx | null;

    if (!txRes || txRes.meta?.err) {
      res.status(400).json({ success: false, error: 'Transaction not confirmed on-chain' });
      return;
    }

    const preBalances = txRes.meta?.preTokenBalances ?? [];
    const postBalances = txRes.meta?.postTokenBalances ?? [];
    const findTreasuryUsdc = (arr: readonly TokenBalance[]) =>
      arr.find((b) => b.owner === treasury && b.mint === USDC_MINT);
    const preAmount = BigInt(findTreasuryUsdc(preBalances)?.uiTokenAmount?.amount ?? '0');
    const postAmount = BigInt(findTreasuryUsdc(postBalances)?.uiTokenAmount?.amount ?? '0');
    const delta = postAmount - preAmount;

    if (delta < WAITLIST_PAYMENT_AMOUNT) {
      res.status(400).json({ success: false, error: 'Insufficient payment amount' });
      return;
    }

    const instructions = txRes.transaction?.message?.instructions ?? [];
    const memoIx = instructions.find(
      (ix) => ix.program === 'spl-memo' || ix.programId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    );
    const memoString = typeof memoIx?.parsed === 'string' ? memoIx.parsed : '';
    if (!memoString.includes(expectedNonce)) {
      res.status(400).json({ success: false, error: 'Payment memo mismatch' });
      return;
    }

    const alreadyUsed = await FamilyWaitlistEntryModel.findOne({ paidTxSignature: signature });
    if (alreadyUsed && alreadyUsed.email !== normalizedEmail) {
      res.status(409).json({ success: false, error: 'Transaction signature already used' });
      return;
    }

    await FamilyWaitlistEntryModel.updateOne(
      { email: normalizedEmail },
      {
        $set: {
          paid: true,
          paidAmount: Number(delta),
          paidTxSignature: signature,
          paidAt: new Date(),
        },
      },
    );

    res.json({ success: true, message: 'Payment confirmed', txSignature: signature });
  } catch (error) {
    console.error('[waitlist] payment-submit error:', error);
    res.status(500).json({ success: false, error: 'Payment submission failed' });
  }
});

export default router;
