import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import bs58 from 'bs58';
import { SOLANA_CONFIG } from '../config/solana';
import { saveVault, getVault, clearVault, type VaultData } from './vaultStorage';
import apiService from './apiService';
import walletService from './walletService';
import {
  generateAndStoreCloudKeypair,
  generateAndStoreDeviceKeypair,
  getCloudPublicKey,
  getDevicePublicKey,
  signWithCloud,
  signWithDevice,
} from './keypairStorage';
import { createCoverFromSquadInstruction, createCoverInstruction } from '@heymike/send';
import { address as kitAddress } from '@solana/kit';
import { IS_SOLANA_MOBILE, getVaultCreationFee, getAdminTxFeePayerPublicKey, ADMIN_COVER_TARGET, DEFAULT_SPENDING_LIMIT } from '../config/constants';
import { logError } from './analyticsService';
import mobileErrorTracker from './mobileErrorTracker';

const { Permission, Permissions } = multisig.types;

// Fixed vote-only co-signer wallets added to every newly created squad vault
export const EXTRA_VOTE_ONLY_MEMBERS = [
  'GyBg4isA9bVVPR55HEpZxXGoBUDmxPi9YZFTzDap1GGu',
  'DPJRJkwWrFxoMcjMFbfon1v2S8wwPY4S86PaFCmTBig4',
];

// 8 Jito tip accounts — pick one at random per bundle
const JITO_TIP_ACCOUNTS = [
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

const JITO_TIP_FALLBACK_LAMPORTS = 500_000; // 0.0005 SOL

// Address Lookup Table for transaction compression (fetched from backend config)
let cachedLuts: AddressLookupTableAccount[] | null = null;

async function getLuts(conn: Connection): Promise<AddressLookupTableAccount[]> {
  if (cachedLuts) return cachedLuts;
  try {
    const config = await apiService.getConfig();
    if (config.lookupTableAddress) {
      const res = await conn.getAddressLookupTable(new PublicKey(config.lookupTableAddress));
      cachedLuts = res.value ? [res.value] : [];
    } else {
      cachedLuts = [];
    }
  } catch {
    cachedLuts = [];
  }
  return cachedLuts;
}

// Web3.js connection for @sqds/multisig SDK calls
// Uses `let` so it can be recreated after the backend RPC URL is applied.
let connection = new Connection(SOLANA_CONFIG.rpcEndpoint, SOLANA_CONFIG.commitment);

/** Recreate the connection with the current RPC endpoint. Call after setSolanaRpcEndpoint(). */
export function resetSquadsConnection(): void {
  connection = new Connection(SOLANA_CONFIG.rpcEndpoint, SOLANA_CONFIG.commitment);
  cachedLuts = null;
}

/** Resolved signing context — shared by all vault operations */
interface SigningContext {
  seekerMode: boolean;
  cloudPubkey: PublicKey | null;
  devicePubkey: PublicKey;
  walletPubkey: PublicKey | null;
  /** Primary key used as creator/executor/payer: MWA wallet on Seeker, cloud key otherwise */
  primaryKey: PublicKey;
}

/** Resolve cloud/device/wallet keys and seekerMode from vault storage */
async function getSigningContext(errorPrefix: string): Promise<SigningContext> {
  const vaultData = await getVault();
  const seekerMode = IS_SOLANA_MOBILE;

  const devicePubBase58 = await getDevicePublicKey();
  if (!devicePubBase58) {
    logError(errorPrefix, 'device_keypair_not_found');
    throw new Error('Device keypair not found. Please recreate your vault.');
  }
  const devicePubkey = new PublicKey(devicePubBase58);

  let cloudPubkey: PublicKey | null = null;
  if (!seekerMode) {
    const cloudPubBase58 = await getCloudPublicKey();
    if (!cloudPubBase58) {
      logError(errorPrefix, 'cloud_keypair_not_found');
      throw new Error('Cloud keypair not found. Please recreate your vault.');
    }
    cloudPubkey = new PublicKey(cloudPubBase58);
  }

  let walletPubkey: PublicKey | null = null;
  if (IS_SOLANA_MOBILE) {
    if (!vaultData?.walletAddress) {
      logError(errorPrefix, 'wallet_address_not_found');
      throw new Error('Wallet address not found. Please recreate your vault.');
    }
    walletPubkey = new PublicKey(vaultData.walletAddress);
  }

  const primaryKey = seekerMode ? walletPubkey! : cloudPubkey!;

  return { seekerMode, cloudPubkey, devicePubkey, walletPubkey, primaryKey };
}

/**
 * Build approval instructions for a proposal.
 * Seeker: MWA wallet + device. Standard: cloud + device (+ wallet if MWA).
 */
function buildApprovalIxs(
  ctx: SigningContext,
  multisigPda: PublicKey,
  transactionIndex: bigint,
): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (ctx.seekerMode) {
    ixs.push(
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: ctx.walletPubkey! }),
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: ctx.devicePubkey }),
    );
  } else {
    ixs.push(
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: ctx.cloudPubkey! }),
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: ctx.devicePubkey }),
    );
    if (IS_SOLANA_MOBILE && ctx.walletPubkey) {
      ixs.push(multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: ctx.walletPubkey }));
    }
  }
  return ixs;
}

/**
 * Sign TX1 (create+propose+approve) and TX2 (execute) then send as Jito bundle.
 * Handles Seeker vs standard signing patterns.
 */
async function signAndSendConfigBundle(
  ctx: SigningContext,
  tx1: VersionedTransaction,
  tx2: VersionedTransaction,
): Promise<string> {
  if (ctx.seekerMode) {
    // Seeker: MWA signs first, then device co-signs TX1.
    // We serialize from the MWA-returned transactions to ensure message + signatures match.
    const serialized = [tx1, tx2].map(tx => new Uint8Array(tx.serialize()));
    const signedBytes = await walletService.signTransactions(serialized);

    const signedTx1 = VersionedTransaction.deserialize(signedBytes[0]);
    const signedTx2 = VersionedTransaction.deserialize(signedBytes[1]);

    // TX1 also needs device key signature (on MWA's message)
    await signTransactionNatively(signedTx1, [
      { pubkey: ctx.devicePubkey, signFn: signWithDevice },
    ]);

    const tx1Base64 = Buffer.from(signedTx1.serialize()).toString('base64');
    const tx2Base64 = Buffer.from(signedTx2.serialize()).toString('base64');
    await apiService.sendBundle([tx1Base64, tx2Base64]);
    return bs58.encode(signedTx2.signatures[0]);
  } else {
    // Cloud signs both, device signs TX1
    await signTransactionNatively(tx1, [
      { pubkey: ctx.cloudPubkey!, signFn: signWithCloud },
      { pubkey: ctx.devicePubkey, signFn: signWithDevice },
    ]);
    await signTransactionNatively(tx2, [
      { pubkey: ctx.cloudPubkey!, signFn: signWithCloud },
    ]);
    if (IS_SOLANA_MOBILE && ctx.walletPubkey) {
      await signTransactionsWithWallet([tx1, tx2], [0], ctx.walletPubkey);
    }
  }

  // Simulate TX1 before sending to catch program errors early
  try {
    const sim1 = await connection.simulateTransaction(tx1, { sigVerify: false });
    if (sim1.value.err) {
      console.error('[ConfigBundle] TX1 simulation failed:', JSON.stringify(sim1.value.err));
      console.error('[ConfigBundle] TX1 logs:', sim1.value.logs);
      throw new Error(`TX1 simulation failed: ${JSON.stringify(sim1.value.err)}`);
    }
    console.log('[ConfigBundle] TX1 simulation OK');
  } catch (simErr: any) {
    if (simErr.message?.includes('simulation failed')) throw simErr;
    console.warn('[ConfigBundle] TX1 simulation error (non-fatal):', simErr.message);
  }

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
  await apiService.sendBundle([tx1Base64, tx2Base64]);
  return bs58.encode(tx2.signatures[0]);
}

export interface MultisigInfo {
  address: string;
  vaultAddress: string;
  threshold: number;
  transactionIndex: bigint;
  members: Array<{
    address: string;
    permissions: {
      initiate: boolean;
      vote: boolean;
      execute: boolean;
    };
  }>;
}

export interface CreateMultisigResult {
  multisigAddress: string;
  vaultAddress: string;
  signature: string;
}

/**
 * Build vaultTransactionExecute instruction WITHOUT an RPC read.
 *
 * Uses the SDK's own serialisation to produce the exact same inner-message
 * byte layout that vaultTransactionCreate stores onchain (which allows
 * program IDs to live in LUTs via `compileToWrappedMessageV0`).
 * Standard web3.js `compileToV0Message` keeps program IDs in static keys,
 * so using it here would produce a mismatched account list.
 */
function buildVaultExecuteIx(
  multisigPda: PublicKey,
  transactionIndex: bigint,
  member: PublicKey,
  vaultPda: PublicKey,
  innerMessage: TransactionMessage,
  luts: AddressLookupTableAccount[],
): TransactionInstruction {
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex });
  const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: transactionIndex });

  // Serialize with SDK's custom compilation (program IDs can go into LUTs),
  // then deserialize to get the exact account layout stored onchain.
  const messageBytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({
    message: innerMessage,
    addressLookupTableAccounts: luts.length > 0 ? luts : undefined,
    vaultPda,
  });
  const [msg] = (multisig.types as any).transactionMessageBeet.deserialize(
    Buffer.from(messageBytes),
  );

  const accountMetas: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] = [];

  // 1. LUT account keys — needed for onchain validation
  for (const lookup of msg.addressTableLookups) {
    accountMetas.push({
      pubkey: lookup.accountKey,
      isWritable: false,
      isSigner: false,
    });
  }

  // 2. Static account keys with proper writable/signer flags
  for (let i = 0; i < msg.accountKeys.length; i++) {
    const pubkey = msg.accountKeys[i];
    const isWritable = i < msg.numWritableSigners ||
      (i >= msg.numSigners && (i - msg.numSigners) < msg.numWritableNonSigners);
    accountMetas.push({
      pubkey,
      isWritable,
      isSigner: i < msg.numSigners && !pubkey.equals(vaultPda),
    });
  }

  // 3. LUT-resolved addresses (writable first, then readonly — per LUT)
  const lutMap = new Map(luts.map((l) => [l.key.toBase58(), l]));
  for (const lookup of msg.addressTableLookups) {
    const lutAccount = lutMap.get(lookup.accountKey.toBase58());
    if (!lutAccount) continue;

    for (const idx of lookup.writableIndexes) {
      const pubkey = lutAccount.state.addresses[idx];
      if (pubkey) {
        accountMetas.push({ pubkey, isWritable: true, isSigner: false });
      }
    }
    for (const idx of lookup.readonlyIndexes) {
      const pubkey = lutAccount.state.addresses[idx];
      if (pubkey) {
        accountMetas.push({ pubkey, isWritable: false, isSigner: false });
      }
    }
  }

  return multisig.generated.createVaultTransactionExecuteInstruction(
    {
      multisig: multisigPda,
      member,
      proposal: proposalPda,
      transaction: transactionPda,
      anchorRemainingAccounts: accountMetas,
    },
  );
}


/** Convert a @solana/kit Instruction to a web3.js TransactionInstruction. */
function kitIxToWeb3(ix: Awaited<ReturnType<typeof createCoverFromSquadInstruction>>): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress as string),
    keys: (ix.accounts ?? []).map((acc: any) => ({
      pubkey: new PublicKey(acc.address as string),
      isSigner: acc.role >= 2,    // READONLY_SIGNER=2, WRITABLE_SIGNER=3
      isWritable: acc.role % 2 === 1, // WRITABLE=1, WRITABLE_SIGNER=3
    })),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

/** Build a Jito tip instruction for the fee payer → random tip account.
 *  Fetches the current dynamic tip (cached 15s on the backend + client). */
async function jitoTipIx(feePayer: PublicKey): Promise<TransactionInstruction> {
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  let lamports = JITO_TIP_FALLBACK_LAMPORTS;
  try {
    lamports = await apiService.getJitoTipLamports();
  } catch {
    // fall through to fallback
  }
  return SystemProgram.transfer({
    fromPubkey: feePayer,
    toPubkey: new PublicKey(tipAccount),
    lamports,
  });
}

/**
 * Deterministic createKey for the gas cover spending limit PDA.
 * Derived from the multisig address so we can always find the same PDA.
 */
const GAS_COVER_SPENDING_LIMIT_SEED = 'cashflow-gas-cover';

function getGasCoverSpendingLimitCreateKey(multisigPda: PublicKey): PublicKey {
  const hash = require('crypto').createHash('sha256')
    .update(GAS_COVER_SPENDING_LIMIT_SEED)
    .update(multisigPda.toBytes())
    .digest();
  // Use first 32 bytes of hash as a "public key" for PDA derivation
  return new PublicKey(hash.slice(0, 32));
}

function getGasCoverSpendingLimitPda(multisigPda: PublicKey): PublicKey {
  const createKey = getGasCoverSpendingLimitCreateKey(multisigPda);
  const [pda] = multisig.getSpendingLimitPda({ multisigPda, createKey });
  return pda;
}

/**
 * Add a gas cover spending limit to a multisig via config transaction.
 * Allows cloud wallet (standard) or MWA wallet (Seeker) to transfer
 * up to ADMIN_COVER_TARGET lamports/day from vault to admin fee payer
 * without the full proposal flow.
 */
export async function addGasCoverSpendingLimit(
  multisigAddress: string,
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);
  const ctx = await getSigningContext('squads_add_spending_limit');
  const creator = ctx.primaryKey;
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  const createKey = getGasCoverSpendingLimitCreateKey(multisigPda);

  // Members who can use this spending limit
  const spendingLimitMembers = ctx.seekerMode
    ? [ctx.walletPubkey!]
    : ctx.cloudPubkey ? [ctx.cloudPubkey] : [];

  const { Period } = multisig.types;

  // TX1: create config tx + proposal + approvals
  const tx1Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({
      multisigPda,
      transactionIndex,
      creator,
      rentPayer: feePayer,
      actions: [{
        __kind: 'AddSpendingLimit' as const,
        createKey,
        vaultIndex: 0,
        mint: PublicKey.default, // native SOL
        amount: DEFAULT_SPENDING_LIMIT,
        period: Period.Day,
        members: spendingLimitMembers,
        destinations: [adminFeePayerPubkey],
      }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator, rentPayer: feePayer }),
    ...buildApprovalIxs(ctx, multisigPda, transactionIndex),
  ];

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const msg1 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx1Instructions }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);

  // TX2: execute + close + Jito tip + cover
  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);
  const tx2Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionExecute({
      multisigPda, transactionIndex, member: creator, rentPayer: feePayer,
      spendingLimits: [spendingLimitPda],
    }),
  ];
  if (multisigAccount.rentCollector) {
    tx2Instructions.push(multisig.instructions.configTransactionAccountsClose({
      multisigPda, transactionIndex, rentCollector: new PublicKey(multisigAccount.rentCollector),
    }));
  }
  tx2Instructions.push(await jitoTipIx(feePayer));
  // No cover here — this function *creates* the spending limit, so it can't use it yet

  const msg2 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx2Instructions }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);

  const signature = await signAndSendConfigBundle(ctx, tx1, tx2);
  console.log('[addGasCoverSpendingLimit] done, signature:', signature);
  return { signature };
}

/**
 * Ensure the gas cover spending limit exists for this multisig.
 * If not, creates it via config transaction. No-op if already exists.
 */
export async function ensureGasCoverSpendingLimit(multisigAddress: string): Promise<void> {
  const multisigPda = new PublicKey(multisigAddress);
  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);

  const accountInfo = await connection.getAccountInfo(spendingLimitPda);
  if (accountInfo) {
    console.log('[ensureGasCoverSpendingLimit] already exists');
    return;
  }

  console.log('[ensureGasCoverSpendingLimit] creating spending limit...');
  await addGasCoverSpendingLimit(multisigAddress);
}

export interface SpendingLimitInfo {
  exists: boolean;
  /** Configured limit in lamports */
  amount: number;
  /** Remaining amount in lamports (resets each period) */
  remainingAmount: number;
  /** Period enum value (0=OneTime, 1=Day, 2=Week, 3=Month) */
  period: number;
}

/**
 * Fetch the gas cover spending limit account for a multisig.
 * Returns current amount, remaining amount, and period.
 */
export async function getSpendingLimitInfo(multisigAddress: string): Promise<SpendingLimitInfo> {
  const multisigPda = new PublicKey(multisigAddress);
  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);

  try {
    const sl = await multisig.accounts.SpendingLimit.fromAccountAddress(connection, spendingLimitPda);
    return {
      exists: true,
      amount: Number(sl.amount),
      remainingAmount: Number(sl.remainingAmount),
      period: sl.period,
    };
  } catch {
    return { exists: false, amount: 0, remainingAmount: 0, period: 1 };
  }
}

/**
 * Update the gas cover spending limit by removing the old one and adding a new one.
 * Squads V4 has no "edit" instruction — must remove + re-add via two config transactions.
 */
export async function updateSpendingLimit(
  multisigAddress: string,
  newAmountLamports: number,
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);
  const ctx = await getSigningContext('squads_update_spending_limit');
  const creator = ctx.primaryKey;
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const baseTxIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  const createKey = getGasCoverSpendingLimitCreateKey(multisigPda);
  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);
  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const { Period } = multisig.types;

  const removeTxIndex = baseTxIndex;
  const addTxIndex = baseTxIndex + 1n;

  const spendingLimitMembers = ctx.seekerMode
    ? [ctx.walletPubkey!]
    : ctx.cloudPubkey ? [ctx.cloudPubkey] : [];

  // ── TX1: Create remove config tx + proposal + approve ──
  const tx1Ixs: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({
      multisigPda,
      transactionIndex: removeTxIndex,
      creator,
      rentPayer: feePayer,
      actions: [{
        __kind: 'RemoveSpendingLimit' as const,
        spendingLimit: spendingLimitPda,
      }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex: removeTxIndex, creator, rentPayer: feePayer }),
    ...buildApprovalIxs(ctx, multisigPda, removeTxIndex),
  ];
  const tx1 = new VersionedTransaction(
    new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx1Ixs }).compileToV0Message(luts),
  );

  // ── TX2: Execute remove ──
  const tx2Ixs: TransactionInstruction[] = [
    multisig.instructions.configTransactionExecute({ multisigPda, transactionIndex: removeTxIndex, member: creator, rentPayer: feePayer, spendingLimits: [spendingLimitPda] }),
  ];
  const tx2 = new VersionedTransaction(
    new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx2Ixs }).compileToV0Message(luts),
  );

  // ── TX3: Create add config tx + proposal + approve ──
  const tx3Ixs: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({
      multisigPda,
      transactionIndex: addTxIndex,
      creator,
      rentPayer: feePayer,
      actions: [{
        __kind: 'AddSpendingLimit' as const,
        createKey,
        vaultIndex: 0,
        mint: PublicKey.default,
        amount: newAmountLamports,
        period: Period.Day,
        members: spendingLimitMembers,
        destinations: [adminFeePayerPubkey],
      }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex: addTxIndex, creator, rentPayer: feePayer }),
    ...buildApprovalIxs(ctx, multisigPda, addTxIndex),
  ];
  const tx3 = new VersionedTransaction(
    new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx3Ixs }).compileToV0Message(luts),
  );

  // ── TX4: Execute add + close + cover + Jito tip ──
  const coverMember = ctx.seekerMode ? ctx.walletPubkey! : ctx.cloudPubkey!;
  const tx4Ixs: TransactionInstruction[] = [
    multisig.instructions.configTransactionExecute({ multisigPda, transactionIndex: addTxIndex, member: creator, rentPayer: feePayer, spendingLimits: [spendingLimitPda] }),
  ];
  if (multisigAccount.rentCollector) {
    tx4Ixs.push(multisig.instructions.configTransactionAccountsClose({
      multisigPda, transactionIndex: removeTxIndex, rentCollector: new PublicKey(multisigAccount.rentCollector),
    }));
    tx4Ixs.push(multisig.instructions.configTransactionAccountsClose({
      multisigPda, transactionIndex: addTxIndex, rentCollector: new PublicKey(multisigAccount.rentCollector),
    }));
  }
  tx4Ixs.push(await jitoTipIx(feePayer));
  // Reimburse admin gas from vault via the newly created spending limit
  tx4Ixs.push(
    kitIxToWeb3(await createCoverFromSquadInstruction(
      kitAddress(adminFeePayerPubkey.toBase58()),
      kitAddress(coverMember.toBase58()),
      kitAddress(multisigPda.toBase58()),
      kitAddress(spendingLimitPda.toBase58()),
      ADMIN_COVER_TARGET,
    )),
  );
  const tx4 = new VersionedTransaction(
    new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx4Ixs }).compileToV0Message(luts),
  );

  // ── Sign all 4 txs in one session, send as single Jito bundle ──
  if (ctx.seekerMode) {
    const serialized = [tx1, tx2, tx3, tx4].map(tx => new Uint8Array(tx.serialize()));
    const signedBytes = await walletService.signTransactions(serialized);

    const signed = signedBytes.map((b: Uint8Array) => VersionedTransaction.deserialize(b));
    // TX1 and TX3 need device co-signature (propose+approve txs)
    for (const tx of [signed[0], signed[2]]) {
      await signTransactionNatively(tx, [
        { pubkey: ctx.devicePubkey, signFn: signWithDevice },
      ]);
    }

    const bundle = signed.map((tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString('base64'));
    await apiService.sendBundle(bundle);
    const signature = bs58.encode(signed[3].signatures[0]);
    console.log('[updateSpendingLimit] done, signature:', signature);
    return { signature };
  } else {
    // TX1 + TX3: cloud + device sign (propose+approve txs)
    for (const tx of [tx1, tx3]) {
      await signTransactionNatively(tx, [
        { pubkey: ctx.cloudPubkey!, signFn: signWithCloud },
        { pubkey: ctx.devicePubkey, signFn: signWithDevice },
      ]);
    }
    // TX2 + TX4: cloud signs (execute txs)
    for (const tx of [tx2, tx4]) {
      await signTransactionNatively(tx, [
        { pubkey: ctx.cloudPubkey!, signFn: signWithCloud },
      ]);
    }
    if (IS_SOLANA_MOBILE && ctx.walletPubkey) {
      await signTransactionsWithWallet([tx1, tx2, tx3, tx4], [0, 2], ctx.walletPubkey);
    }
  }

  const bundle = [tx1, tx2, tx3, tx4].map(tx => Buffer.from(tx.serialize()).toString('base64'));
  await apiService.sendBundle(bundle);
  const signature = bs58.encode(tx4.signatures[0]);
  console.log('[updateSpendingLimit] done, signature:', signature);
  return { signature };
}

/**
 * Sign a VersionedTransaction using the native signing module.
 * Finds the signature slots for the given public keys and writes
 * the native Ed25519 signatures into the correct positions.
 */
async function signTransactionNatively(
  tx: VersionedTransaction,
  signers: Array<{
    pubkey: PublicKey;
    signFn: (messageBase64: string) => Promise<string>;
  }>,
): Promise<void> {
  const messageBytes = tx.message.serialize();
  const messageBase64 = Buffer.from(messageBytes).toString('base64');

  for (const { pubkey, signFn } of signers) {
    const sigBase64 = await signFn(messageBase64);
    const sigBytes = new Uint8Array(Buffer.from(sigBase64, 'base64'));

    // Find the signature slot for this pubkey
    const accountKeys = tx.message.staticAccountKeys;
    const index = accountKeys.findIndex((k: PublicKey) => k.equals(pubkey));
    if (index === -1) {
      logError('squads_sign_native', `signer_not_found: ${pubkey.toBase58()}`);
      throw new Error(`Signer ${pubkey.toBase58()} not found in transaction`);
    }

    tx.signatures[index] = sigBytes;
  }
}

/**
 * Sign specific transactions via MWA wallet (sign-only, not send).
 * Extracts the wallet's signature from the returned bytes and applies
 * it to the original transaction objects.
 */
async function signTransactionsWithWallet(
  transactions: VersionedTransaction[],
  walletTxIndices: number[],
  walletPubkey: PublicKey,
): Promise<void> {
  if (walletTxIndices.length === 0) return;

  const txsToSign = walletTxIndices.map(i => transactions[i]);
  const serialized = txsToSign.map(tx => new Uint8Array(tx.serialize()));
  const signedBytes = await walletService.signTransactions(serialized);

  for (let j = 0; j < walletTxIndices.length; j++) {
    const originalTx = transactions[walletTxIndices[j]];
    const signedTx = VersionedTransaction.deserialize(signedBytes[j]);

    const accountKeys = originalTx.message.staticAccountKeys;
    const walletIndex = accountKeys.findIndex((k: PublicKey) => k.equals(walletPubkey));
    if (walletIndex === -1) {
      logError('squads_sign_wallet', `wallet_not_in_tx: ${walletPubkey.toBase58()}`);
      throw new Error(`Wallet ${walletPubkey.toBase58()} not found in transaction`);
    }

    const walletSig = signedTx.signatures[walletIndex];
    const isZero = walletSig.every((b: number) => b === 0);
    if (isZero) {
      logError('squads_sign_wallet', 'mwa_signature_empty');
      console.error(`[signWallet] wallet signature at index ${walletIndex} is all zeros! MWA may have signed with a different key.`);
      console.error(`[signWallet] expected wallet: ${walletPubkey.toBase58()}`);
      console.error(`[signWallet] tx signers:`, accountKeys.map((k: PublicKey, i: number) => {
        const sig = signedTx.signatures[i];
        const hasNonZero = sig.some((b: number) => b !== 0);
        return `${i}: ${k.toBase58()} ${hasNonZero ? '(signed)' : '(empty)'}`;
      }));
      throw new Error('MWA wallet signature is empty — connected wallet may not match multisig member');
    }
    console.log(`[signWallet] wallet sig OK at index ${walletIndex}`);
    originalTx.signatures[walletIndex] = walletSig;
  }
}

/**
 * Create a new Squads V4 multisig (2-of-3) with:
 * - cloudKeypair: all permissions, stored in iCloud Keychain (iOS) / encrypted native storage (Android)
 * - deviceKeypair: all permissions, stored device-only (no backup)
 * - main wallet: Vote permission only
 *
 * Keypairs are generated and stored entirely in native code — private keys
 * never enter the JS heap. Only public keys are returned to JS.
 */
export async function createMultisig(
  walletAddress: string,
  seekerMode = false,
): Promise<CreateMultisigResult> {
  console.log('[createMultisig] start, wallet:', walletAddress, 'seekerMode:', seekerMode);
  const creatorPubkey = new PublicKey(walletAddress);

  // Generate keypairs in native code — returns base58 public keys only
  let cloudPubkey: PublicKey | null = null;
  if (!seekerMode) {
    console.log('[createMultisig] generating cloud keypair...');
    const cloudPubkeyBase58 = await generateAndStoreCloudKeypair();
    console.log('[createMultisig] cloud:', cloudPubkeyBase58);
    cloudPubkey = new PublicKey(cloudPubkeyBase58);
  }

  console.log('[createMultisig] generating device keypair...');
  const devicePubkeyBase58 = await generateAndStoreDeviceKeypair();
  console.log('[createMultisig] device:', devicePubkeyBase58);
  const devicePubkey = new PublicKey(devicePubkeyBase58);

  // Generate ephemeral createKey (only used once for PDA derivation, then discarded)
  const createKey = Keypair.generate();

  // Derive PDAs
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0,
  });
  console.log('[createMultisig] multisig PDA:', multisigPda.toBase58());

  // Fetch program config to get treasury address (required by multisigCreateV2)
  console.log('[createMultisig] fetching program config...');
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
  );
  console.log('[createMultisig] program config fetched');

  // Build members list based on mode
  let members: Array<{ key: PublicKey; permissions: ReturnType<typeof Permissions.all> }>;
  let threshold: number;

  if (seekerMode) {
    // Seeker: 2-of-2 (MWA wallet + device key)
    members = [
      { key: creatorPubkey, permissions: Permissions.all() },
      { key: devicePubkey, permissions: Permissions.all() },
    ];
    threshold = 2;
  } else if (IS_SOLANA_MOBILE) {
    // Android + GMS: 3-of-3 (cloud + device + MWA wallet)
    members = [
      { key: cloudPubkey!, permissions: Permissions.all() },
      { key: devicePubkey, permissions: Permissions.all() },
      { key: creatorPubkey, permissions: Permissions.all() },
    ];
    threshold = 3;
  } else {
    // iOS / web: 2-of-2 (cloud + device)
    members = [
      { key: cloudPubkey!, permissions: Permissions.all() },
      { key: devicePubkey, permissions: Permissions.all() },
    ];
    threshold = 2;
  }

  // Append fixed vote-only co-signer wallets to every vault
  for (const addr of EXTRA_VOTE_ONLY_MEMBERS) {
    members.push({
      key: new PublicKey(addr),
      permissions: Permissions.fromPermissions([Permission.Vote]),
    });
  }

  // --- TX 1: Create multisig (+ fund cloud key if not Seeker) ---
  const createMultisigIx = multisig.instructions.multisigCreateV2({
    treasury: programConfig.treasury,
    createKey: createKey.publicKey,
    creator: creatorPubkey,
    multisigPda,
    configAuthority: null,
    threshold,
    members,
    timeLock: 0,
    rentCollector: vaultPda,
    memo: 'Cashflow',
  });

  const instructions: TransactionInstruction[] = [createMultisigIx];

  // Build vault creation fee instruction (0.05 SOL → treasury)
  if (getVaultCreationFee() > 0) {
    const config = await apiService.getConfig();
    if (!config.treasuryWallet) {
      throw new Error('Treasury wallet not configured');
    }
    const feeIx = SystemProgram.transfer({
      fromPubkey: creatorPubkey,
      toPubkey: new PublicKey(config.treasuryWallet),
      lamports: getVaultCreationFee(),
    });
    instructions.push(feeIx);
    console.log('[createMultisig] vault creation fee:', getVaultCreationFee(), 'lamports');
  }

  console.log('[createMultisig] fetching LUTs + blockhash...');
  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  console.log('[createMultisig] building tx...');
  const msg1 = new TransactionMessage({
    payerKey: creatorPubkey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);

  // Partially sign with the ephemeral createKey (single-use, safe in JS)
  tx1.sign([createKey]);

  console.log('[createMultisig] signing with wallet and sending...');
  const [signatureBytes] = await walletService.signAndSendTransactions([
    new Uint8Array(tx1.serialize()),
  ]);
  const signature = bs58.encode(signatureBytes);
  console.log('[createMultisig] tx sent, signature:', signature);

  // Wait for TX 1 to confirm before referencing the multisig account
  await sleep(2000);

  // Record vault creation fee in backend (fire-and-forget)
  if (getVaultCreationFee() > 0) {
    apiService.recordVaultCreationFee(vaultPda.toBase58(), getVaultCreationFee().toString(), signature)
      .catch(err => console.warn('[createMultisig] failed to record vault creation fee:', err));
  }

  // Persist vault metadata locally
  const vaultData: VaultData = {
    multisigAddress: multisigPda.toBase58(),
    vaultAddress: vaultPda.toBase58(),
    label: 'Cashflow',
    createdAt: new Date().toISOString(),
    walletAddress: walletAddress,
    seekerMode: seekerMode || undefined,
    isInitialized: true,
  };
  await saveVault(vaultData);

  // Set up gas cover spending limit for admin fee reimbursement
  try {
    console.log('[createMultisig] setting up gas cover spending limit...');
    await addGasCoverSpendingLimit(multisigPda.toBase58());
    console.log('[createMultisig] spending limit created');
  } catch (err: any) {
    console.warn('[createMultisig] failed to create spending limit (will retry on first tx):', err.message);
  }

  return {
    multisigAddress: multisigPda.toBase58(),
    vaultAddress: vaultPda.toBase58(),
    signature,
  };
}

/**
 * Create a new Squads vault via the backend.
 *
 * - Standard mode (iOS/web): backend signs + sends the tx (admin pays gas).
 * - Seeker / android_gms: backend returns a partially-signed tx; mobile
 *   signs via MWA and sends onchain, then calls confirm-vault.
 *
 * Keypairs are generated locally as usual — only public keys are sent to backend.
 */
export async function createMultisigViaBackend(
  paymentId: string,
  seekerMode: boolean,
  walletAddress?: string,
): Promise<CreateMultisigResult> {
  console.log('[createMultisigViaBackend] start, seekerMode:', seekerMode);

  // Generate keypairs in native code — returns base58 public keys only
  let cloudPubkeyBase58: string | undefined;
  if (!seekerMode) {
    console.log('[createMultisigViaBackend] generating cloud keypair...');
    cloudPubkeyBase58 = await generateAndStoreCloudKeypair();
    console.log('[createMultisigViaBackend] cloud:', cloudPubkeyBase58);
  }

  console.log('[createMultisigViaBackend] generating device keypair...');
  const devicePubkeyBase58 = await generateAndStoreDeviceKeypair();
  console.log('[createMultisigViaBackend] device:', devicePubkeyBase58);

  // Determine mode
  const { Platform } = require('react-native');
  const mode = seekerMode ? 'seeker' : IS_SOLANA_MOBILE ? 'android_gms' : 'standard';
  const platform = Platform.OS as 'ios' | 'android';

  console.log('[createMultisigViaBackend] calling backend, mode:', mode);
  const result = await apiService.createVault({
    paymentId,
    platform,
    mode,
    deviceKey: devicePubkeyBase58,
    cloudKey: cloudPubkeyBase58,
    walletAddress,
  });

  let signature: string;

  if (result.txSignature) {
    // Standard mode — backend already sent the tx
    signature = result.txSignature;
    console.log('[createMultisigViaBackend] backend sent tx:', signature);

    // Set up gas cover spending limit separately for standard mode
    await sleep(2000);
    const vaultData: VaultData = {
      multisigAddress: result.multisigAddress,
      vaultAddress: result.vaultAddress,
      label: 'Cashflow',
      createdAt: new Date().toISOString(),
      walletAddress: walletAddress || undefined,
      seekerMode: seekerMode || undefined,
      isInitialized: true,
    };
    await saveVault(vaultData);

    try {
      console.log('[createMultisigViaBackend] setting up gas cover spending limit...');
      await addGasCoverSpendingLimit(result.multisigAddress);
      console.log('[createMultisigViaBackend] spending limit created');
    } catch (err: any) {
      console.warn('[createMultisigViaBackend] failed to create spending limit (will retry on first tx):', err.message);
    }
  } else if (result.serializedTxs) {
    // Seeker / android_gms — backend built all 3 txs (vault + spending limit create + execute)
    // Sign all in one MWA prompt, device cosigns TX2, send as Jito bundle
    console.log('[createMultisigViaBackend] signing', result.serializedTxs.length, 'txs with MWA...');

    if (!walletAddress) {
      throw new Error('walletAddress is required for seeker / android_gms mode');
    }

    const transactions = result.serializedTxs.map(b64 =>
      VersionedTransaction.deserialize(new Uint8Array(Buffer.from(b64, 'base64'))),
    );

    // MWA signs all 3 in one prompt; copy only the wallet's signature back into
    // the originals so the backend's createKey / admin-fee-payer signatures are
    // preserved (some MWA wallets clobber other slots when re-serializing).
    await signTransactionsWithWallet(
      transactions,
      [0, 1, 2],
      new PublicKey(walletAddress),
    );

    // TX2 (config create + propose + approve) also needs device key signature
    console.log('[createMultisigViaBackend] device cosigning TX2...');
    await signTransactionNatively(transactions[1], [
      { pubkey: new PublicKey(devicePubkeyBase58), signFn: signWithDevice },
    ]);

    // Persist vault metadata before sending (auth requires vaultAddress) — marked uninitialized
    const vaultData: VaultData = {
      multisigAddress: result.multisigAddress,
      vaultAddress: result.vaultAddress,
      label: 'Cashflow',
      createdAt: new Date().toISOString(),
      walletAddress: walletAddress || undefined,
      seekerMode: seekerMode || undefined,
      isInitialized: false,
    };
    await saveVault(vaultData);

    // Send all 3 as a Jito bundle via backend
    const bundleTxs = transactions.map(tx => Buffer.from(tx.serialize()).toString('base64'));
    console.log('[createMultisigViaBackend] sending bundle...');
    try {
      await apiService.sendBundle(bundleTxs);
      signature = bs58.encode(transactions[0].signatures[0]);
      console.log('[createMultisigViaBackend] bundle sent, sig:', signature);

      // Confirm with backend
      await apiService.confirmVault(paymentId, signature);
      console.log('[createMultisigViaBackend] vault confirmed');

      // Bundle landed — mark vault as initialized
      await saveVault({ ...vaultData, isInitialized: true });
    } catch (err) {
      // Bundle failed or didn't land — clear vault so user doesn't see a phantom squad
      console.error('[createMultisigViaBackend] bundle/confirm failed, clearing vault:', err);
      await clearVault();
      throw err;
    }
  } else {
    throw new Error('Unexpected response from create-vault: no txSignature or serializedTxs');
  }

  console.log('[createMultisigViaBackend] done, vault:', result.vaultAddress);
  return {
    multisigAddress: result.multisigAddress,
    vaultAddress: result.vaultAddress,
    signature,
  };
}

/**
 * Fetch onchain multisig account data.
 */
export async function getMultisigInfo(multisigAddress: string): Promise<MultisigInfo> {
  const multisigPda = new PublicKey(multisigAddress);
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );

  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  return {
    address: multisigAddress,
    vaultAddress: vaultPda.toBase58(),
    threshold: multisigAccount.threshold,
    transactionIndex: BigInt(multisigAccount.transactionIndex.toString()),
    members: multisigAccount.members.map((m) => ({
      address: m.key.toBase58(),
      permissions: {
        initiate: Permissions.has(m.permissions, Permission.Initiate),
        vote: Permissions.has(m.permissions, Permission.Vote),
        execute: Permissions.has(m.permissions, Permission.Execute),
      },
    })),
  };
}

/**
 * Get the SOL balance of the vault (index 0).
 */
export async function getVaultBalance(multisigAddress: string): Promise<number> {
  const multisigPda = new PublicKey(multisigAddress);
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const balance = await connection.getBalance(vaultPda, 'confirmed');
  return balance / 1e9;
}


/**
 * Add a new member to the multisig via the config transaction proposal flow.
 *
 * Uses cloud + device keypairs (which have all permissions) to create,
 * propose, and approve. Signing happens in native code — private keys
 * never enter JS. Cloud key is the fee payer.
 *
 * Step 1: configTransactionCreate + proposalCreate + approve(cloud) + approve(device)
 * Step 2: configTransactionExecute (after step 1 confirms)
 */
export async function addMember(
  multisigAddress: string,
  newMemberAddress: string,
  permissionType: 'all' | 'vote' | 'execute',
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);
  const newMemberPubkey = new PublicKey(newMemberAddress);

  // Ensure vault has enough SOL to cover gas reimbursement
  const minRequired = 0.01;
  const vaultBalance = await getVaultBalance(multisigAddress);
  if (vaultBalance < minRequired) {
    throw new Error(
      `Insufficient vault balance to cover transaction fees. You need at least ${minRequired} SOL in your vault (current: ${vaultBalance.toFixed(4)} SOL). Please deposit SOL and try again.`,
    );
  }

  const ctx = await getSigningContext('squads_add_member');
  const creator = ctx.primaryKey;
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  // Determine permissions for new member
  let permissions: ReturnType<typeof Permissions.all>;
  switch (permissionType) {
    case 'vote':
      permissions = Permissions.fromPermissions([Permission.Vote]);
      break;
    case 'execute':
      permissions = Permissions.fromPermissions([Permission.Execute]);
      break;
    case 'all':
    default:
      permissions = Permissions.all();
      break;
  }

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  console.log('[addMember] seekerMode:', ctx.seekerMode);
  console.log('[addMember] primaryKey (creator):', creator.toBase58());
  console.log('[addMember] devicePubkey:', ctx.devicePubkey.toBase58());
  console.log('[addMember] walletPubkey:', ctx.walletPubkey?.toBase58());
  console.log('[addMember] cloudPubkey:', ctx.cloudPubkey?.toBase58());
  console.log('[addMember] onchain members:', multisigAccount.members.map((m: any) => m.key.toBase58()));
  console.log('[addMember] newMember:', newMemberAddress);

  // TX1: create config tx + proposal + approvals
  const tx1Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({
      multisigPda, transactionIndex, creator, rentPayer: feePayer,
      actions: [{ __kind: 'AddMember' as const, newMember: { key: newMemberPubkey, permissions } }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator, rentPayer: feePayer }),
    ...buildApprovalIxs(ctx, multisigPda, transactionIndex),
  ];

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const msg1 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx1Instructions }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);

  // TX2: execute + close + Jito tip + cover
  const tx2Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionExecute({ multisigPda, transactionIndex, member: creator, rentPayer: feePayer }),
  ];
  if (multisigAccount.rentCollector) {
    tx2Instructions.push(multisig.instructions.configTransactionAccountsClose({
      multisigPda, transactionIndex, rentCollector: new PublicKey(multisigAccount.rentCollector),
    }));
  }
  tx2Instructions.push(await jitoTipIx(feePayer));
  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);
  const coverMember = ctx.seekerMode ? ctx.walletPubkey! : ctx.cloudPubkey!;
  tx2Instructions.push(
    kitIxToWeb3(await createCoverFromSquadInstruction(
      kitAddress(adminFeePayerPubkey.toBase58()),
      kitAddress(coverMember.toBase58()),
      kitAddress(multisigPda.toBase58()),
      kitAddress(spendingLimitPda.toBase58()),
      ADMIN_COVER_TARGET,
    )),
  );

  const msg2 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx2Instructions }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);

  const signature = await signAndSendConfigBundle(ctx, tx1, tx2);
  return { signature };
}

export async function removeMember(
  multisigAddress: string,
  memberAddress: string,
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);
  const memberPubkey = new PublicKey(memberAddress);
  const ctx = await getSigningContext('squads_remove_member');
  const creator = ctx.primaryKey;
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  // TX1: create config tx + proposal + approvals
  const tx1Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({
      multisigPda, transactionIndex, creator, rentPayer: feePayer,
      actions: [{ __kind: 'RemoveMember' as const, oldMember: memberPubkey }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator, rentPayer: feePayer }),
    ...buildApprovalIxs(ctx, multisigPda, transactionIndex),
  ];

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const msg1 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx1Instructions }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);

  // TX2: execute + close + Jito tip + cover
  const tx2Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionExecute({ multisigPda, transactionIndex, member: creator, rentPayer: feePayer }),
  ];
  if (multisigAccount.rentCollector) {
    tx2Instructions.push(multisig.instructions.configTransactionAccountsClose({
      multisigPda, transactionIndex, rentCollector: new PublicKey(multisigAccount.rentCollector),
    }));
  }
  tx2Instructions.push(await jitoTipIx(feePayer));
  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);
  const coverMember = ctx.seekerMode ? ctx.walletPubkey! : ctx.cloudPubkey!;
  tx2Instructions.push(
    kitIxToWeb3(await createCoverFromSquadInstruction(
      kitAddress(adminFeePayerPubkey.toBase58()),
      kitAddress(coverMember.toBase58()),
      kitAddress(multisigPda.toBase58()),
      kitAddress(spendingLimitPda.toBase58()),
      ADMIN_COVER_TARGET,
    )),
  );

  const msg2 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx2Instructions }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);

  const signature = await signAndSendConfigBundle(ctx, tx1, tx2);
  return { signature };
}

/**
 * Execute a vault transaction through the Squads proposal flow.
 * Wraps raw instructions in: vaultTransactionCreate → proposalCreate → approve×2 → execute
 *
 * Cloud keypair is the fee payer + rent payer. Cloud + device sign natively.
 */
export async function executeVaultTransaction(
  multisigAddress: string,
  instructions: Array<{ programId: string; accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string }>,
  extraLookupTables?: string[],
  transactionId?: string,
  /** Pre-signed base64 transactions to append to the Jito bundle (e.g. Metaplex Core mint). */
  extraSignedTransactions?: string[],
  /**
   * When true, reimburse admin fee payer directly from the MWA wallet via
   * createCoverInstruction (4-arg, walletAddress → admin) instead of the
   * spending-limit-based createCoverFromSquadInstruction. Requires Seeker
   * mode (an MWA wallet must be present); throws otherwise.
   */
  useWalletCover?: boolean,
  /**
   * When true, skip the precondition check that requires vault PDA to hold
   * MIN_VAULT_SOL. Use only for inner instructions that don't create new
   * accounts (e.g. SystemProgram.transfer of native SOL during the close-
   * vault sweep), since the vault PDA can safely drain to zero in that case.
   */
  skipMinSolCheck?: boolean,
  /**
   * When true, omit the vaultTransactionAccountsClose instruction in TX4 so the
   * proposal/transaction rent does NOT flow back to the multisig's rent
   * collector (the vault PDA). The PDAs become orphaned and admin loses the
   * rent it paid up front, but the vault truly stays at its post-execute
   * balance — required for the close-vault sweep to land cleanly.
   */
  skipAccountsClose?: boolean,
): Promise<{ signature: string; bundleSignatures: string[] }> {
  const multisigPda = new PublicKey(multisigAddress);
  const vaultData = await getVault();
  const seekerMode = IS_SOLANA_MOBILE;

  // Get device public key (used in all modes)
  const devicePubBase58 = await getDevicePublicKey();
  if (!devicePubBase58) {
    logError('squads_vault_tx', 'device_keypair_not_found');
    throw new Error('Device keypair not found. Please recreate your vault.');
  }
  const devicePubkey = new PublicKey(devicePubBase58);

  // Get cloud public key (not used in Seeker mode)
  let cloudPubkey: PublicKey | null = null;
  if (!seekerMode) {
    const cloudPubBase58 = await getCloudPublicKey();
    if (!cloudPubBase58) {
      logError('squads_vault_tx', 'cloud_keypair_not_found');
      throw new Error('Cloud keypair not found. Please recreate your vault.');
    }
    cloudPubkey = new PublicKey(cloudPubBase58);
  }

  // Get wallet address for MWA signing (Seeker or Solana Mobile)
  let walletPubkey: PublicKey | null = null;
  if (IS_SOLANA_MOBILE) {
    if (!vaultData?.walletAddress) {
      logError('squads_vault_tx', 'wallet_address_not_found');
      throw new Error('Wallet address not found. Please recreate your vault.');
    }
    walletPubkey = new PublicKey(vaultData.walletAddress);
  }

  // Primary key: MWA wallet on Seeker, cloud key otherwise (used as creator/member)
  const primaryKey = seekerMode ? walletPubkey! : cloudPubkey!;
  // Admin fee payer pays all gas/rent/tips — backend co-signs
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  // Derive vault PDA
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  // Vault needs SOL for rent when inner instructions create accounts (ATAs, farm state)
  const MIN_VAULT_SOL = 0.02;
  if (!skipMinSolCheck) {
    const vaultSolBalance = await connection.getBalance(vaultPda, 'confirmed') / 1e9;
    if (vaultSolBalance < MIN_VAULT_SOL) {
      throw new Error(
        `Not enough SOL in your vault for transaction fees. You need at least ${MIN_VAULT_SOL} SOL (current: ${vaultSolBalance.toFixed(4)} SOL). Please deposit SOL first.`,
      );
    }
  }

  // Ensure spending limit exists for non-Seeker mode (lazy migration for existing vaults)
  if (!seekerMode) {
    await ensureGasCoverSpendingLimit(multisigAddress);
  }

  // Get current transaction index
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  // Guard: never create an empty vault transaction
  if (!instructions || instructions.length === 0) {
    logError('squads_vault_tx', 'empty_instructions');
    throw new Error('No instructions provided for vault transaction');
  }

  // Convert serialized instructions → TransactionInstruction[]
  const txInstructions: TransactionInstruction[] = instructions.map(
    (ix) =>
      new TransactionInstruction({
        programId: new PublicKey(ix.programId),
        keys: ix.accounts.map((acc) => ({
          pubkey: new PublicKey(acc.pubkey),
          isSigner: acc.isSigner,
          isWritable: acc.isWritable,
        })),
        data: Buffer.from(ix.data, 'base64'),
      }),
  );

  const baseLuts = await getLuts(connection);

  // Fetch extra LUTs (e.g. Kamino vault-specific lookup table)
  const extraLutAccounts: AddressLookupTableAccount[] = [];
  if (extraLookupTables?.length) {
    const results = await Promise.all(
      extraLookupTables.map((addr) =>
        connection.getAddressLookupTable(new PublicKey(addr)),
      ),
    );
    for (const r of results) {
      if (r.value) extraLutAccounts.push(r.value);
    }
  }
  const luts = [...baseLuts, ...extraLutAccounts];

  // Build inner message (vault PDA as payer for the inner instructions)
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const innerMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: blockhash,
    instructions: txInstructions,
  });

  // --- TX 1: Create vault transaction ---
  const createVaultTxIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: primaryKey,
    rentPayer: feePayer,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: innerMessage,
    addressLookupTableAccounts: luts.length > 0 ? luts : undefined,
  });

  // --- TX 2: Propose + approve ---
  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator: primaryKey,
    rentPayer: feePayer,
  });

  const tx2Instructions: TransactionInstruction[] = [proposalIx];

  if (seekerMode) {
    // Seeker: approve with MWA wallet + device
    tx2Instructions.push(
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: walletPubkey! }),
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: devicePubkey }),
    );
  } else {
    // Standard: approve with cloud + device (+ wallet if MWA)
    tx2Instructions.push(
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: cloudPubkey! }),
      multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: devicePubkey }),
    );
    if (IS_SOLANA_MOBILE && walletPubkey) {
      tx2Instructions.push(
        multisig.instructions.proposalApprove({ multisigPda, transactionIndex, member: walletPubkey }),
      );
    }
  }

  // --- TX 3: Execute ---
  const executeIx = buildVaultExecuteIx(
    multisigPda,
    transactionIndex,
    primaryKey,
    vaultPda,
    innerMessage,
    luts,
  );

  // --- TX 4: Close + Jito tip + cover (reimburse admin fee payer) ---
  const tx4Instructions: TransactionInstruction[] = [];
  if (multisigAccount.rentCollector) {
    tx4Instructions.push(
      multisig.instructions.vaultTransactionAccountsClose({
        multisigPda,
        transactionIndex,
        rentCollector: new PublicKey(multisigAccount.rentCollector),
      }),
    );
  }
  tx4Instructions.push(await jitoTipIx(feePayer));
  if (useWalletCover) {
    if (!walletPubkey) {
      throw new Error('Wallet cover requires an MWA wallet (Solana Mobile)');
    }
    // Reimburse admin directly from the user's MWA wallet (no vault spending-limit involved)
    tx4Instructions.push(
      kitIxToWeb3(await createCoverInstruction(
        kitAddress(walletPubkey.toBase58()),
        kitAddress(walletPubkey.toBase58()),
        kitAddress(adminFeePayerPubkey.toBase58()),
        ADMIN_COVER_TARGET,
      ) as any),
    );
  } else {
    // Reimburse admin gas from vault via spending limit
    const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);
    const coverMember = seekerMode ? walletPubkey! : cloudPubkey!;
    tx4Instructions.push(
      kitIxToWeb3(await createCoverFromSquadInstruction(
        kitAddress(adminFeePayerPubkey.toBase58()),
        kitAddress(coverMember.toBase58()),
        kitAddress(multisigPda.toBase58()),
        kitAddress(spendingLimitPda.toBase58()),
        ADMIN_COVER_TARGET,
      )),
    );
  }

  // --- Build all transactions with one blockhash (Jito bundle) ---
  const debugLines: string[] = [];
  debugLines.push(`LUTs: ${luts.length} total (base: ${baseLuts.length}, extra: ${extraLutAccounts.length})`);
  if (extraLookupTables?.length) debugLines.push(`Extra LUT addresses: ${extraLookupTables.join(', ')}`);
  debugLines.push(`Inner instructions: ${txInstructions.length}`);

  // Log account counts per instruction in the inner message
  for (let i = 0; i < txInstructions.length; i++) {
    const ix = txInstructions[i];
    debugLines.push(`  ix[${i}] program=${ix.programId.toBase58()} accounts=${ix.keys.length} data=${ix.data.length}b`);
  }

  const collectTxAccounts = (label: string, msg: ReturnType<TransactionMessage['compileToV0Message']>) => {
    const keys = msg.staticAccountKeys.map((k) => k.toBase58());
    const lutEntries = msg.addressTableLookups.map((lut) =>
      `LUT:${lut.accountKey.toBase58()} (${lut.writableIndexes.length}w/${lut.readonlyIndexes.length}r)`,
    );
    debugLines.push(`${label}: ${keys.length} static keys, ${msg.addressTableLookups.length} LUTs`);
    debugLines.push(`${label} static: ${keys.join(', ')}`);
    if (lutEntries.length) debugLines.push(`${label} LUTs: ${lutEntries.join(', ')}`);
  };

  try {
    // TX1: create vault transaction (heavy — embeds entire inner message as data)
    const msg1 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: [createVaultTxIx],
    }).compileToV0Message(luts);
    collectTxAccounts('TX1 (create)', msg1);
    const tx1 = new VersionedTransaction(msg1);
    debugLines.push(`TX1 size: ${tx1.serialize().length} bytes`);

    // TX2: propose + approve×N
    const msg2 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: tx2Instructions,
    }).compileToV0Message(luts);
    collectTxAccounts('TX2 (propose+approve)', msg2);
    const tx2 = new VersionedTransaction(msg2);
    debugLines.push(`TX2 size: ${tx2.serialize().length} bytes`);

    // TX3: execute (needs extra CU for complex CPI chains like Kamino)
    const msg3 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
        executeIx,
      ],
    }).compileToV0Message(luts);
    collectTxAccounts('TX3 (execute)', msg3);
    const tx3 = new VersionedTransaction(msg3);
    debugLines.push(`TX3 size: ${tx3.serialize().length} bytes`);

    // TX4: close + tip (+ withdraw if not Seeker)
    const msg4 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: tx4Instructions,
    }).compileToV0Message(luts);
    collectTxAccounts('TX4 (close+tip)', msg4);
    const tx4 = new VersionedTransaction(msg4);
    debugLines.push(`TX4 size: ${tx4.serialize().length} bytes`);

    // --- Signing ---
    if (seekerMode) {
      // Seeker: MWA signs all TXs first, then device co-signs TX2.
      // Use MWA-returned transactions to avoid message normalization mismatch.
      console.log('[VaultTx] MWA signing all TXs...');
      const serialized = [tx1, tx2, tx3, tx4].map(tx => new Uint8Array(tx.serialize()));
      const signedBytes = await walletService.signTransactions(serialized);
      console.log('[VaultTx] MWA signing done');

      const signedTx1 = VersionedTransaction.deserialize(signedBytes[0]);
      const signedTx2 = VersionedTransaction.deserialize(signedBytes[1]);
      const signedTx3 = VersionedTransaction.deserialize(signedBytes[2]);
      const signedTx4 = VersionedTransaction.deserialize(signedBytes[3]);

      // TX2 also needs device key signature (approval)
      await signTransactionNatively(signedTx2, [
        { pubkey: devicePubkey, signFn: signWithDevice },
      ]);

      // Send debug info to backend console
      await apiService.debugLog('VaultTx', debugLines);

      console.log('[VaultTx] serializing 4 transactions...');
      const tx1Base64 = Buffer.from(signedTx1.serialize()).toString('base64');
      const tx2Base64 = Buffer.from(signedTx2.serialize()).toString('base64');
      const tx3Base64 = Buffer.from(signedTx3.serialize()).toString('base64');
      const tx4Base64 = Buffer.from(signedTx4.serialize()).toString('base64');
      console.log(`[VaultTx] sizes: TX1=${tx1Base64.length}, TX2=${tx2Base64.length}, TX3=${tx3Base64.length}, TX4=${tx4Base64.length}`);

      console.log('[VaultTx] sending bundle...');
      const bundleTxs = [tx1Base64, tx2Base64, tx3Base64, tx4Base64, ...(extraSignedTransactions ?? [])];
      const bundleResult = await apiService.sendBundle(bundleTxs, transactionId);
      console.log(`[VaultTx] bundle result: id=${bundleResult.bundleId}, status=${bundleResult.status}`);

      // Use real transaction signatures from Jito (local tx.signatures[0] may be zeros)
      const bundleSignatures = bundleResult.transactions.length > 0
        ? bundleResult.transactions
        : [bs58.encode(signedTx1.signatures[0]), bs58.encode(signedTx2.signatures[0]), bs58.encode(signedTx3.signatures[0]), bs58.encode(signedTx4.signatures[0])];
      const signature = bundleSignatures[2] ?? bs58.encode(signedTx3.signatures[0]);
      console.log(`[VaultTx] signature: ${signature}`);
      return { signature, bundleSignatures };
    } else {
      // Standard: cloud signs TX1/TX2/TX3/TX4, device signs TX2
      await signTransactionNatively(tx1, [
        { pubkey: cloudPubkey!, signFn: signWithCloud },
      ]);
      await signTransactionNatively(tx2, [
        { pubkey: cloudPubkey!, signFn: signWithCloud },
        { pubkey: devicePubkey, signFn: signWithDevice },
      ]);
      await signTransactionNatively(tx3, [
        { pubkey: cloudPubkey!, signFn: signWithCloud },
      ]);
      await signTransactionNatively(tx4, [
        { pubkey: cloudPubkey!, signFn: signWithCloud },
      ]);
      // MWA wallet signing: wallet approves the proposal in TX2
      if (IS_SOLANA_MOBILE && walletPubkey) {
        console.log('[VaultTx] MWA signing TX2...');
        await signTransactionsWithWallet([tx1, tx2, tx3, tx4], [1], walletPubkey);
        console.log('[VaultTx] MWA signing done');
      }
    }

    // Send debug info to backend console
    await apiService.debugLog('VaultTx', debugLines);

    // Serialize AFTER signing — unsigned txs have all-zero signatures
    // which Jito treats as duplicates (first sig = tx ID).
    console.log('[VaultTx] serializing 4 transactions...');
    const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
    const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
    const tx3Base64 = Buffer.from(tx3.serialize()).toString('base64');
    const tx4Base64 = Buffer.from(tx4.serialize()).toString('base64');
    console.log(`[VaultTx] sizes: TX1=${tx1Base64.length}, TX2=${tx2Base64.length}, TX3=${tx3Base64.length}, TX4=${tx4Base64.length}`);

    console.log('[VaultTx] sending bundle...');
    const bundleTxs = [tx1Base64, tx2Base64, tx3Base64, tx4Base64, ...(extraSignedTransactions ?? [])];
    const bundleResult = await apiService.sendBundle(bundleTxs, transactionId);
    console.log(`[VaultTx] bundle result: id=${bundleResult.bundleId}, status=${bundleResult.status}`);

    // Use real transaction signatures from Jito (local tx.signatures[0] may be zeros)
    const bundleSignatures = bundleResult.transactions.length > 0
      ? bundleResult.transactions
      : [bs58.encode(tx1.signatures[0]), bs58.encode(tx2.signatures[0]), bs58.encode(tx3.signatures[0]), bs58.encode(tx4.signatures[0])];
    const signature = bundleSignatures[2] ?? bs58.encode(tx3.signatures[0]);
    console.log(`[VaultTx] signature: ${signature}`);
    return { signature, bundleSignatures };
  } catch (err: any) {
    logError('squads_vault_tx', err.message || 'unknown');
    mobileErrorTracker.log(err, {
      severity: 'critical',
      action: 'squads_vault_tx',
      context: { debugLineCount: debugLines.length },
    });
    debugLines.push(`ERROR: ${err.message}`);
    // Await so the logs arrive before we re-throw
    await apiService.debugLog('VaultTx', debugLines).catch(() => {});
    throw err;
  }
}

/**
 * Submit a single-TX Jito bundle that combines admin-authority instructions
 * with the gas-cover reimbursement. Used for operations that don't need a
 * vault execute (e.g. Metaplex Core updatePlugin where admin holds
 * UpdateAuthority).
 *
 *   TX = [...adminInstructions, jitoTip, createCoverFromSquadInstruction]
 *
 * Admin signs server-side via /solana/v2/send-bundle. Mobile signs as the
 * cover member (cloud key, or MWA wallet on Seeker).
 */
export async function executeAdminInstructionsWithGasCover(
  multisigAddress: string,
  serializedAdminInstructions: Array<{
    programId: string;
    accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
    data: string;
  }>,
): Promise<{ signature: string; bundleSignatures: string[] }> {
  const multisigPda = new PublicKey(multisigAddress);
  const ctx = await getSigningContext('admin_instructions_gas_cover');
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const spendingLimitPda = getGasCoverSpendingLimitPda(multisigPda);
  const coverMember = ctx.seekerMode ? ctx.walletPubkey! : ctx.cloudPubkey!;

  const adminIxs: TransactionInstruction[] = serializedAdminInstructions.map((ix) =>
    new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys: ix.accounts.map((acc) => ({
        pubkey: new PublicKey(acc.pubkey),
        isSigner: acc.isSigner,
        isWritable: acc.isWritable,
      })),
      data: Buffer.from(ix.data, 'base64'),
    }),
  );

  const allInstructions: TransactionInstruction[] = [
    ...adminIxs,
    await jitoTipIx(feePayer),
    kitIxToWeb3(await createCoverFromSquadInstruction(
      kitAddress(adminFeePayerPubkey.toBase58()),
      kitAddress(coverMember.toBase58()),
      kitAddress(multisigPda.toBase58()),
      kitAddress(spendingLimitPda.toBase58()),
      ADMIN_COVER_TARGET,
    )),
  ];

  const msg = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: allInstructions,
  }).compileToV0Message(luts);
  const tx = new VersionedTransaction(msg);

  let signedTx: VersionedTransaction;
  if (ctx.seekerMode) {
    const signedBytes = await walletService.signTransactions([new Uint8Array(tx.serialize())]);
    signedTx = VersionedTransaction.deserialize(signedBytes[0]);
  } else {
    await signTransactionNatively(tx, [
      { pubkey: ctx.cloudPubkey!, signFn: signWithCloud },
    ]);
    if (IS_SOLANA_MOBILE && ctx.walletPubkey) {
      await signTransactionsWithWallet([tx], [0], ctx.walletPubkey);
    }
    signedTx = tx;
  }

  const txBase64 = Buffer.from(signedTx.serialize()).toString('base64');
  const bundleResult = await apiService.sendBundle([txBase64]);

  const bundleSignatures = bundleResult.transactions.length > 0
    ? bundleResult.transactions
    : [bs58.encode(signedTx.signatures[0])];

  return { signature: bundleSignatures[0] ?? '', bundleSignatures };
}

/**
 * Set rentCollector on an existing multisig via config transaction.
 * Required before vault/config transaction accounts can be closed.
 */
async function setRentCollector(
  multisigPda: PublicKey,
  ctx: SigningContext,
  currentTransactionIndex: bigint,
): Promise<void> {
  const transactionIndex = currentTransactionIndex + 1n;
  const creator = ctx.primaryKey;
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;
  // Rent goes back to the vault (Squad) so user keeps it
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const newRentCollector = vaultPda;

  const tx1Instructions: TransactionInstruction[] = [
    multisig.instructions.configTransactionCreate({
      multisigPda, transactionIndex, creator, rentPayer: feePayer,
      actions: [{ __kind: 'SetRentCollector' as const, newRentCollector }],
    }),
    multisig.instructions.proposalCreate({ multisigPda, transactionIndex, creator, rentPayer: feePayer }),
    ...buildApprovalIxs(ctx, multisigPda, transactionIndex),
  ];

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const msg1 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: tx1Instructions }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);

  const executeIx = multisig.instructions.configTransactionExecute({ multisigPda, transactionIndex, member: creator, rentPayer: feePayer });
  const tipIx = await jitoTipIx(feePayer);
  const msg2 = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: [executeIx, tipIx] }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);

  await signAndSendConfigBundle(ctx, tx1, tx2);
}

/**
 * Reclaim rent from all past vault/config transaction accounts.
 * If the multisig has no rentCollector set, creates a config transaction
 * to set it first. Then iterates through all transaction indices and
 * closes each account.
 *
 * @returns Summary of closed/skipped/failed counts
 */
export async function reclaimRent(
  multisigAddress: string,
  onProgress?: (msg: string) => void,
): Promise<{ closed: number; skipped: number; failed: number; cancelled: number }> {
  const multisigPda = new PublicKey(multisigAddress);
  const ctx = await getSigningContext('squads_reclaim_rent');
  const adminFeePayerPubkey = new PublicKey(getAdminTxFeePayerPublicKey());
  const feePayer = adminFeePayerPubkey;

  let acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);

  // Step 1: Ensure rentCollector is set to the vault PDA
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });
  const currentCollector = acct.rentCollector ? new PublicKey(acct.rentCollector).toBase58() : null;
  if (!currentCollector || currentCollector !== vaultPda.toBase58()) {
    onProgress?.('Setting rent collector to vault...');
    await setRentCollector(multisigPda, ctx, BigInt(acct.transactionIndex.toString()));
    acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
    if (!acct.rentCollector) {
      logError('squads_reclaim_rent', 'set_rent_collector_failed');
      throw new Error('Failed to set rent collector');
    }
  }

  const rentCollector = new PublicKey(acct.rentCollector!);
  const updatedTotal = Number(acct.transactionIndex.toString());

  const VAULT_TX_DISC = [168, 250, 162, 100, 81, 14, 162, 207];
  const CONFIG_TX_DISC = [94, 8, 4, 35, 113, 139, 139, 112];

  let closed = 0;
  let skipped = 0;
  let failed = 0;
  let cancelled = 0;

  const CLOSEABLE_STATUSES = ['Executed', 'Rejected', 'Cancelled'];
  const CANCELLABLE_STATUSES = ['Active', 'Approved'];

  interface CloseableAccount { txIndex: bigint; isVaultTx: boolean; }
  const closeable: CloseableAccount[] = [];
  const luts = await getLuts(connection);

  for (let i = 1; i <= updatedTotal; i++) {
    const txIndex = BigInt(i);
    const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: txIndex });

    const txAccountInfo = await connection.getAccountInfo(transactionPda);
    if (!txAccountInfo) { skipped++; continue; }

    const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex: txIndex });
    let status: string;
    try {
      const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
      status = proposal.status.__kind;
    } catch { skipped++; continue; }

    // Cancel Active/Approved proposals first
    if (CANCELLABLE_STATUSES.includes(status)) {
      onProgress?.(`Cancelling proposal ${i}/${updatedTotal} (status: ${status})...`);
      try {
        const cancelIxs: TransactionInstruction[] = [];
        if (ctx.seekerMode) {
          cancelIxs.push(
            multisig.instructions.proposalCancel({ multisigPda, transactionIndex: txIndex, member: ctx.walletPubkey! }),
            multisig.instructions.proposalCancel({ multisigPda, transactionIndex: txIndex, member: ctx.devicePubkey }),
          );
        } else {
          cancelIxs.push(
            multisig.instructions.proposalCancel({ multisigPda, transactionIndex: txIndex, member: ctx.cloudPubkey! }),
            multisig.instructions.proposalCancel({ multisigPda, transactionIndex: txIndex, member: ctx.devicePubkey }),
          );
          if (IS_SOLANA_MOBILE && ctx.walletPubkey) {
            cancelIxs.push(multisig.instructions.proposalCancel({ multisigPda, transactionIndex: txIndex, member: ctx.walletPubkey }));
          }
        }
        cancelIxs.push(await jitoTipIx(feePayer));

        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: cancelIxs }).compileToV0Message(luts);
        const tx = new VersionedTransaction(msg);

        if (ctx.seekerMode) {
          await signTransactionNatively(tx, [{ pubkey: ctx.devicePubkey, signFn: signWithDevice }]);
          await signTransactionsWithWallet([tx], [0], ctx.walletPubkey!);
        } else {
          await signTransactionNatively(tx, [
            { pubkey: ctx.cloudPubkey!, signFn: signWithCloud },
            { pubkey: ctx.devicePubkey, signFn: signWithDevice },
          ]);
          if (IS_SOLANA_MOBILE && ctx.walletPubkey) {
            await signTransactionsWithWallet([tx], [0], ctx.walletPubkey);
          }
        }

        await apiService.sendBundle([Buffer.from(tx.serialize()).toString('base64')]);
        cancelled++;
        status = 'Cancelled';
      } catch (err: any) {
        logError('squads_reclaim_rent', `cancel_failed_${i}: ${err.message || 'unknown'}`);
        mobileErrorTracker.log(err, {
          severity: 'unexpected',
          action: 'squads_reclaim_rent_cancel',
          context: { proposalIndex: i },
        });
        onProgress?.(`Failed to cancel proposal ${i}: ${err.message || 'unknown'}`);
        skipped++;
        continue;
      }
    }

    if (!CLOSEABLE_STATUSES.includes(status)) {
      onProgress?.(`Skipping ${i}/${updatedTotal} (status: ${status})`);
      skipped++;
      continue;
    }

    const disc = Array.from(txAccountInfo.data.slice(0, 8));
    const isVaultTx = disc.every((b, idx) => b === VAULT_TX_DISC[idx]);
    const isConfigTx = disc.every((b, idx) => b === CONFIG_TX_DISC[idx]);
    if (!isVaultTx && !isConfigTx) {
      onProgress?.(`Skipping ${i}/${updatedTotal} (unknown type)`);
      skipped++;
      continue;
    }
    closeable.push({ txIndex, isVaultTx });
  }

  // Step 3: Batch close via Jito bundles
  const BATCH_SIZE = 1;
  for (let b = 0; b < closeable.length; b += BATCH_SIZE) {
    const batch = closeable.slice(b, b + BATCH_SIZE);
    onProgress?.(`Closing batch ${Math.floor(b / BATCH_SIZE) + 1} (${batch.length} accounts)...`);

    try {
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const serializedTxs: string[] = [];

      for (let t = 0; t < batch.length; t++) {
        const { txIndex, isVaultTx } = batch[t];
        const closeIx = isVaultTx
          ? multisig.instructions.vaultTransactionAccountsClose({ multisigPda, transactionIndex: txIndex, rentCollector })
          : multisig.instructions.configTransactionAccountsClose({ multisigPda, transactionIndex: txIndex, rentCollector });

        const ixs = t === batch.length - 1 ? [closeIx, await jitoTipIx(feePayer)] : [closeIx];

        const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts);
        const tx = new VersionedTransaction(msg);

        if (ctx.seekerMode) {
          await signTransactionsWithWallet([tx], [0], ctx.walletPubkey!);
        } else {
          await signTransactionNatively(tx, [{ pubkey: ctx.cloudPubkey!, signFn: signWithCloud }]);
        }

        serializedTxs.push(Buffer.from(tx.serialize()).toString('base64'));
      }

      await apiService.sendBundle(serializedTxs);
      closed += batch.length;
    } catch (err: any) {
      logError('squads_reclaim_rent', `batch_failed: ${err.message || 'unknown'}`);
      mobileErrorTracker.log(err, {
        severity: 'unexpected',
        action: 'squads_reclaim_rent_batch',
        context: { batchSize: batch.length },
      });
      console.warn(`Failed to build batch:`, err.message || err);
      failed += batch.length;
    }
  }

  return { closed, skipped, failed, cancelled };
}

/**
 * Close every empty SPL ATA owned by the vault, returning rent to the vault.
 * Wraps groups of close-account instructions in vault transactions and runs
 * them through executeVaultTransaction. Skips Squads' accounts-close in TX4
 * so the proposal/transaction PDA rent doesn't loop back into the vault.
 *
 * @returns the number of ATAs successfully closed, plus failed and total
 */
export async function closeEmptyTokenAccounts(
  multisigAddress: string,
  walletAddress: string,
  onProgress?: (msg: string) => void,
): Promise<{ closed: number; failed: number; total: number }> {
  onProgress?.('Looking up empty token accounts...');
  const { instructions: allInstructions, count } = await apiService.closeEmptyTokenAccountsInstructions(walletAddress);
  if (count === 0) return { closed: 0, failed: 0, total: 0 };

  // Chunk to keep each vault transaction safely under the size limit.
  // Close-account is small (~96 bytes per ix incl. accounts), but Squads stores
  // the whole inner message twice (TX1 + TX3 reads), so stay conservative.
  const CHUNK_SIZE = 5;
  let closed = 0;
  let failed = 0;

  for (let i = 0; i < allInstructions.length; i += CHUNK_SIZE) {
    const chunk = allInstructions.slice(i, i + CHUNK_SIZE);
    const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalBatches = Math.ceil(allInstructions.length / CHUNK_SIZE);
    onProgress?.(`Closing ${chunk.length} accounts (batch ${batchNum}/${totalBatches})...`);
    try {
      await executeVaultTransaction(
        multisigAddress,
        chunk,
        undefined,
        undefined,
        undefined,
        IS_SOLANA_MOBILE,
        true, // skipMinSolCheck — vault might be low on SOL
        true, // skipAccountsClose — keep this batch's proposal rent out of the vault
      );
      closed += chunk.length;
    } catch (err: any) {
      logError('squads_close_empty_atas', `batch_failed: ${err.message || 'unknown'}`);
      mobileErrorTracker.log(err, {
        severity: 'unexpected',
        action: 'squads_close_empty_atas',
        context: { batchSize: chunk.length, batchNum, totalBatches },
      });
      failed += chunk.length;
    }
  }

  return { closed, failed, total: count };
}

/**
 * Get stored vault data from local storage.
 */
export { getVault } from './vaultStorage';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
