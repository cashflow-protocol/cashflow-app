import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import BottomSheet from './BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import type { TaskWithProgress } from '../types/rewards';

interface Props {
  task: TaskWithProgress | null;
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps the mint button. Parent owns the mint flow. */
  onMint?: (task: TaskWithProgress) => void;
  minting?: boolean;
  /** Called when the user taps "Verify on Seeker" for a device_seeker task. */
  onAttestSeeker?: () => void;
  attesting?: boolean;
}

function isUsdBased(verifierType: TaskWithProgress['verifierType']): boolean {
  return (
    verifierType === 'onchain_deposit' ||
    verifierType === 'onchain_swap_volume' ||
    verifierType === 'onchain_transfer_out'
  );
}

function formatProgressLabel(task: TaskWithProgress): string {
  if (isUsdBased(task.verifierType)) {
    const currentCents = Number(task.currentValue || '0');
    const targetCents = Number(task.targetValue || '0');
    const fmt = (cents: number) => '$' + Math.floor(cents / 100).toLocaleString('en-US');
    return `${fmt(currentCents)} of ${fmt(targetCents)}`;
  }
  if (task.targetValue === '1') {
    return task.currentValue === '1' ? 'Verified' : 'Awaiting verification';
  }
  return `${task.currentValue} of ${task.targetValue}`;
}

export default function RewardBadgeSheet({ task, visible, onClose, onMint, minting, onAttestSeeker, attesting }: Props) {
  const { colors } = useTheme();
  if (!task) return <BottomSheet visible={visible} onClose={onClose}><View /></BottomSheet>;

  const claimable = task.status === 'claimable';
  const minted = task.status === 'minted';
  const pending = task.status === 'mint_pending' || minting;
  const feeSol = (Number(task.mintFeeLamports) / 1_000_000_000).toFixed(2);
  const needsSeekerAttest = task.verifierType === 'device_seeker' && task.status === 'in_progress';

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.imageWrap}>
          <Image source={{ uri: task.imageUrl }} style={styles.image} />
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>{task.title}</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>{task.description}</Text>

        <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Progress</Text>
          <Text style={[styles.statusValue, { color: colors.textPrimary }]}>{formatProgressLabel(task)}</Text>
        </View>

        {task.maxSupply != null && (
          <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Supply</Text>
            <Text style={[styles.statusValue, { color: colors.textPrimary }]}>
              {task.mintedCount.toLocaleString('en-US')} / {task.maxSupply.toLocaleString('en-US')} minted
            </Text>
          </View>
        )}

        <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Soulbound</Text>
          <Text style={[styles.statusValue, { color: colors.textPrimary }]}>Locked to your vault forever</Text>
        </View>

        {minted && task.assetAddress && (
          <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
            <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Asset</Text>
            <Text style={[styles.statusValue, { color: colors.textPrimary }]} numberOfLines={1} ellipsizeMode="middle">
              {task.assetAddress}
            </Text>
          </View>
        )}

        {needsSeekerAttest ? (
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.accentBlueDark }, attesting && styles.ctaDisabled]}
            onPress={attesting ? undefined : onAttestSeeker}
            disabled={!!attesting}
            activeOpacity={0.85}
          >
            {attesting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.ctaText, { color: '#fff' }]}>Verify on Seeker</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.cta,
              { backgroundColor: claimable && !pending ? colors.accentBlueDark : colors.cardSecondary },
              (!claimable || pending) && styles.ctaDisabled,
            ]}
            onPress={claimable && !pending ? () => onMint?.(task) : undefined}
            disabled={!claimable || pending}
            activeOpacity={0.85}
          >
            {pending ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text
                style={[
                  styles.ctaText,
                  { color: claimable ? '#fff' : colors.textSecondary },
                ]}
              >
                {minted ? 'Already minted' : claimable ? `Mint badge for ${feeSol} SOL` : 'Keep using Cashflow to unlock'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: 20,
    gap: 12,
  },
  imageWrap: {
    alignItems: 'center',
    marginBottom: 4,
  },
  image: {
    width: 140,
    height: 140,
    borderRadius: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
  },
  statusBox: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 14,
  },
  statusValue: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    marginLeft: 12,
    textAlign: 'right',
  },
  cta: {
    marginTop: 12,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
