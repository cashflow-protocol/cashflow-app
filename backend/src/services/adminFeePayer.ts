import { Keypair } from '@solana/web3.js';
import { getBase58Encoder } from '@solana/kit';

let _keypair: InstanceType<typeof Keypair> | null = null;

function loadKeypair(): InstanceType<typeof Keypair> {
  if (_keypair) return _keypair;

  const key = process.env.ADMIN_ALL_TX_FEE_PAYER_PRIVATE_KEY;
  if (!key) {
    throw new Error('ADMIN_ALL_TX_FEE_PAYER_PRIVATE_KEY not configured');
  }

  const secretKey = new Uint8Array(getBase58Encoder().encode(key));
  _keypair = Keypair.fromSecretKey(secretKey);
  return _keypair;
}

export function getAdminTxFeePayerKeypair(): InstanceType<typeof Keypair> {
  return loadKeypair();
}

export function getAdminTxFeePayerPublicKey(): InstanceType<typeof Keypair>['publicKey'] {
  return loadKeypair().publicKey;
}

export function getAdminTxFeePayerPublicKeyBase58(): string {
  return loadKeypair().publicKey.toBase58();
}
