import React from 'react';
import { View, Text, Image, ImageSourcePropType, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
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
  const { colors } = useTheme();
  const apyPercent = (rewardsRate / 100).toFixed(2);
  const protocolIcon = PROTOCOL_ICONS[type];
  const protocolLabel = PROTOCOL_LABELS[type];
  const localIcon = getTokenIcon(mint);
  const hasPosition = positionAmount != null && positionAmount > 0;

  return (
    <TouchableOpacity style={[styles.container, { backgroundColor: colors.card, shadowColor: colors.shadowColor }, compact && styles.containerCompact]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.row}>
        {/* Icon stack: stablecoin icon with protocol badge */}
        <View style={styles.iconStack}>
          <View style={[styles.tokenIconContainer, { backgroundColor: colors.cardSecondary }]}>
            <Image source={localIcon ?? { uri: logoUrl }} style={styles.tokenIcon} />
          </View>
          <View style={[styles.protocolBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Image source={protocolIcon} style={styles.protocolIcon} />
          </View>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{vaultTitle || `${protocolLabel} - ${symbol}`}</Text>
          <Text style={[styles.protocol, { color: colors.textSecondary }]}>{protocolLabel} · {symbol}</Text>
        </View>

        {/* Right side: APY or deposit value */}
        {compact && hasPosition ? (
          <View style={styles.depositRight}>
            <Text style={[styles.depositUsd, { color: colors.textPrimary }]}>{positionUsdValue != null ? formatUsd(positionUsdValue) : ''}</Text>
            <Text style={[styles.depositAmount, { color: colors.textSecondary }]}>{formatAmount(positionAmount)} {symbol}</Text>
          </View>
        ) : (
          <Text style={styles.apy}>{apyPercent}%</Text>
        )}
      </View>

      {!compact && hasPosition && (
        <View style={[styles.positionBar, { backgroundColor: colors.infoBackground }]}>
          <Text style={[styles.positionLabel, { color: colors.textSecondary }]}>Your deposit</Text>
          <Text style={[styles.positionAmount, { color: colors.accentBlueDark }]}>{formatAmount(positionAmount)} {symbol}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 14,
    gap: 10,
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
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
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
  },
  protocol: {
    fontSize: 13,
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
  },
  depositAmount: {
    fontSize: 13,
    marginTop: 2,
  },
  positionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  positionLabel: {
    fontSize: 13,
  },
  positionAmount: {
    fontSize: 14,
    fontWeight: '600',
  },
});
