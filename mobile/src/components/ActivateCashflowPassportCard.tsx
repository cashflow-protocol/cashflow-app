import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

const passportIcon = require('../assets/passport.png');

interface Props {
  feeLamports: string;
  onPress: () => void;
}

function formatSol(lamports: string): string {
  const n = Number(lamports) / 1_000_000_000;
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default function ActivateCashflowPassportCard({ feeLamports, onPress }: Props) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.card, shadowColor: colors.shadowColor }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.row}>
        <Image source={passportIcon} style={styles.iconImage} resizeMode="contain" />
        <View style={styles.copy}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>Activate Cashflow Passport</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            All your reward badges will be in your Cashflow Passport. Mint it once - use forever.
          </Text>
        </View>
      </View>
      <View style={[styles.cta, { backgroundColor: colors.accentBlueDark }]}>
        <Text style={styles.ctaText}>Activate</Text>
      </View>
    </TouchableOpacity>
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
  iconImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
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
  ctaText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
