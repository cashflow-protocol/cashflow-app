import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import type { TaskWithProgress } from '../types/rewards';

interface Props {
  task: TaskWithProgress;
  onPress?: () => void;
  /** Compact horizontal-card variant for the home section. */
  compact?: boolean;
}

function isUsdBased(verifierType: TaskWithProgress['verifierType']): boolean {
  return (
    verifierType === 'onchain_deposit' ||
    verifierType === 'onchain_swap_volume' ||
    verifierType === 'onchain_transfer_out'
  );
}

function formatProgress(task: TaskWithProgress): string {
  if (task.status === 'minted') return 'Minted';
  if (isUsdBased(task.verifierType)) {
    const currentCents = Number(task.currentValue || '0');
    const targetCents = Number(task.targetValue || '0');
    const fmt = (cents: number) => '$' + Math.floor(cents / 100).toLocaleString('en-US');
    return `${fmt(currentCents)} / ${fmt(targetCents)}`;
  }
  // Boolean tasks (seeker / manual): show locked vs verified
  if (task.targetValue === '1') {
    return task.currentValue === '1' ? 'Verified' : 'Not yet verified';
  }
  return `${task.currentValue} / ${task.targetValue}`;
}

function progressFraction(task: TaskWithProgress): number {
  const current = Number(task.currentValue || '0');
  const target = Number(task.targetValue || '1');
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, current / target));
}

function ctaLabel(task: TaskWithProgress): string {
  switch (task.status) {
    case 'claimable':
      return `Mint ${(Number(task.mintFeeLamports) / 1_000_000_000).toFixed(2)} SOL`;
    case 'mint_pending':
      return 'Minting…';
    case 'minted':
      return 'Minted';
    case 'in_progress':
    default:
      return 'Locked';
  }
}

export default function RewardBadgeCard({ task, onPress, compact }: Props) {
  const { colors } = useTheme();
  const fraction = progressFraction(task);
  const claimable = task.status === 'claimable';
  const minted = task.status === 'minted';
  const pending = task.status === 'mint_pending';

  return (
    <TouchableOpacity
      style={[
        styles.container,
        compact && styles.containerCompact,
        { backgroundColor: colors.card, shadowColor: colors.shadowColor },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.imageWrap}>
        <Image
          source={{ uri: task.imageUrl }}
          style={[styles.image, !claimable && !minted && styles.imageDimmed]}
        />
        {minted && (
          <View style={[styles.lockBadge, { backgroundColor: colors.accentGreen }]}>
            <Text style={styles.lockBadgeText}>✓</Text>
          </View>
        )}
        {!claimable && !minted && (
          <View style={[styles.lockBadge, { backgroundColor: colors.cardSecondary }]}>
            <Text style={[styles.lockBadgeText, { color: colors.textSecondary }]}>🔒</Text>
          </View>
        )}
      </View>

      <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={1}>
        {task.title}
      </Text>
      <Text style={[styles.progress, { color: colors.textSecondary }]} numberOfLines={1}>
        {formatProgress(task)}
      </Text>

      <View style={[styles.progressTrack, { backgroundColor: colors.cardSecondary }]}>
        <View
          style={[
            styles.progressFill,
            {
              width: `${fraction * 100}%`,
              backgroundColor: minted ? colors.accentGreen : claimable ? colors.accentBlueDark : colors.textSecondary,
            },
          ]}
        />
      </View>

      <View style={[styles.cta, claimable && { backgroundColor: colors.accentBlueDark }, minted && { backgroundColor: colors.cardSecondary }]}>
        {pending ? (
          <ActivityIndicator size="small" color={colors.textPrimary} />
        ) : (
          <Text style={[styles.ctaText, claimable && styles.ctaTextClaimable, minted && { color: colors.textSecondary }]}>
            {ctaLabel(task)}
          </Text>
        )}
      </View>

      {task.maxSupply != null && (
        <Text style={[styles.supply, { color: colors.textSecondary }]} numberOfLines={1}>
          {task.mintedCount.toLocaleString('en-US')} / {task.maxSupply.toLocaleString('en-US')} minted
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 160,
    borderRadius: 16,
    padding: 12,
    gap: 6,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  containerCompact: {
    width: 160,
  },
  imageWrap: {
    position: 'relative',
    alignItems: 'center',
    paddingVertical: 6,
  },
  image: {
    width: 96,
    height: 96,
    borderRadius: 12,
  },
  imageDimmed: {
    opacity: 0.5,
  },
  lockBadge: {
    position: 'absolute',
    bottom: 0,
    right: 16,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockBadgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  progress: {
    fontSize: 12,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  cta: {
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    minHeight: 32,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#999',
  },
  ctaTextClaimable: {
    color: '#fff',
  },
  supply: {
    fontSize: 11,
    textAlign: 'center',
  },
});
