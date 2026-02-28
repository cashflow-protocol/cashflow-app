import { ImageSourcePropType } from 'react-native';

const SOL_ICON = require('./So11111111111111111111111111111111111111112.png');

const TOKEN_ICONS: Record<string, ImageSourcePropType> = {
  'native': SOL_ICON,
  'So11111111111111111111111111111111111111112': SOL_ICON,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': require('./EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.png'),
  'JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD': require('./JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD.png'),
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': require('./Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB.png'),
  'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': require('./HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr.png'),
  '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH': require('./2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH.png'),
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA': require('./USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA.png'),
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': require('./2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo.png'),
};

export function getTokenIcon(mint: string): ImageSourcePropType | null {
  return TOKEN_ICONS[mint] ?? null;
}
