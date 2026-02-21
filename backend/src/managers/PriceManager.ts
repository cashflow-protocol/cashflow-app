import axios from 'axios';

const STABLECOINS = new Set(['USDC', 'USDT', 'JupUSD', 'USDG', 'USDS', 'PYUSD']);

const prices: Map<string, number> = new Map();

export class PriceManager {
  async fetchPrices(): Promise<void> {
    try {
      const { data } = await axios.get<{ symbol: string; price: string }>(
        'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDC',
      );
      const solPrice = parseFloat(data.price);
      prices.set('SOL', solPrice);
      console.log(`[PriceManager] SOL price: $${solPrice}`);
    } catch (error) {
      console.error('[PriceManager] Failed to fetch prices:', (error as Error).message);
    }
  }

  getPrice(symbol: string): number {
    if (STABLECOINS.has(symbol)) return 1;
    return prices.get(symbol) ?? 0;
  }

  getUsdValue(symbol: string, uiAmount: number): number {
    return uiAmount * this.getPrice(symbol);
  }
}
