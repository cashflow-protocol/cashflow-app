import axios from 'axios';

const JITO_UUID = process.env.JITO_AUTH_UUID;
const JITO_BLOCK_ENGINE = 'https://mainnet.block-engine.jito.wtf';
const JITO_AUTH_HEADERS = JITO_UUID ? { 'x-jito-auth': JITO_UUID } : {};

const TIP_FLOOR_URL = 'https://bundles.jito.wtf/api/v1/bundles/tip_floor';
const TIP_FLOOR_CACHE_MS = 15_000;
const TIP_FLOOR_MIN_LAMPORTS = 500_000; // 0.0005 SOL
const LAMPORTS_PER_SOL = 1_000_000_000;

export interface BundleStatus {
  bundle_id: string;
  transactions: string[];
  slot: number;
  confirmation_status: 'processed' | 'confirmed' | 'finalized';
  err: Record<string, unknown> | null;
}

export class JitoManager {
  private tipCache: { lamports: number; fetchedAt: number } | null = null;

  /**
   * Fetch current Jito tip floor: 75th-percentile landed tips, floored at
   * 500k lamports, capped at the 95th percentile. Cached 15s.
   */
  async getDynamicTipLamports(): Promise<number> {
    const now = Date.now();
    if (this.tipCache && now - this.tipCache.fetchedAt < TIP_FLOOR_CACHE_MS) {
      return this.tipCache.lamports;
    }

    try {
      const { data } = await axios.get(TIP_FLOOR_URL, { timeout: 3000 });
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) throw new Error('Empty tip_floor response');

      const p75Sol = Number(row.landed_tips_75th_percentile ?? 0);
      const p95Sol = Number(row.landed_tips_95th_percentile ?? 0);
      const p75Lamports = Math.floor(p75Sol * LAMPORTS_PER_SOL);
      const p95Lamports = Math.floor(p95Sol * LAMPORTS_PER_SOL);

      let tip = Math.max(p75Lamports, TIP_FLOOR_MIN_LAMPORTS);
      if (p95Lamports > 0) tip = Math.min(tip, p95Lamports);

      this.tipCache = { lamports: tip, fetchedAt: now };
      console.log(`[JitoManager] tip_floor p75=${p75Lamports} p95=${p95Lamports} → tip=${tip}`);
      return tip;
    } catch (err: any) {
      console.warn('[JitoManager] tip_floor fetch failed, using floor:', err?.message);
      return TIP_FLOOR_MIN_LAMPORTS;
    }
  }

  /**
   * Send a bundle of signed transactions to Jito Block Engine.
   * Transactions execute sequentially, all-or-nothing.
   * Max 5 transactions per bundle.
   */
  async sendBundle(transactions: string[]): Promise<string> {
    if (transactions.length === 0 || transactions.length > 5) {
      throw new Error(`Bundle must contain 1-5 transactions, got ${transactions.length}`);
    }

    const url = JITO_UUID ? `${JITO_BLOCK_ENGINE}/api/v1/bundles?uuid=${JITO_UUID}` : `${JITO_BLOCK_ENGINE}/api/v1/bundles`;
    console.log('url:', url);
    const response = await axios.post(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [
        transactions, 
        { "encoding": "base64" }
      ],
    }, { headers: JITO_AUTH_HEADERS, validateStatus: () => true });

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
    const url = JITO_UUID ? `${JITO_BLOCK_ENGINE}/api/v1/bundles?uuid=${JITO_UUID}` : `${JITO_BLOCK_ENGINE}/api/v1/bundles`;
    const { data } = await axios.post(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'getBundleStatuses',
      params: [[bundleId]],
    }, { headers: JITO_AUTH_HEADERS });

    return data.result?.value?.[0] ?? null;
  }
}
