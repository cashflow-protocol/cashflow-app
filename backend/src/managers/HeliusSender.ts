import { PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction, Connection } from '@solana/web3.js';

const HELIUS_SENDER_URL = process.env.HELIUS_SENDER_URL || 'https://sender.helius-rpc.com';
const HELIUS_SENDER_FAST = `${HELIUS_SENDER_URL}/fast`;

const TIP_ACCOUNTS = [
  '4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE',
  'D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ',
  '9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta',
  '5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn',
  '2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD',
  '2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ',
  'wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF',
  '3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT',
  '4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey',
  '4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or',
];

const TIP_LAMPORTS = 250_000;

export class HeliusSender {
  /**
   * Send a base64-encoded signed transaction via Helius SWQoS.
   * Returns the transaction signature.
   */
  static async sendTransaction(base64Tx: string): Promise<string> {
    const response = await fetch(HELIUS_SENDER_FAST, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now().toString(),
        method: 'sendTransaction',
        params: [
          base64Tx,
          {
            encoding: 'base64',
            skipPreflight: true,
            maxRetries: 0,
          },
        ],
      }),
    });

    const json: any = await response.json();
    if (json.error) {
      throw new Error(`HeliusSender error: ${json.error.message || json.error}`);
    }
    if (json.code && json.message) {
      throw new Error(`HeliusSender error: ${json.message}`);
    }

    const signature = json.result;
    if (!signature) {
      console.error('[HeliusSender] Unexpected response:', JSON.stringify(json));
      throw new Error('HeliusSender: no signature returned');
    }

    return signature;
  }

  /**
   * Send a transaction and wait for confirmation with aggressive resending.
   */
  static async sendAndConfirm(base64Tx: string): Promise<string> {
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const conn = new Connection(rpcUrl, 'confirmed');

    // Extract blockhash from the actual transaction for accurate confirmation
    const txBytes = Buffer.from(base64Tx, 'base64');
    const tx = VersionedTransaction.deserialize(txBytes);
    const txBlockhash = tx.message.recentBlockhash;

    // Send initial
    console.log(`[HeliusSender] Sending to: ${HELIUS_SENDER_FAST}`);
    const signature = await this.sendTransaction(base64Tx);
    console.log(`[HeliusSender] TX sent: ${signature}, blockhash: ${txBlockhash}`);

    // Get lastValidBlockHeight for the TX's blockhash
    const { lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');

    // Resend aggressively while waiting for confirmation
    const resendInterval = setInterval(() => {
      this.sendTransaction(base64Tx).catch(() => {});
    }, 2000);

    try {
      const confirmResult = await conn.confirmTransaction(
        { signature, blockhash: txBlockhash, lastValidBlockHeight },
        'confirmed',
      );

      // confirmTransaction resolves (not throws) even on TX errors
      if (confirmResult.value.err) {
        console.error(`[HeliusSender] TX confirmed with error: ${signature}`, confirmResult.value.err);
        // Fetch detailed logs
        const txResult = await conn.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        }).catch(() => null);
        const logs = txResult?.meta?.logMessages?.filter(l => l.includes('Error') || l.includes('failed')) || [];
        const detail = logs.length > 0 ? ` (${logs.join('; ')})` : '';
        throw new Error(`Transaction failed onchain: ${JSON.stringify(confirmResult.value.err)}${detail}`);
      }
    } catch (err: any) {
      clearInterval(resendInterval);

      // If confirmTransaction threw (e.g. blockhash expired), check if TX landed anyway
      if (err.message?.includes('failed onchain')) throw err; // Already our error, re-throw

      console.warn(`[HeliusSender] confirmTransaction error: ${err.message}, checking if TX landed...`);
      const txResult = await conn.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }).catch(() => null);

      if (!txResult) {
        throw new Error('Transaction did not land onchain. It may have expired. Please try again.');
      }
      if (txResult.meta?.err) {
        const logs = txResult.meta.logMessages?.filter(l => l.includes('Error') || l.includes('failed')) || [];
        const detail = logs.length > 0 ? ` (${logs.join('; ')})` : '';
        throw new Error(`Transaction failed onchain: ${JSON.stringify(txResult.meta.err)}${detail}`);
      }

      // TX actually succeeded despite confirmTransaction throwing
      console.log(`[HeliusSender] TX confirmed (recovered): ${signature}`);
      return signature;
    } finally {
      clearInterval(resendInterval);
    }

    console.log(`[HeliusSender] TX confirmed: ${signature}`);
    return signature;
  }

  /**
   * Create a Helius tip instruction for SWQoS priority.
   */
  static createTipIx(feePayer: PublicKey): TransactionInstruction {
    const tipAccount = TIP_ACCOUNTS[Math.floor(Math.random() * TIP_ACCOUNTS.length)];
    return SystemProgram.transfer({
      fromPubkey: feePayer,
      toPubkey: new PublicKey(tipAccount),
      lamports: TIP_LAMPORTS,
    });
  }
}
