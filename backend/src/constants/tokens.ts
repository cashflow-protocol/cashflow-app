export interface SupportedToken {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
}

export const SUPPORTED_TOKENS: SupportedToken[] = [
  {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'SOL',
    name: 'Wrapped SOL',
    decimals: 9,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/4128/large/solana.png?1718769756',
  },
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/6319/large/USDC.png?1769615602',
  },
  {
    mint: 'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD',
    symbol: 'JupUSD',
    name: 'Jupiter USD',
    decimals: 6,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/70636/large/icon.png?1767003505',
  },
  {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'USDT',
    decimals: 6,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/325/large/Tether.png?1668148663',
  },
  {
    mint: 'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr',
    symbol: 'EURC',
    name: 'EURC',
    decimals: 6,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/26045/large/EURC.png?1769615705',
  },
  {
    mint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
    symbol: 'USDG',
    name: 'Global Dollar',
    decimals: 6,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png?1730484111',
  },
  {
    mint: 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',
    symbol: 'USDS',
    name: 'USDS',
    decimals: 6,
    logoUrl: 'https://coin-images.coingecko.com/coins/images/39926/large/usds.webp?1726666683',
  },
  {
    mint: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
    symbol: 'PYUSD',
    name: 'PayPal USD',
    decimals: 6,
    logoUrl: 'https://assets.coingecko.com/coins/images/31212/standard/PYUSD_Token_Logo_2x.png?1765987788',
  },
  {
    mint: 'star9agSpjiFe3M49B3RniVU4CMBBEK3Qnaqn3RGiFM',
    symbol: 'USD*',
    name: 'USD*',
    decimals: 6,
    logoUrl: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/perena_usd.png',
  },
  {
    mint: 'pTA4St7D5WshfLUPBXoaxn5m8e3k2ort2DVt3gUTa17',
    symbol: 'sUSDv',
    name: 'Staked USDv',
    decimals: 6,
    logoUrl: 'https://cashflowfi.ams3.cdn.digitaloceanspaces.com/logos/susdv.png',
  },

];

export const SUPPORTED_TOKEN_MINTS = SUPPORTED_TOKENS.map((t) => t.mint);

export const SUPPORTED_TOKENS_BY_MINT = Object.fromEntries(
  SUPPORTED_TOKENS.map((t) => [t.mint, t])
) as Record<string, SupportedToken>;
