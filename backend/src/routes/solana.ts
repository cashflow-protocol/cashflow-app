import { Router, Request, Response } from 'express';
import { createSolanaRpc } from '@solana/kit';
import type { Rpc, SolanaRpcApi, Base64EncodedWireTransaction } from '@solana/kit';

const router = Router();

const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const rpc: Rpc<SolanaRpcApi> = createSolanaRpc(rpcUrl);

// POST /solana/v1/send - Send a signed transaction on-chain
router.post('/send', async (req: Request, res: Response) => {
  try {
    const { transaction } = req.body;

    if (!transaction || typeof transaction !== 'string') {
      res.status(400).json({ success: false, error: 'transaction (base64) is required' });
      return;
    }

    const signature = await rpc
      .sendTransaction(transaction as Base64EncodedWireTransaction, { encoding: 'base64', preflightCommitment: 'confirmed' })
      .send();

    res.json({
      success: true,
      signature,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error sending transaction:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send transaction',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
