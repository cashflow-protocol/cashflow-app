import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import BottomSheet from './BottomSheet';
import { useTheme } from '../theme/ThemeContext';
import { useCashflowPassportActivation } from '../hooks/useCashflowPassport';
import { useToast } from '../contexts/ToastContext';

const passportIcon = require('../assets/passport.png');

interface Props {
  visible: boolean;
  onClose: () => void;
  feeLamports: string;
}

function formatSol(lamports: string): string {
  if (!lamports) return '—';
  const n = Number(lamports) / 1_000_000_000;
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default function ActivateCashflowPassportSheet({ visible, onClose, feeLamports }: Props) {
  const { colors } = useTheme();
  const { activate, activating } = useCashflowPassportActivation();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const inFlight = busy || activating;

  const handleActivate = async () => {
    if (inFlight) return;
    setBusy(true);
    try {
      await activate();
      showToast('Cashflow Passport activated', 'Minted badges will appear in your Passport', 'success');
      onClose();
    } catch (err: any) {
      showToast('Activation failed', err?.message ?? 'Please try again', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={inFlight ? () => {} : onClose}>
      <View style={styles.body}>
        <View style={styles.imageWrap}>
          <Image source={passportIcon} style={styles.image} resizeMode="contain" />
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>Activate Cashflow Passport</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Your onchain passport. Reward badges will be added to your passport.
        </Text>

        <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>One-time mint fee</Text>
          <Text style={[styles.statusValue, { color: colors.textPrimary }]}>{formatSol(feeLamports)} SOL</Text>
        </View>

        <View style={[styles.statusBox, { backgroundColor: colors.cardSecondary }]}>
          <Text style={[styles.statusLabel, { color: colors.textSecondary }]}>NFT</Text>
          <Text style={[styles.statusValue, { color: colors.textPrimary }]}>Locked to your vault forever</Text>
        </View>

        <TouchableOpacity
          style={[styles.cta, { backgroundColor: colors.accentBlueDark }, inFlight && styles.ctaDisabled]}
          onPress={handleActivate}
          disabled={inFlight}
          activeOpacity={0.85}
        >
          {inFlight ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.ctaText, { color: '#fff' }]}>Activate</Text>
          )}
        </TouchableOpacity>
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
    borderRadius: 70,
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
