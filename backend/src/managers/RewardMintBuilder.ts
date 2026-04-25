import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  SystemProgram,
} from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  keypairIdentity,
  publicKey as umiPublicKey,
  createSignerFromKeypair,
  type Instruction as UmiInstruction,
} from '@metaplex-foundation/umi';
import { mplCore, create as createCoreAsset } from '@metaplex-foundation/mpl-core';
import { getAdminTxFeePayerKeypair } from '../services/adminFeePayer';
import type { RewardTask } from '../models/RewardTask';
import type { SerializedInstruction } from '../types';
import { getSetting, APP_SETTING_KEYS } from '../models/AppSetting';

export interface BuildMintTransactionResult {
  /** Base64-encoded VersionedTransaction containing the Metaplex Core create instruction. */
  mintTransactionBase64: string;
  /** Pubkey of the new asset (base58). */
  assetAddress: string;
  /** Inner instructions to be wrapped in the user's vault transaction execute (fee transfer). */
  innerInstructions: SerializedInstruction[];
  /** Recent blockhash used for the mint transaction. */
  blockhash: string;
}

/**
 * Convert a Umi instruction to a web3.js TransactionInstruction.
 */
function umiInstructionToWeb3(ix: UmiInstruction): import('@solana/web3.js').TransactionInstruction {
  return {
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  } as import('@solana/web3.js').TransactionInstruction;
}

/**
 * Build the standalone Metaplex Core mint transaction for a reward badge.
 *
 * Returns:
 *   - A base64-encoded VersionedTransaction pre-signed by the admin keypair AND
 *     the asset keypair. Mobile appends this to the Jito bundle as-is.
 *   - The inner instructions (SystemProgram.transfer from vault → treasury)
 *     to be wrapped in the user's vault execute (TX1-TX4).
 *
 * Soulbound enforcement: PermanentFreezeDelegate plugin with frozen=true means
 * the asset can never be transferred — even by the admin update authority.
 */
export class RewardMintBuilder {
  private rpc: Connection;
  private treasuryAddress: string;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required');

    const treasuryAddress = process.env.TREASURY_WALLET_ADDRESS;
    if (!treasuryAddress) throw new Error('TREASURY_WALLET_ADDRESS is required');

    this.rpc = new Connection(rpcUrl, 'confirmed');
    this.treasuryAddress = treasuryAddress;
  }

  /**
   * Resolve the rewards collection address. DB setting takes precedence over env.
   * Lets admins update the collection without redeploying.
   */
  async getCollectionAddress(): Promise<string> {
    const value = await getSetting(APP_SETTING_KEYS.REWARDS_COLLECTION_ADDRESS, process.env.REWARDS_COLLECTION_ADDRESS ?? null);
    if (!value) {
      throw new Error('REWARDS_COLLECTION_ADDRESS not set — configure it in the admin or env');
    }
    return value;
  }

  async buildMintTransaction(params: {
    task: RewardTask;
    vaultAddress: string;
  }): Promise<BuildMintTransactionResult> {
    const { task, vaultAddress } = params;
    const collectionAddress = await this.getCollectionAddress();

    // ── Generate ephemeral asset keypair ──
    const assetKeypair = Keypair.generate();
    const assetAddress = assetKeypair.publicKey.toBase58();

    // ── Set up Umi with admin keypair ──
    const adminKeypair = getAdminTxFeePayerKeypair();
    const umi = createUmi(this.rpc.rpcEndpoint).use(mplCore());
    const umiAdminKeypair = umi.eddsa.createKeypairFromSecretKey(adminKeypair.secretKey);
    umi.use(keypairIdentity(umiAdminKeypair));

    const umiAssetKeypair = umi.eddsa.createKeypairFromSecretKey(assetKeypair.secretKey);
    const umiAssetSigner = createSignerFromKeypair(umi, umiAssetKeypair);

    // ── Build the Metaplex Core create instruction ──
    const createBuilder = createCoreAsset(umi, {
      asset: umiAssetSigner,
      collection: { publicKey: umiPublicKey(collectionAddress) } as any,
      name: task.title,
      uri: task.metadataUri,
      owner: umiPublicKey(vaultAddress),
      authority: umi.identity, // admin
      payer: umi.identity,     // admin pays rent
      plugins: [
        {
          type: 'PermanentFreezeDelegate',
          frozen: true,
        },
      ],
    });

    const umiInstructions = createBuilder.getInstructions();
    const web3Instructions = umiInstructions.map(umiInstructionToWeb3);

    // ── Compose the standalone mint transaction (admin + asset signers) ──
    const { blockhash } = await this.rpc.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: adminKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ...web3Instructions,
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([adminKeypair, assetKeypair]);

    const mintTransactionBase64 = Buffer.from(tx.serialize()).toString('base64');

    // ── Build inner instructions for the vault execute ──
    const feeLamports = BigInt(task.mintFeeLamports);
    if (feeLamports <= 0n) throw new Error('Invalid mintFeeLamports for task');

    const transferIx = SystemProgram.transfer({
      fromPubkey: new PublicKey(vaultAddress),
      toPubkey: new PublicKey(this.treasuryAddress),
      lamports: feeLamports,
    });

    const innerInstructions: SerializedInstruction[] = [
      {
        programId: transferIx.programId.toBase58(),
        accounts: transferIx.keys.map((k) => ({
          pubkey: k.pubkey.toBase58(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(transferIx.data).toString('base64'),
      },
    ];

    return {
      mintTransactionBase64,
      assetAddress,
      innerInstructions,
      blockhash,
    };
  }
}
