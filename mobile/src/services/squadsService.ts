import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
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

const { Permission, Permissions } = multisig.types;

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

  // Get latest blockhash
  const { blockhash } = await connection.getLatestBlockhash('confirmed');

  // Build unsigned VersionedTransaction (2-of-3 multisig)
  const tx = multisig.transactions.multisigCreateV2({
    blockhash,
    treasury: programConfig.treasury,
    createKey: createKey.publicKey,
    creator: creatorPubkey,
    multisigPda,
    configAuthority: null,
    threshold: 2,
    members: [
      {
        key: cloudPubkey,
        permissions: Permissions.all(),
      },
      {
        key: devicePubkey,
        permissions: Permissions.all(),
      },
      {
        key: creatorPubkey,
        permissions: Permissions.fromPermissions([Permission.Vote]),
      },
    ],
    timeLock: 0,
    rentCollector: null,
    memo: 'Cashflow',
  });

  // Partially sign with the ephemeral createKey (single-use, safe in JS)
  tx.sign([createKey]);

  // Serialize to base64 for the signing service
  const txBase64 = Buffer.from(tx.serialize()).toString('base64');

  // Sign with user wallet (fee payer) and broadcast
  const { signature } = await signAndSendTransaction(txBase64, '');

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
 * never enter JS. The hardcoded wallet is the fee payer only.
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

  const { blockhash: blockhash1 } = await connection.getLatestBlockhash('confirmed');
  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash1,
    instructions: [configTxIx, proposalIx, approveCloudIx, approveDeviceIx],
  }).compileToV0Message();
  const tx1 = new VersionedTransaction(msg1);

  // Sign with cloud (fee payer + creator) + device via native module
  await signTransactionNatively(tx1, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
    { pubkey: devicePubkey, signFn: signWithDevice },
  ]);

  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  await apiService.sendTransaction(tx1Base64, '');

  // Wait for confirmation before executing
  await sleep(2000);

  // --- Step 2: Execute the config transaction ---
  const executeIx = multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: cloudPubkey,
    rentPayer: feePayer,
  });

  const { blockhash: blockhash2 } = await connection.getLatestBlockhash('confirmed');
  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash2,
    instructions: [executeIx],
  }).compileToV0Message();
  const tx2 = new VersionedTransaction(msg2);

  // Only cloud signs (fee payer + executor)
  await signTransactionNatively(tx2, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
  await apiService.sendTransaction(tx2Base64, '');

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

  // Convert serialized instructions → TransactionInstruction[]
  const txInstructions = instructions.map(
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

  // Build inner message (vault PDA as payer for the inner instructions)
  const { blockhash: innerBlockhash } = await connection.getLatestBlockhash('confirmed');
  const innerMessage = new TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: innerBlockhash,
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

  const { blockhash: blockhash1 } = await connection.getLatestBlockhash('confirmed');
  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash1,
    instructions: [createVaultTxIx, proposalIx, approveCloudIx, approveDeviceIx],
  }).compileToV0Message();
  const tx1 = new VersionedTransaction(msg1);

  // Sign with cloud (fee payer + creator) + device via native module
  await signTransactionNatively(tx1, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
    { pubkey: devicePubkey, signFn: signWithDevice },
  ]);

  // Send fully-signed transaction directly (no dev wallet needed)
  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  await apiService.sendTransaction(tx1Base64, '');

  // Wait for confirmation before executing
  await sleep(2000);

  // --- TX 2: Execute the vault transaction ---
  const { instruction: executeIx, lookupTableAccounts } =
    await multisig.instructions.vaultTransactionExecute({
      connection,
      multisigPda,
      transactionIndex,
      member: cloudPubkey,
    });

  const { blockhash: blockhash2 } = await connection.getLatestBlockhash('confirmed');
  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash2,
    instructions: [executeIx],
  }).compileToV0Message(lookupTableAccounts);
  const tx2 = new VersionedTransaction(msg2);

  // Only cloud signs the execute step (it's also the fee payer)
  await signTransactionNatively(tx2, [
    { pubkey: cloudPubkey, signFn: signWithCloud },
  ]);

  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
  await apiService.sendTransaction(tx2Base64, '');

  // Extract signature from TX2 (first 64 bytes after compact-u16 prefix)
  const signature = bs58.encode(tx2.signatures[0]);

  return { signature };
}

/**
 * Get stored vault data from local storage.
 */
export { getVault } from './vaultStorage';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
