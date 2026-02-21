import { Router, Request, Response } from 'express';
import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Base64EncodedWireTransaction } from '@solana/kit';

const router = Router();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

// BigInt-safe JSON replacer (RPC returns BigInt for unitsConsumed, etc.)
const bigIntReplacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? value.toString() : value;

// POST /solana/v1/send - Send a signed transaction on-chain
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { transaction } = req.body;

    if (!transaction || typeof transaction !== 'string') {
      res.status(400).json({ success: false, error: 'transaction (base64) is required' });
      return;
    }

    // Simulate first to get detailed error info (including `err` field)
    const simResult = await rpc
      .simulateTransaction(transaction as Base64EncodedWireTransaction, {
        encoding: 'base64',
        commitment: 'confirmed',
        sigVerify: false,
      })
      .send();

    if (simResult.value.err) {
      const errJson = JSON.stringify(simResult.value.err, bigIntReplacer);
      console.error('Simulation error:', errJson);
      console.error('Simulation logs:', simResult.value.logs);
      res.json({
        success: false,
        error: 'Transaction simulation failed',
        simulationError: JSON.parse(errJson),
        logs: simResult.value.logs,
        unitsConsumed: Number(simResult.value.unitsConsumed ?? 0),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const signature = await rpc
      .sendTransaction(transaction as Base64EncodedWireTransaction, {
        encoding: 'base64',
        skipPreflight: true,
        preflightCommitment: 'confirmed',
      })
      .send();

    res.json({
      success: true,
      signature,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error sending transaction:', error?.message, error?.context);

    res.status(500).json({
      success: false,
      error: error?.message || 'Failed to send transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
