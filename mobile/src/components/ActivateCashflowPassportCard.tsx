import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useCashflowPassportActivation } from '../hooks/useCashflowPassport';
import { useToast } from '../contexts/ToastContext';

interface Props {
  feeLamports: string;
}

function formatSol(lamports: string): string {
  const n = Number(lamports) / 1_000_000_000;
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default function ActivateCashflowPassportCard({ feeLamports }: Props) {
  const { colors } = useTheme();
  const { activate, activating } = useCashflowPassportActivation();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    if (busy || activating) return;
    setBusy(true);
    try {
      await activate();
      showToast('Cashflow Passport activated', 'Earned badges will appear automatically', 'success');
    } catch (err: any) {
      showToast('Activation failed', err?.message ?? 'Please try again', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}>
      <View style={styles.row}>
        <View style={[styles.iconBox, { backgroundColor: colors.cardSecondary }]}>
          <Text style={styles.icon}>★</Text>
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Activate Cashflow Passport</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            One-time {formatSol(feeLamports)} SOL. Earned badges are added automatically — no extra fees.
          </Text>
        </View>
      </View>
      <TouchableOpacity
        style={[styles.cta, { backgroundColor: colors.accentBlueDark }, busy && styles.ctaDisabled]}
        onPress={handlePress}
        activeOpacity={0.85}
        disabled={busy || activating}
      >
        {busy || activating ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.ctaText}>Activate</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    padding: 16,
    gap: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    fontSize: 22,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  cta: {
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
