import React from 'react';
import { View, Text, Image, ImageSourcePropType, StyleSheet, TouchableOpacity } from 'react-native';
import type { EarnTokenType } from '../types/earn';
import { getTokenIcon } from '../assets/token-icons';

const PROTOCOL_ICONS: Record<EarnTokenType, ImageSourcePropType> = {
  jupiter: require('../assets/protocol-icons/jupiter.png'),
  kamino: require('../assets/protocol-icons/kamino.png'),
  drift: require('../assets/protocol-icons/drift.png'),
};

const PROTOCOL_LABELS: Record<EarnTokenType, string> = {
  jupiter: 'Jupiter',
  kamino: 'Kamino',
  drift: 'Drift',
};

interface EarnTokenItemProps {
  type: EarnTokenType;
  mint: string;
  symbol: string;
  vaultTitle: string;
  logoUrl: string;
  rewardsRate: number;
  positionAmount?: number;
  positionUsdValue?: number;
  /** When true, shows deposit amount instead of APY, hides position bar, removes shadow. */
  compact?: boolean;
  onPress?: () => void;
}

function formatUsd(value: number): string {
  return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format amount with up to 9 decimals, trimming trailing zeros. Avoids scientific notation. */
function formatAmount(value: number): string {
  if (value === 0) return '0';
  const str = value.toFixed(9);
  return str.replace(/\.?0+$/, '');
}

export default function EarnTokenItem({
  type,
  mint,
  symbol,
  vaultTitle,
  logoUrl,
  rewardsRate,
  positionAmount,
  positionUsdValue,
  compact,
  onPress,
}: EarnTokenItemProps) {
  const apyPercent = (rewardsRate / 100).toFixed(2);
  const protocolIcon = PROTOCOL_ICONS[type];
  const protocolLabel = PROTOCOL_LABELS[type];
  const localIcon = getTokenIcon(mint);
  const hasPosition = positionAmount != null && positionAmount > 0;

  return (
    <TouchableOpacity style={[styles.container, compact && styles.containerCompact]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.row}>
        {/* Icon stack: stablecoin icon with protocol badge */}
        <View style={styles.iconStack}>
          <View style={styles.tokenIconContainer}>
            <Image source={localIcon ?? { uri: logoUrl }} style={styles.tokenIcon} />
          </View>
          <View style={styles.protocolBadge}>
            <Image source={protocolIcon} style={styles.protocolIcon} />
          </View>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>{vaultTitle || `${protocolLabel} - ${symbol}`}</Text>
          <Text style={styles.protocol}>{protocolLabel} · {symbol}</Text>
        </View>

        {/* Right side: APY or deposit value */}
        {compact && hasPosition ? (
          <View style={styles.depositRight}>
            <Text style={styles.depositUsd}>{positionUsdValue != null ? formatUsd(positionUsdValue) : ''}</Text>
            <Text style={styles.depositAmount}>{formatAmount(positionAmount)} {symbol}</Text>
          </View>
        ) : (
          <Text style={styles.apy}>{apyPercent}%</Text>
        )}
      </View>

      {!compact && hasPosition && (
        <View style={styles.positionBar}>
          <Text style={styles.positionLabel}>Your deposit</Text>
          <Text style={styles.positionAmount}>{formatAmount(positionAmount)} {symbol}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  containerCompact: {
    backgroundColor: 'transparent',
    padding: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconStack: {
    width: 44,
    height: 44,
  },
  tokenIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F4F4F4',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  tokenIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  protocolBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E8EAF1',
    overflow: 'hidden',
  },
  protocolIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000',
  },
  protocol: {
    fontSize: 13,
    color: '#808080',
  },
  apy: {
    fontSize: 17,
    fontWeight: '700',
    color: '#138001',
  },
  depositRight: {
    alignItems: 'flex-end',
  },
  depositUsd: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  depositAmount: {
    fontSize: 13,
    color: '#6B7B8D',
    marginTop: 2,
  },
  positionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EEF4FB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  positionLabel: {
    fontSize: 13,
    color: '#6B7B8D',
  },
  positionAmount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#175DA3',
  },
});
