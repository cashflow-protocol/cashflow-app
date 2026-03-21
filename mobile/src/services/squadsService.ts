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
import { saveVault, getVault, type VaultData } from './vaultStorage';
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
import { createWithdrawInstruction } from '@heymike/send';
import { address as kitAddress } from '@solana/kit';
import { IS_SOLANA_MOBILE, TARGET_CLOUD_BALANCE, VAULT_CREATION_FEE } from '../config/constants';
import { logError } from './analyticsService';

const { Permission, Permissions } = multisig.types;

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

const JITO_TIP_LAMPORTS = 500_000; // 0.0005 SOL

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
const connection = new Connection(SOLANA_CONFIG.rpcEndpoint, SOLANA_CONFIG.commitment);

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
 * byte layout that vaultTransactionCreate stores on-chain (which allows
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
  // then deserialize to get the exact account layout stored on-chain.
  const messageBytes = multisig.utils.transactionMessageToMultisigTransactionMessageBytes({
    message: innerMessage,
    addressLookupTableAccounts: luts.length > 0 ? luts : undefined,
    vaultPda,
  });
  const [msg] = (multisig.types as any).transactionMessageBeet.deserialize(
    Buffer.from(messageBytes),
  );

  const accountMetas: { pubkey: PublicKey; isWritable: boolean; isSigner: boolean }[] = [];

  // 1. LUT account keys — needed for on-chain validation
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
function kitIxToWeb3(ix: ReturnType<typeof createWithdrawInstruction>): TransactionInstruction {
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

/** Build a Jito tip instruction for the fee payer → random tip account. */
function jitoTipIx(feePayer: PublicKey): TransactionInstruction {
  const tipAccount = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
  return SystemProgram.transfer({
    fromPubkey: feePayer,
    toPubkey: new PublicKey(tipAccount),
    lamports: JITO_TIP_LAMPORTS,
  });
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
): Promise<CreateMultisigResult> {
  console.log('[createMultisig] start, wallet:', walletAddress);
  const creatorPubkey = new PublicKey(walletAddress);

  // Generate keypairs in native code — returns base58 public keys only
  console.log('[createMultisig] generating cloud keypair...');
  const cloudPubkeyBase58 = await generateAndStoreCloudKeypair();
  console.log('[createMultisig] cloud:', cloudPubkeyBase58);

  console.log('[createMultisig] generating device keypair...');
  const devicePubkeyBase58 = await generateAndStoreDeviceKeypair();
  console.log('[createMultisig] device:', devicePubkeyBase58);

  const cloudPubkey = new PublicKey(cloudPubkeyBase58);
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

  // --- TX 1: Create multisig + fund cloud key with initial SOL ---
  const createMultisigIx = multisig.instructions.multisigCreateV2({
    treasury: programConfig.treasury,
    createKey: createKey.publicKey,
    creator: creatorPubkey,
    multisigPda,
    configAuthority: null,
    threshold: IS_SOLANA_MOBILE ? 3 : 2,
    members: [
      { key: cloudPubkey, permissions: Permissions.all() },
      { key: devicePubkey, permissions: Permissions.all() },
      ...(IS_SOLANA_MOBILE
        ? [{ key: creatorPubkey, permissions: Permissions.all() }]
        : []),
    ],
    timeLock: 0,
    rentCollector: cloudPubkey,
    memo: 'Cashflow',
  });

  const fundCloudIx = SystemProgram.transfer({
    fromPubkey: creatorPubkey,
    toPubkey: cloudPubkey,
    lamports: TARGET_CLOUD_BALANCE,
  });

  // Build vault creation fee instruction (0.05 SOL → treasury)
  const instructions: TransactionInstruction[] = [createMultisigIx, fundCloudIx];
  if (VAULT_CREATION_FEE > 0) {
    const config = await apiService.getConfig();
    if (!config.treasuryWallet) {
      throw new Error('Treasury wallet not configured');
    }
    const feeIx = SystemProgram.transfer({
      fromPubkey: creatorPubkey,
      toPubkey: new PublicKey(config.treasuryWallet),
      lamports: VAULT_CREATION_FEE,
    });
    instructions.push(feeIx);
    console.log('[createMultisig] vault creation fee:', VAULT_CREATION_FEE, 'lamports');
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

  // TODO: TX 2 for SpendingLimit setup is disabled for now.
  // Cloud wallet will be funded manually until spending limits are tested.
  // See plan file for the full SpendingLimit implementation when ready.

  // Persist vault metadata locally
  const vaultData: VaultData = {
    multisigAddress: multisigPda.toBase58(),
    vaultAddress: vaultPda.toBase58(),
    label: 'Cashflow',
    createdAt: new Date().toISOString(),
    walletAddress: walletAddress,
  };
  await saveVault(vaultData);

  return {
    multisigAddress: multisigPda.toBase58(),
    vaultAddress: vaultPda.toBase58(),
    signature,
  };
}

/**
 * Fetch on-chain multisig account data.
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

  // Get public keys from native storage (private keys stay in native code)
  const cloudPubBase58 = await getCloudPublicKey();
  const devicePubBase58 = await getDevicePublicKey();
  if (!cloudPubBase58 || !devicePubBase58) {
    logError('squads_add_member', 'keypairs_not_found');
    throw new Error('Signing keypairs not found. Please recreate your vault.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

  // Get wallet address for MWA signing (if Solana Mobile)
  let walletPubkey: PublicKey | null = null;
  if (IS_SOLANA_MOBILE) {
    const vaultData = await getVault();
    if (!vaultData?.walletAddress) {
      logError('squads_add_member', 'wallet_address_not_found');
      throw new Error('Wallet address not found. Please recreate your vault.');
    }
    walletPubkey = new PublicKey(vaultData.walletAddress);
  }

  // Cloud keypair pays for tx fees and rent
  const feePayer = cloudPubkey;

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

  // Fetch current multisig to get next transaction index
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  // --- Step 1: Create config tx + proposal + approve(cloud) + approve(device) [+ approve(wallet)] ---
  const configTxIx = multisig.instructions.configTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: feePayer,
    actions: [
      {
        __kind: 'AddMember' as const,
        newMember: { key: newMemberPubkey, permissions },
      },
    ],
  });

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: feePayer,
  });

  const approveCloudIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
  });

  const approveDeviceIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: devicePubkey,
  });

  const tx1Instructions = [configTxIx, proposalIx, approveCloudIx, approveDeviceIx];
  if (IS_SOLANA_MOBILE && walletPubkey) {
    tx1Instructions.push(multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: walletPubkey,
    }));
  }

  // --- Build all transactions with one blockhash (Jito bundle) ---
  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // TX1: create + propose + approve×N
  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx1Instructions,
  }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);
  await signTransactionNatively(tx1, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
    { pubkey: devicePubkey, signFn: signWithDevice },
  ]);

  // TX2: execute + close + Jito tip (all in one tx for atomicity)
  const executeIx = multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
    rentPayer: feePayer,
  });

  const tx2Instructions: TransactionInstruction[] = [executeIx];
  if (multisigAccount.rentCollector) {
    tx2Instructions.push(
      multisig.instructions.configTransactionAccountsClose({
        multisigPda,
        transactionIndex,
        rentCollector: new PublicKey(multisigAccount.rentCollector),
      }),
    );
  }
  tx2Instructions.push(jitoTipIx(feePayer));

  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx2Instructions,
  }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);
  await signTransactionNatively(tx2, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  // MWA wallet signing: wallet approves the proposal in TX1
  if (IS_SOLANA_MOBILE && walletPubkey) {
    await signTransactionsWithWallet([tx1, tx2], [0], walletPubkey);
  }

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');

  await apiService.sendBundle([tx1Base64, tx2Base64]);

  const signature = bs58.encode(tx2.signatures[0]);
  return { signature };
}

export async function removeMember(
  multisigAddress: string,
  memberAddress: string,
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);
  const memberPubkey = new PublicKey(memberAddress);

  const cloudPubBase58 = await getCloudPublicKey();
  const devicePubBase58 = await getDevicePublicKey();
  if (!cloudPubBase58 || !devicePubBase58) {
    logError('squads_remove_member', 'keypairs_not_found');
    throw new Error('Signing keypairs not found. Please recreate your vault.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

  let walletPubkey: PublicKey | null = null;
  if (IS_SOLANA_MOBILE) {
    const vaultData = await getVault();
    if (!vaultData?.walletAddress) {
      logError('squads_remove_member', 'wallet_address_not_found');
      throw new Error('Wallet address not found. Please recreate your vault.');
    }
    walletPubkey = new PublicKey(vaultData.walletAddress);
  }

  const feePayer = cloudPubkey;

  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  const configTxIx = multisig.instructions.configTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: feePayer,
    actions: [
      {
        __kind: 'RemoveMember' as const,
        oldMember: memberPubkey,
      },
    ],
  });

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: feePayer,
  });

  const approveCloudIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
  });

  const approveDeviceIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: devicePubkey,
  });

  const tx1Instructions = [configTxIx, proposalIx, approveCloudIx, approveDeviceIx];
  if (IS_SOLANA_MOBILE && walletPubkey) {
    tx1Instructions.push(multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: walletPubkey,
    }));
  }

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx1Instructions,
  }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);
  await signTransactionNatively(tx1, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
    { pubkey: devicePubkey, signFn: signWithDevice },
  ]);

  const executeIx = multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
    rentPayer: feePayer,
  });

  const tx2Instructions: TransactionInstruction[] = [executeIx];
  if (multisigAccount.rentCollector) {
    tx2Instructions.push(
      multisig.instructions.configTransactionAccountsClose({
        multisigPda,
        transactionIndex,
        rentCollector: new PublicKey(multisigAccount.rentCollector),
      }),
    );
  }
  tx2Instructions.push(jitoTipIx(feePayer));

  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx2Instructions,
  }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);
  await signTransactionNatively(tx2, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  if (IS_SOLANA_MOBILE && walletPubkey) {
    await signTransactionsWithWallet([tx1, tx2], [0], walletPubkey);
  }

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');

  await apiService.sendBundle([tx1Base64, tx2Base64]);

  const signature = bs58.encode(tx2.signatures[0]);
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
): Promise<{ signature: string; bundleSignatures: string[] }> {
  const multisigPda = new PublicKey(multisigAddress);

  // Get cloud/device public keys from native storage
  const cloudPubBase58 = await getCloudPublicKey();
  const devicePubBase58 = await getDevicePublicKey();
  if (!cloudPubBase58 || !devicePubBase58) {
    logError('squads_vault_tx', 'keypairs_not_found');
    throw new Error('Signing keypairs not found. Please recreate your vault.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

  // Get wallet address for MWA signing (if Solana Mobile)
  let walletPubkey: PublicKey | null = null;
  if (IS_SOLANA_MOBILE) {
    const vaultData = await getVault();
    if (!vaultData?.walletAddress) {
      logError('squads_vault_tx', 'wallet_address_not_found');
      throw new Error('Wallet address not found. Please recreate your vault.');
    }
    walletPubkey = new PublicKey(vaultData.walletAddress);
  }

  // Cloud keypair pays for tx fees and rent
  const feePayer = cloudPubkey;

  // Derive vault PDA
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  // Check vault has enough SOL for fees
  const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
  if (vaultBalance < TARGET_CLOUD_BALANCE) {
    const needed = (TARGET_CLOUD_BALANCE / 1e9).toFixed(3);
    const have = (vaultBalance / 1e9).toFixed(4);
    throw new Error(`Insufficient SOL for transaction fees. Need ${needed} SOL but vault only has ${have} SOL. Please deposit SOL to your vault first.`);
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

  // Always transfer TARGET_CLOUD_BALANCE from vault to cloud wallet for tx fees + rent
  txInstructions.unshift(
    SystemProgram.transfer({
      fromPubkey: vaultPda,
      toPubkey: cloudPubkey,
      lamports: TARGET_CLOUD_BALANCE,
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

  // --- TX 1: Create vault tx + propose + approve(cloud) + approve(device) ---
  const createVaultTxIx = multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: feePayer,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: innerMessage,
    addressLookupTableAccounts: luts.length > 0 ? luts : undefined,
  });

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: feePayer,
  });

  const approveCloudIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
  });

  const approveDeviceIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: devicePubkey,
  });

  const tx2Instructions = [proposalIx, approveCloudIx, approveDeviceIx];
  if (IS_SOLANA_MOBILE && walletPubkey) {
    tx2Instructions.push(multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: walletPubkey,
    }));
  }

  // --- TX 2: Execute ---
  const executeIx = buildVaultExecuteIx(
    multisigPda,
    transactionIndex,
    cloudPubkey,
    vaultPda,
    innerMessage,
    luts,
  );

  // --- TX 3: Close (if rentCollector set) + withdraw cloud SOL back to vault + Jito tip ---
  const tx3Instructions: TransactionInstruction[] = [];
  if (multisigAccount.rentCollector) {
    tx3Instructions.push(
      multisig.instructions.vaultTransactionAccountsClose({
        multisigPda,
        transactionIndex,
        rentCollector: new PublicKey(multisigAccount.rentCollector),
      }),
    );
  }
  tx3Instructions.push(jitoTipIx(feePayer));
  tx3Instructions.push(
    kitIxToWeb3(createWithdrawInstruction(
      kitAddress(cloudPubkey.toBase58()),
      kitAddress(vaultPda.toBase58()),
      TARGET_CLOUD_BALANCE,
    )),
  );

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
    await signTransactionNatively(tx1, [
      { pubkey: cloudPubkey, signFn: signWithCloud },
    ]);

    // TX2: propose + approve×N
    const msg2 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: tx2Instructions,
    }).compileToV0Message(luts);
    collectTxAccounts('TX2 (propose+approve)', msg2);
    const tx2 = new VersionedTransaction(msg2);
    debugLines.push(`TX2 size: ${tx2.serialize().length} bytes`);
    await signTransactionNatively(tx2, [
      { pubkey: cloudPubkey, signFn: signWithCloud },
      { pubkey: devicePubkey, signFn: signWithDevice },
    ]);

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
    await signTransactionNatively(tx3, [
      { pubkey: cloudPubkey, signFn: signWithCloud },
    ]);

    // TX4: close + tip + withdraw cloud SOL back to vault
    const msg4 = new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: blockhash,
      instructions: tx3Instructions,
    }).compileToV0Message(luts);
    collectTxAccounts('TX4 (close+tip+withdraw)', msg4);
    const tx4 = new VersionedTransaction(msg4);
    debugLines.push(`TX4 size: ${tx4.serialize().length} bytes`);
    await signTransactionNatively(tx4, [
      { pubkey: cloudPubkey, signFn: signWithCloud },
    ]);

    // MWA wallet signing: wallet approves the proposal in TX2
    if (IS_SOLANA_MOBILE && walletPubkey) {
      console.log('[VaultTx] MWA signing TX2...');
      await signTransactionsWithWallet([tx1, tx2, tx3, tx4], [1], walletPubkey);
      console.log('[VaultTx] MWA signing done');
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
    const bundleResult = await apiService.sendBundle([tx1Base64, tx2Base64, tx3Base64, tx4Base64]);
    console.log(`[VaultTx] bundle result: id=${bundleResult.bundleId}, status=${bundleResult.status}`);

    const signature = bs58.encode(tx3.signatures[0]);
    const bundleSignatures = [
      bs58.encode(tx1.signatures[0]),
      bs58.encode(tx2.signatures[0]),
      bs58.encode(tx3.signatures[0]),
      bs58.encode(tx4.signatures[0]),
    ];
    console.log(`[VaultTx] signature: ${signature}`);
    return { signature, bundleSignatures };
  } catch (err: any) {
    logError('squads_vault_tx', err.message || 'unknown');
    debugLines.push(`ERROR: ${err.message}`);
    // Await so the logs arrive before we re-throw
    await apiService.debugLog('VaultTx', debugLines).catch(() => {});
    throw err;
  }
}

/**
 * Set rentCollector on an existing multisig via config transaction.
 * Required before vault/config transaction accounts can be closed.
 */
async function setRentCollector(
  multisigPda: PublicKey,
  cloudPubkey: PublicKey,
  devicePubkey: PublicKey,
  currentTransactionIndex: bigint,
  walletPubkey: PublicKey | null,
): Promise<void> {
  const transactionIndex = currentTransactionIndex + 1n;

  const configTxIx = multisig.instructions.configTransactionCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: cloudPubkey,
    actions: [
      {
        __kind: 'SetRentCollector' as const,
        newRentCollector: cloudPubkey,
      },
    ],
  });

  const proposalIx = multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex,
    creator: cloudPubkey,
    rentPayer: cloudPubkey,
  });

  const approveCloudIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
  });

  const approveDeviceIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: devicePubkey,
  });

  const tx1Instructions = [configTxIx, proposalIx, approveCloudIx, approveDeviceIx];
  if (IS_SOLANA_MOBILE && walletPubkey) {
    tx1Instructions.push(multisig.instructions.proposalApprove({
      multisigPda,
      transactionIndex,
      member: walletPubkey,
    }));
  }

  const executeIx = multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
    rentPayer: cloudPubkey,
  });

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // TX 1: create + propose + approve×N
  const msg1 = new TransactionMessage({
    payerKey: cloudPubkey,
    recentBlockhash: blockhash,
    instructions: tx1Instructions,
  }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);
  await signTransactionNatively(tx1, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
    { pubkey: devicePubkey, signFn: signWithDevice },
  ]);

  // TX 2: execute + Jito tip
  const msg2 = new TransactionMessage({
    payerKey: cloudPubkey,
    recentBlockhash: blockhash,
    instructions: [executeIx, jitoTipIx(cloudPubkey)],
  }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);
  await signTransactionNatively(tx2, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  // MWA wallet signing: wallet approves the proposal in TX1
  if (IS_SOLANA_MOBILE && walletPubkey) {
    await signTransactionsWithWallet([tx1, tx2], [0], walletPubkey);
  }

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');

  await apiService.sendBundle([tx1Base64, tx2Base64]);
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
): Promise<{ closed: number; skipped: number; failed: number }> {
  const multisigPda = new PublicKey(multisigAddress);

  const cloudPubBase58 = await getCloudPublicKey();
  const devicePubBase58 = await getDevicePublicKey();
  if (!cloudPubBase58 || !devicePubBase58) {
    logError('squads_reclaim_rent', 'keypairs_not_found');
    throw new Error('Signing keypairs not found.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

  // Get wallet address for MWA signing (if Solana Mobile)
  let walletPubkey: PublicKey | null = null;
  if (IS_SOLANA_MOBILE) {
    const vaultData = await getVault();
    if (vaultData?.walletAddress) {
      walletPubkey = new PublicKey(vaultData.walletAddress);
    }
  }

  let acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);

  // Step 1: Ensure rentCollector is set
  if (!acct.rentCollector) {
    onProgress?.('Setting rent collector...');
    await setRentCollector(
      multisigPda,
      cloudPubkey,
      devicePubkey,
      BigInt(acct.transactionIndex.toString()),
      walletPubkey,
    );
    // Re-fetch after setting
    acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
    if (!acct.rentCollector) {
      logError('squads_reclaim_rent', 'set_rent_collector_failed');
      throw new Error('Failed to set rent collector');
    }
  }

  const rentCollector = new PublicKey(acct.rentCollector!);
  const updatedTotal = Number(acct.transactionIndex.toString());

  // Account discriminators (first 8 bytes) to detect transaction type
  const VAULT_TX_DISC = [168, 250, 162, 100, 81, 14, 162, 207];
  const CONFIG_TX_DISC = [94, 8, 4, 35, 113, 139, 139, 112];

  let closed = 0;
  let skipped = 0;
  let failed = 0;

  // Step 2: Collect all closeable accounts
  interface CloseableAccount {
    txIndex: bigint;
    isVaultTx: boolean;
  }
  const closeable: CloseableAccount[] = [];

  for (let i = 1; i <= updatedTotal; i++) {
    const txIndex = BigInt(i);
    const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: txIndex });

    const txAccountInfo = await connection.getAccountInfo(transactionPda);
    if (!txAccountInfo) {
      skipped++;
      continue;
    }

    // Check proposal status — can only close Executed, Rejected, or Cancelled
    const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex: txIndex });
    try {
      const proposal = await multisig.accounts.Proposal.fromAccountAddress(connection, proposalPda);
      const status = proposal.status.__kind;
      if (status !== 'Executed' && status !== 'Rejected' && status !== 'Cancelled') {
        onProgress?.(`Skipping ${i}/${updatedTotal} (status: ${status})`);
        skipped++;
        continue;
      }
    } catch {
      skipped++;
      continue;
    }

    // Detect account type from discriminator
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

  // Step 3: Batch close in groups of up to 5 via Jito bundles
  const luts = await getLuts(connection);
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
          ? multisig.instructions.vaultTransactionAccountsClose({
              multisigPda,
              transactionIndex: txIndex,
              rentCollector,
            })
          : multisig.instructions.configTransactionAccountsClose({
              multisigPda,
              transactionIndex: txIndex,
              rentCollector,
            });

        // Add Jito tip to last tx in batch
        const ixs = t === batch.length - 1
          ? [closeIx, jitoTipIx(cloudPubkey)]
          : [closeIx];

        const msg = new TransactionMessage({
          payerKey: cloudPubkey,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message(luts);
        const tx = new VersionedTransaction(msg);

        await signTransactionNatively(tx, [
          { pubkey: cloudPubkey, signFn: signWithCloud },
        ]);

        serializedTxs.push(Buffer.from(tx.serialize()).toString('base64'));
      }

      await apiService.sendBundle(serializedTxs);
      closed += batch.length;
    } catch (err: any) {
      logError('squads_reclaim_rent', `batch_failed: ${err.message || 'unknown'}`);
      console.warn(`Failed to build batch:`, err.message || err);
      failed += batch.length;
    }
  }

  return { closed, skipped, failed };
}

/**
 * Get stored vault data from local storage.
 */
export { getVault } from './vaultStorage';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
