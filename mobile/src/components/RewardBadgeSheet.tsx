import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import BottomSheet from './BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import type { TaskWithProgress } from '../types/rewards';

interface Props {
  task: TaskWithProgress | null;
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps "Verify on Seeker" for a device_seeker task. */
  onAttestSeeker?: () => void;
  attesting?: boolean;
  /** Has the user activated their Cashflow Passport? Drives the
   *  Earned-vs-Activate-to-claim copy on the status pill. */
  passportActivated?: boolean;
  /** Called when the user taps the "Activate Passport" pill (only shown
   *  when a badge is claimable AND the passport isn't activated yet). */
  onActivatePassport?: () => void;
  /** Called when the user taps "Mint Badge" (claimable + passport activated). */
  onMint?: () => void;
  /** True while this badge is being minted (drives the spinner / disabled state). */
  minting?: boolean;
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
    const fmt = (cents: number) => {
      const truncated = Math.floor(cents / 10) / 10;
      return '$' + truncated.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    };
    return `${fmt(currentCents)} of ${fmt(targetCents)}`;
  }
  if (task.targetValue === '1') {
    return task.currentValue === '1' ? 'Verified' : 'Awaiting verification';
  }
  return `${task.currentValue} of ${task.targetValue}`;
}

export default function RewardBadgeSheet({ task, visible, onClose, onAttestSeeker, attesting, passportActivated = false, onActivatePassport, onMint, minting = false }: Props) {
  const { colors } = useTheme();
  if (!task) return <BottomSheet visible={visible} onClose={onClose}><View /></BottomSheet>;

  const minted = task.status === 'minted';
  const pending = minting;
  // Treat mint_pending the same as claimable: stale server state from a prior
  // attempt that didn't land. The backend rebuilds without re-claiming the slot.
  const claimable = task.status === 'claimable' || task.status === 'mint_pending';
  const needsSeekerAttest = task.verifierType === 'device_seeker' && task.status === 'in_progress';
  const canMint = claimable && passportActivated && !!onMint;

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
              {task.maxSupply.toLocaleString('en-US')}
            </Text>
          </View>
        )}

        <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>Soulbound</Text>
          <Text style={[styles.statusValue, { color: colors.textPrimary }]}>Locked to your vault forever</Text>
        </View>

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
        ) : claimable && !passportActivated ? (
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.accentBlueDark }]}
            onPress={onActivatePassport}
            activeOpacity={0.85}
          >
            <Text style={[styles.ctaText, { color: '#fff' }]}>Activate Passport to claim</Text>
          </TouchableOpacity>
        ) : canMint ? (
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: colors.accentBlueDark }, pending && styles.ctaDisabled]}
            onPress={pending ? undefined : onMint}
            disabled={pending}
            activeOpacity={0.85}
          >
            {pending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={[styles.ctaText, { color: '#fff' }]}>Mint Badge</Text>
            )}
          </TouchableOpacity>
        ) : (
          <View style={[styles.cta, { backgroundColor: colors.cardSecondary }]}>
            {pending ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={[styles.ctaText, { color: minted ? colors.accentGreen : claimable ? colors.accentBlueDark : colors.textSecondary }]}>
                {minted
                  ? 'Earned'
                  : claimable
                    ? 'Ready to mint'
                    : 'Keep using Cashflow to unlock'}
              </Text>
            )}
          </View>
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
