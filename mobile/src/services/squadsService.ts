import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { SOLANA_CONFIG } from '../config/solana';
import { signAndSendTransaction } from './signingService';
import { saveVault, type VaultData } from './vaultStorage';
import { saveCloudKeypair, saveDeviceKeypair, getCloudKeypair, getDeviceKeypair } from './keypairStorage';

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
 * Create a new Squads V4 multisig (2-of-3) with:
 * - cloudKeypair: all permissions, stored in iCloud Keychain
 * - deviceKeypair: all permissions, stored device-only (no backup)
 * - main wallet: Vote permission only
 *
 * Generates an ephemeral createKey for PDA derivation, builds and partially
 * signs the tx, then passes to signingService for the fee payer signature + broadcast.
 */
export async function createMultisig(
  walletAddress: string,
): Promise<CreateMultisigResult> {
  const creatorPubkey = new PublicKey(walletAddress);

  // Generate the two Squad member keypairs
  const cloudKeypair = Keypair.generate();
  const deviceKeypair = Keypair.generate();

  // Store keypairs securely before broadcasting (fail early if storage fails)
  await saveCloudKeypair(cloudKeypair.secretKey);
  await saveDeviceKeypair(deviceKeypair.secretKey);

  // Generate ephemeral createKey (only used once for PDA derivation)
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
        key: cloudKeypair.publicKey,
        permissions: Permissions.all(),
      },
      {
        key: deviceKeypair.publicKey,
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

  // Partially sign with the ephemeral createKey
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
 * propose, and approve. The hardcoded wallet is the fee payer only.
 * With threshold 2, both cloud and device must approve before execution.
 *
 * Step 1: configTransactionCreate + proposalCreate + approve(cloud) + approve(device)
 * Step 2: configTransactionExecute (after step 1 confirms)
 */
export async function addMember(
  multisigAddress: string,
  newMemberAddress: string,
  permissionType: 'all' | 'vote' | 'execute',
  walletAddress: string,
): Promise<{ signature: string }> {
  const multisigPda = new PublicKey(multisigAddress);
  const feePayer = new PublicKey(walletAddress);
  const newMemberPubkey = new PublicKey(newMemberAddress);

  // Load stored keypairs — these have Initiate + Vote + Execute permissions
  const cloudBytes = await getCloudKeypair();
  const deviceBytes = await getDeviceKeypair();
  if (!cloudBytes || !deviceBytes) {
    throw new Error('Signing keypairs not found. Please recreate your vault.');
  }
  const cloudKeypair = Keypair.fromSecretKey(cloudBytes);
  const deviceKeypair = Keypair.fromSecretKey(deviceBytes);

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
    creator: cloudKeypair.publicKey,
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
    creator: cloudKeypair.publicKey,
  });

  const approveCloudIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: cloudKeypair.publicKey,
  });

  const approveDeviceIx = multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex,
    member: deviceKeypair.publicKey,
  });

  // Build tx with fee payer = hardcoded wallet, both keypairs as signers
  const { blockhash: blockhash1 } = await connection.getLatestBlockhash('confirmed');
  const msg1 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash1,
    instructions: [configTxIx, proposalIx, approveCloudIx, approveDeviceIx],
  }).compileToV0Message();
  const tx1 = new VersionedTransaction(msg1);

  // Partially sign with both stored keypairs
  tx1.sign([cloudKeypair, deviceKeypair]);

  // Send for fee payer signature + broadcast
  const tx1Base64 = Buffer.from(tx1.serialize()).toString('base64');
  await signAndSendTransaction(tx1Base64, '');

  // Wait for confirmation before executing
  await sleep(2000);

  // --- Step 2: Execute the config transaction ---
  const executeIx = multisig.instructions.configTransactionExecute({
    multisigPda,
    transactionIndex,
    member: cloudKeypair.publicKey,
    rentPayer: feePayer,
  });

  const { blockhash: blockhash2 } = await connection.getLatestBlockhash('confirmed');
  const msg2 = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash2,
    instructions: [executeIx],
  }).compileToV0Message();
  const tx2 = new VersionedTransaction(msg2);

  // Partially sign with cloud keypair (the executor)
  tx2.sign([cloudKeypair]);

  const tx2Base64 = Buffer.from(tx2.serialize()).toString('base64');
  const { signature } = await signAndSendTransaction(tx2Base64, '');

  return { signature };
}

/**
 * Get stored vault data from local storage.
 */
export { getVault } from './vaultStorage';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
