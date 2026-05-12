import { ImageSourcePropType } from 'react-native';

/** Protocols where the app can execute deposit/withdraw transactions. */
export const SUPPORTED_PROTOCOLS = new Set(['jupiter', 'kamino', 'drift', 'perena']);

const PROTOCOL_ICONS: Record<string, ImageSourcePropType> = {
  jupiter: require('../assets/protocol-icons/jupiter.png'),
  kamino: require('../assets/protocol-icons/kamino.png'),
  drift: require('../assets/protocol-icons/drift.png'),
  perena: require('../assets/protocol-icons/perena.jpg'),
};

const PROTOCOL_LABELS: Record<string, string> = {
  jupiter: 'Jupiter',
  kamino: 'Kamino',
  drift: 'Drift',
  perena: 'Perena',
  solomon: 'Solomon',
  onre: 'Onre',
};

/** Get the display icon for a protocol. Falls back to remote URL for unknown protocols. */
export function getProtocolIcon(type: string, protocolIconUrl?: string): ImageSourcePropType | null {
  if (PROTOCOL_ICONS[type]) return PROTOCOL_ICONS[type];
  if (protocolIconUrl) return { uri: protocolIconUrl };
  return null;
}

/** Get the display label for a protocol. Falls back to protocolName from API. */
export function getProtocolLabel(type: string, protocolName?: string): string {
  return PROTOCOL_LABELS[type] ?? protocolName ?? type;
}

export function isProtocolSupported(type: string): boolean {
  return SUPPORTED_PROTOCOLS.has(type);
}
