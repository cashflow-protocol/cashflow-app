import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import bs58 from 'bs58';
import { SOLANA_CONFIG } from '../config/solana';
import { signAndSendTransaction } from './signingService';
import { saveVault, type VaultData } from './vaultStorage';
import apiService from './apiService';
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

const { Permission, Permissions } = multisig.types;

const TARGET_CLOUD_BALANCE = 25_000_000;   // 0.025 SOL — enough for ~1 vault tx (fees + rent)

// 8 Jito tip accounts — pick one at random per bundle
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bVqkfRtQ7NmXwkiNPLNiNj',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSLoPGAq8W6S4p4nYxr',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL6d33',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];
const JITO_TIP_LAMPORTS = 100_000; // 0.0001 SOL

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
 * We already have the inner TransactionMessage, so we can derive the
 * remaining accounts from its compiled V0 form — same ordering the
 * on-chain program will see.
 */
function buildVaultExecuteIx(
  multisigPda: PublicKey,
  transactionIndex: bigint,
  member: PublicKey,
  vaultPda: PublicKey,
  innerMessage: TransactionMessage,
): TransactionInstruction {
  const [proposalPda] = multisig.getProposalPda({ multisigPda, transactionIndex });
  const [transactionPda] = multisig.getTransactionPda({ multisigPda, index: transactionIndex });

  const compiled = innerMessage.compileToV0Message();
  const keys = compiled.staticAccountKeys;
  const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = compiled.header;

  const numSigners = numRequiredSignatures;
  const numWritableSigners = numRequiredSignatures - numReadonlySignedAccounts;
  const numWritableNonSigners = keys.length - numRequiredSignatures - numReadonlyUnsignedAccounts;

  const accountMetas = keys.map((pubkey, i) => ({
    pubkey,
    isWritable: i < numWritableSigners ||
      (i >= numSigners && (i - numSigners) < numWritableNonSigners),
    isSigner: i < numSigners && !pubkey.equals(vaultPda),
  }));

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
      throw new Error(`Signer ${pubkey.toBase58()} not found in transaction`);
    }

    tx.signatures[index] = sigBytes;
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
  const creatorPubkey = new PublicKey(walletAddress);

  // Generate keypairs in native code — returns base58 public keys only
  const cloudPubkeyBase58 = await generateAndStoreCloudKeypair();
  const devicePubkeyBase58 = await generateAndStoreDeviceKeypair();
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

  // Fetch program config to get treasury address (required by multisigCreateV2)
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
  );

  // --- TX 1: Create multisig + fund cloud key with initial SOL ---
  const createMultisigIx = multisig.instructions.multisigCreateV2({
    treasury: programConfig.treasury,
    createKey: createKey.publicKey,
    creator: creatorPubkey,
    multisigPda,
    configAuthority: null,
    threshold: 2,
    members: [
      { key: cloudPubkey, permissions: Permissions.all() },
      { key: devicePubkey, permissions: Permissions.all() },
      { key: creatorPubkey, permissions: Permissions.fromPermissions([Permission.Vote]) },
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

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  const msg1 = new TransactionMessage({
    payerKey: creatorPubkey,
    recentBlockhash: blockhash,
    instructions: [createMultisigIx, fundCloudIx],
  }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);

  // Partially sign with the ephemeral createKey (single-use, safe in JS)
  tx1.sign([createKey]);

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  const { signature } = await signAndSendTransaction(tx1Base64, '');

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
    throw new Error('Signing keypairs not found. Please recreate your vault.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

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

  // --- Step 1: Create config tx + proposal + approve(cloud) + approve(device) ---
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

  // --- Build all transactions with one blockhash (Jito bundle) ---
  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // TX1: create + propose + approve×2
  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [configTxIx, proposalIx, approveCloudIx, approveDeviceIx],
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
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);

  // Get cloud/device public keys from native storage
  const cloudPubBase58 = await getCloudPublicKey();
  const devicePubBase58 = await getDevicePublicKey();
  if (!cloudPubBase58 || !devicePubBase58) {
    throw new Error('Signing keypairs not found. Please recreate your vault.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

  // Cloud keypair pays for tx fees and rent
  const feePayer = cloudPubkey;

  // Derive vault PDA
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  // Get current transaction index
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda,
  );
  const transactionIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

  // Guard: never create an empty vault transaction
  if (!instructions || instructions.length === 0) {
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

  // --- TX 2: Execute ---
  const executeIx = buildVaultExecuteIx(
    multisigPda,
    transactionIndex,
    cloudPubkey,
    vaultPda,
    innerMessage,
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
  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [createVaultTxIx, proposalIx, approveCloudIx, approveDeviceIx],
  }).compileToV0Message(luts);
  const tx1 = new VersionedTransaction(msg1);
  await signTransactionNatively(tx1, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
    { pubkey: devicePubkey, signFn: signWithDevice },
  ]);

  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [executeIx],
  }).compileToV0Message(luts);
  const tx2 = new VersionedTransaction(msg2);
  await signTransactionNatively(tx2, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  const msg3 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: tx3Instructions,
  }).compileToV0Message(luts);
  const tx3 = new VersionedTransaction(msg3);
  await signTransactionNatively(tx3, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
  const tx3Base64 = Buffer.from(tx3.serialize()).toString('base64');

  await apiService.sendBundle([tx1Base64, tx2Base64, tx3Base64]);

  const signature = bs58.encode(tx2.signatures[0]);
  return { signature };
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

  const executeIx = multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
    rentPayer: cloudPubkey,
  });

  const luts = await getLuts(connection);
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // TX 1: create + propose + approve×2
  const msg1 = new TransactionMessage({
    payerKey: cloudPubkey,
    recentBlockhash: blockhash,
    instructions: [configTxIx, proposalIx, approveCloudIx, approveDeviceIx],
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
    throw new Error('Signing keypairs not found.');
  }
  const cloudPubkey = new PublicKey(cloudPubBase58);
  const devicePubkey = new PublicKey(devicePubBase58);

  let acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);

  // Step 1: Ensure rentCollector is set
  if (!acct.rentCollector) {
    onProgress?.('Setting rent collector...');
    await setRentCollector(
      multisigPda,
      cloudPubkey,
      devicePubkey,
      BigInt(acct.transactionIndex.toString()),
    );
    // Re-fetch after setting
    acct = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
    if (!acct.rentCollector) {
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
