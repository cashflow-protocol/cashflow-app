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
import {
  mplCore,
  create as createCoreAsset,
  fetchAssetV1,
  updatePlugin,
} from '@metaplex-foundation/mpl-core';
import { getAdminTxFeePayerKeypair } from '../services/adminFeePayer';
import * as storage from '../services/storageManager';
import type { SerializedInstruction } from '../types';
import { getSetting, APP_SETTING_KEYS } from '../models/AppSetting';

const DEFAULT_PASSPORT_IMAGE_URL = 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/rewards/badges/passport.png';
const PASSPORT_METADATA_KEY = 'rewards/metadata/passport.json';

export interface BuildActivationTransactionResult {
  mintTransactionBase64: string;
  assetAddress: string;
  innerInstructions: SerializedInstruction[];
  blockhash: string;
  collectionAddress: string;
}

/**
 * Activation fee charged for minting a Cashflow Passport. Read at request time so the
 * value can be tuned without redeploying. Defaults to 0.02 SOL (matches the old
 * per-badge fee).
 */
export function getCashflowPassportActivationFeeLamports(): bigint {
  const raw = process.env.CASHFLOW_PASSPORT_ACTIVATION_FEE_LAMPORTS;
  if (raw && /^\d+$/.test(raw)) return BigInt(raw);
  return 20_000_000n;
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

  /**
   * Resolve the metadata URI for the Cashflow Passport asset. Lazily
   * generates and uploads a metadata JSON to DO Spaces on first call so
   * Solscan/wallets can render the badge image. Cached in-process; the JSON
   * itself is identical across users so upserting is idempotent.
   *
   * Override via CASHFLOW_PASSPORT_METADATA_URI to point at a hand-curated JSON.
   */
  private cachedPassportMetadataUri: string | null = null;
  async getCashflowPassportMetadataUri(): Promise<string> {
    if (process.env.CASHFLOW_PASSPORT_METADATA_URI) {
      return process.env.CASHFLOW_PASSPORT_METADATA_URI;
    }
    if (this.cachedPassportMetadataUri) return this.cachedPassportMetadataUri;

    const imageUrl = process.env.CASHFLOW_PASSPORT_IMAGE_URL ?? DEFAULT_PASSPORT_IMAGE_URL;
    const name = process.env.CASHFLOW_PASSPORT_NAME ?? 'Cashflow Passport';

    if (!storage.isConfigured()) {
      // Without DO Spaces we can't host JSON — fall back to the bare PNG URL
      // (Solscan won't render the title but the image will load).
      this.cachedPassportMetadataUri = imageUrl;
      return imageUrl;
    }

    const metadata = {
      name,
      description: 'Soulbound on-chain passport. Earned Cashflow badges live on this asset as Attributes.',
      image: imageUrl,
      external_url: 'https://cashflow.fun',
      attributes: [],
      properties: {
        files: [{ uri: imageUrl, type: 'image/png' }],
        category: 'image',
      },
    };

    const url = await storage.uploadFile(
      Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
      PASSPORT_METADATA_KEY,
      'application/json',
    );
    this.cachedPassportMetadataUri = url;
    return url;
  }

  /**
   * Build the standalone Metaplex Core mint transaction for a user's
   * "Cashflow Passport" — a single soulbound NFT that hosts earned-badge entries
   * via the Attributes plugin.
   *
   * Returns a base64-encoded VersionedTransaction pre-signed by the admin
   * keypair AND the asset keypair (mobile appends to the Jito bundle as-is),
   * plus inner instructions (SystemProgram.transfer vault → treasury) for
   * the user's vault execute.
   *
   * Soulbound enforcement: PermanentFreezeDelegate plugin with frozen=true
   * means the asset can never be transferred — even by the admin update
   * authority. The Attributes plugin is pre-initialized so admin can append
   * earned-badge entries later without paying allocation rent.
   */
  async buildCashflowPassportMintTransaction(params: {
    vaultAddress: string;
  }): Promise<BuildActivationTransactionResult> {
    const { vaultAddress } = params;
    const collectionAddress = await this.getCollectionAddress();

    const assetKeypair = Keypair.generate();
    const assetAddress = assetKeypair.publicKey.toBase58();

    const adminKeypair = getAdminTxFeePayerKeypair();
    const umi = createUmi(this.rpc.rpcEndpoint).use(mplCore());
    const umiAdminKeypair = umi.eddsa.createKeypairFromSecretKey(adminKeypair.secretKey);
    umi.use(keypairIdentity(umiAdminKeypair));

    const umiAssetKeypair = umi.eddsa.createKeypairFromSecretKey(assetKeypair.secretKey);
    const umiAssetSigner = createSignerFromKeypair(umi, umiAssetKeypair);

    const metadataUri = await this.getCashflowPassportMetadataUri();
    const name = process.env.CASHFLOW_PASSPORT_NAME ?? 'Cashflow Passport';

    const createBuilder = createCoreAsset(umi, {
      asset: umiAssetSigner,
      collection: { publicKey: umiPublicKey(collectionAddress) } as any,
      name,
      uri: metadataUri,
      owner: umiPublicKey(vaultAddress),
      authority: umi.identity,
      payer: umi.identity,
      plugins: [
        { type: 'Attributes', attributeList: [] },
        { type: 'PermanentFreezeDelegate', frozen: true },
      ],
    });

    const umiInstructions = createBuilder.getInstructions();
    const web3Instructions = umiInstructions.map(umiInstructionToWeb3);

    const { blockhash } = await this.rpc.getLatestBlockhash('confirmed');
    const message = new TransactionMessage({
      payerKey: adminKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
        ...web3Instructions,
      ],
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([adminKeypair, assetKeypair]);

    const mintTransactionBase64 = Buffer.from(tx.serialize()).toString('base64');

    const feeLamports = getCashflowPassportActivationFeeLamports();
    if (feeLamports <= 0n) throw new Error('Invalid CASHFLOW_PASSPORT_ACTIVATION_FEE_LAMPORTS');

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
      collectionAddress,
    };
  }

  /**
   * Append a `{ key, value }` entry to the Attributes plugin on the user's
   * Cashflow Passport asset, then send the transaction signed only by the admin
   * keypair (admin holds UpdateAuthority — no user signature needed).
   *
   * Returns the resulting signature (string). Throws on RPC/build failure.
   */
  async appendBadgeAttribute(params: {
    assetAddress: string;
    key: string;
    value: string;
  }): Promise<string> {
    const { assetAddress, key, value } = params;
    const collectionAddress = await this.getCollectionAddress();

    const adminKeypair = getAdminTxFeePayerKeypair();
    const umi = createUmi(this.rpc.rpcEndpoint).use(mplCore());
    const umiAdminKeypair = umi.eddsa.createKeypairFromSecretKey(adminKeypair.secretKey);
    umi.use(keypairIdentity(umiAdminKeypair));

    // Fetch current asset state to read the existing attributeList. The
    // Attributes plugin update REPLACES the list, so we must include all
    // existing entries plus the new one, and dedupe on key.
    const asset = await fetchAssetV1(umi, umiPublicKey(assetAddress));
    const existing = asset.attributes?.attributeList ?? [];

    if (existing.some((a) => a.key === key)) {
      // Idempotent: badge already present. Return a sentinel so callers can
      // skip onchain work.
      return '';
    }

    const nextList = [...existing, { key, value }];

    const builder = updatePlugin(umi, {
      asset: umiPublicKey(assetAddress),
      collection: umiPublicKey(collectionAddress),
      plugin: { type: 'Attributes', attributeList: nextList },
    });

    const result = await builder.sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });
    return Buffer.from(result.signature).toString('base64');
  }
}
