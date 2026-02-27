import axios from 'axios';

const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

export interface BundleStatus {
  bundle_id: string;
  transactions: string[];
  slot: number;
  confirmation_status: 'processed' | 'confirmed' | 'finalized';
  err: Record<string, unknown> | null;
}

export class JitoManager {
  /**
   * Send a bundle of signed transactions to Jito Block Engine.
   * Transactions execute sequentially, all-or-nothing.
   * Max 5 transactions per bundle.
   */
  async sendBundle(transactions: string[]): Promise<string> {
    if (transactions.length === 0 || transactions.length > 5) {
      throw new Error(`Bundle must contain 1-5 transactions, got ${transactions.length}`);
    }

    const response = await axios.post(JITO_BLOCK_ENGINE, {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [transactions],
    }, { validateStatus: () => true });

    if (response.status !== 200) {
      const body = typeof response.data === 'object' ? JSON.stringify(response.data) : response.data;
      throw new Error(`Jito HTTP ${response.status}: ${body}`);
    }

    if (response.data.error) {
      throw new Error(`Jito bundle error: ${JSON.stringify(response.data.error)}`);
    }

    return response.data.result; // bundle ID
  }

  /**
   * Check the status of a previously sent bundle.
   * Status is available for ~5 minutes after submission.
   */
  async getBundleStatus(bundleId: string): Promise<BundleStatus | null> {
    const { data } = await axios.post(JITO_BLOCK_ENGINE, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getBundleStatuses',
      params: [[bundleId]],
    });

    return data.result?.value?.[0] ?? null;
  }
}
